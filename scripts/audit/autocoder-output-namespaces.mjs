#!/usr/bin/env node

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Reads JSON Lines from stdin. Each line must provide workspaceId, fileId and
// the coding-scheme JSON as a base64-encoded data field.

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '../..');
process.env.TS_NODE_PROJECT ||= path.join(
  repositoryRoot,
  'apps/backend/tsconfig.json'
);
const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');

const Autocoder = require('@iqb/responses');
const {
  createAutocoderOutputShadows
} = require('../../apps/backend/src/app/database/services/coding/autocoder-output-shadow.util');

let input = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) {
  input += chunk;
}

const results = input
  .split(/\r?\n/u)
  .filter(Boolean)
  .map(line => {
    const record = JSON.parse(line);
    try {
      const scheme = JSON.parse(
        Buffer.from(record.data, 'base64').toString('utf8')
      );
      const variableCodings = scheme.variableCodings || [];
      const outputShadows = createAutocoderOutputShadows(variableCodings);
      Autocoder.CodingSchemeFactory.getVariableDependencyTree(variableCodings);
      return {
        workspaceId: record.workspaceId,
        fileId: record.fileId,
        variableCount: variableCodings.length,
        outputShadows,
        status: 'OK'
      };
    } catch (error) {
      return {
        workspaceId: record.workspaceId,
        fileId: record.fileId,
        status: 'ERROR',
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });

const errors = results.length === 0 ?
  [{ status: 'ERROR', error: 'No coding schemes received on stdin.' }] :
  results.filter(result => result.status === 'ERROR');
const shadows = results.flatMap(result => (
  (result.outputShadows || []).map(shadow => ({
    workspaceId: result.workspaceId,
    fileId: result.fileId,
    ...shadow
  }))
));

process.stdout.write(`${JSON.stringify({
  schemeCount: results.length,
  errorCount: errors.length,
  shadowCount: shadows.length,
  shadows,
  errors
}, null, 2)}\n`);

if (errors.length > 0) {
  process.exitCode = 1;
}
