#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';
import { safeRelativePath } from './audit-downloads.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const bundleDir = path.resolve(scriptDir, '../../tmp/iqb-windows');
const report = JSON.parse(await readFile(path.join(bundleDir, 'audit.json'), 'utf8'));
const bundle = JSON.parse(await readFile(path.join(bundleDir, 'bundle.json'), 'utf8'));
if (report.status !== 'passed' || !bundle.applications.length ||
    bundle.applications.length !== report.applications.length) {
  throw new Error('Run a successful download audit before packaging');
}

const zip = new AdmZip();
for (const name of ['Bootstrap-Windows.ps1', 'windows_probe.py', 'requirements.txt',
  'README.md', 'functional-test-plan.json']) {
  zip.addFile(name, await readFile(path.join(scriptDir, name)));
}
for (const name of ['audit.json', 'audit.md', 'bundle.json']) {
  zip.addFile(`bundle/${name}`, await readFile(path.join(bundleDir, name)));
}
for (const app of bundle.applications) {
  if (!app.files.length) throw new Error(`Empty application: ${app.id}`);
  for (const entry of app.files) {
    const name = safeRelativePath(entry.path);
    const buffer = await readFile(path.join(bundleDir, name));
    const digest = createHash('sha256').update(buffer).digest('hex');
    if (buffer.length !== entry.bytes || digest !== entry.sha256) {
      throw new Error(`Bundle changed since audit: ${name}`);
    }
    zip.addFile(`bundle/${name}`, buffer);
  }
}
const filename = 'iqb-windows-testkit.zip';
const archive = zip.toBuffer();
const archivePath = path.join(bundleDir, filename);
await writeFile(archivePath, archive);
const digest = createHash('sha256').update(archive).digest('hex');
await writeFile(`${archivePath}.sha256`, `${digest}  ${filename}\n`);
console.log(`Windows test kit: ${archivePath}\nBytes: ${archive.length}\nSHA-256: ${digest}`);
