#!/usr/bin/env node

/**
 * Repro/load helper for manual coding and response-analysis endpoints.
 *
 * Example:
 * AUTH_TOKEN=... WORKSPACE_ID=47 CONCURRENCY=4 ROUNDS=5 \
 *   node scripts/repro/manual-coding-api-load-test.mjs
 *
 * Optional:
 * - BASE_URL=http://localhost:3333/api
 * - TRIGGER_RESPONSE_ANALYSIS=true includes one POST trigger before the load.
 * - CONCURRENCY_LEVELS=1,4,8 runs multiple concurrency stages.
 * - ENDPOINT_SET=manual|test-results|all limits endpoint coverage.
 * - OUTPUT_JSON=/tmp/manual-coding-api-load.json writes machine-readable results.
 */

import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

const baseUrl = process.env.BASE_URL || 'http://localhost:3333/api';
const workspaceId = process.env.WORKSPACE_ID || '47';
const authToken = process.env.AUTH_TOKEN;
const concurrency = Number.parseInt(process.env.CONCURRENCY || '4', 10);
const concurrencyLevels = (process.env.CONCURRENCY_LEVELS || '')
  .split(',')
  .map(level => Number.parseInt(level.trim(), 10))
  .filter(level => Number.isInteger(level) && level > 0);
const rounds = Number.parseInt(process.env.ROUNDS || '5', 10);
const triggerResponseAnalysis =
  process.env.TRIGGER_RESPONSE_ANALYSIS === 'true';
const endpointSet = process.env.ENDPOINT_SET || 'manual';
const outputJson = process.env.OUTPUT_JSON;

if (!authToken) {
  throw new Error(
    'AUTH_TOKEN is required. Example: AUTH_TOKEN=... node scripts/repro/manual-coding-api-load-test.mjs'
  );
}

if (!Number.isInteger(concurrency) || concurrency <= 0) {
  throw new Error('CONCURRENCY must be a positive integer.');
}

if (!['manual', 'test-results', 'all'].includes(endpointSet)) {
  throw new Error('ENDPOINT_SET must be manual, test-results, or all.');
}

if (!Number.isInteger(rounds) || rounds <= 0) {
  throw new Error('ROUNDS must be a positive integer.');
}

const manualEndpoints = [
  {
    name: 'incomplete-variables',
    path: `/admin/workspace/${workspaceId}/coding/incomplete-variables`
  },
  {
    name: 'scope-summary',
    path: `/admin/workspace/${workspaceId}/coding/incomplete-variables/scope-summary`
  },
  {
    name: 'coding-freshness',
    path: `/admin/workspace/${workspaceId}/coding/freshness`
  },
  {
    name: 'response-analysis',
    path: `/admin/workspace/${workspaceId}/coding/response-analysis?threshold=2&emptyLimit=10&duplicateLimit=10`
  }
];

const testResultsEndpoints = [
  {
    name: 'flat-responses-page',
    path: `/admin/workspace/${workspaceId}/test-results/flat-responses?page=1&limit=100`
  },
  {
    name: 'flat-response-filter-options',
    path: `/admin/workspace/${workspaceId}/test-results/flat-responses/filter-options`
  },
  {
    name: 'test-results-overview',
    path: `/admin/workspace/${workspaceId}/test-results/overview`
  }
];

const endpoints = [
  ...(endpointSet === 'test-results' ? [] : manualEndpoints),
  ...(endpointSet === 'manual' ? [] : testResultsEndpoints)
];

async function request(endpoint, options = {}) {
  const startedAt = performance.now();
  const response = await fetch(`${baseUrl}${endpoint.path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${authToken}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const durationMs = performance.now() - startedAt;

  return {
    endpoint: endpoint.name,
    status: response.status,
    ok: response.ok,
    durationMs,
    bytes: Buffer.byteLength(text)
  };
}

function average(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values, percent) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.ceil((percent / 100) * sorted.length) - 1
  );
  return sorted[index];
}

function summarize(results) {
  return endpoints.map((endpoint) => {
    const endpointResults = results.filter(
      (result) => result.endpoint === endpoint.name
    );
    const durations = endpointResults.map((result) => result.durationMs);
    return {
      endpoint: endpoint.name,
      requests: endpointResults.length,
      errors: endpointResults.filter((result) => !result.ok).length,
      p50Ms: Math.round(percentile(durations, 50)),
      p95Ms: Math.round(percentile(durations, 95)),
      maxMs: Math.round(Math.max(...durations, 0)),
      avgMs: Math.round(average(durations))
    };
  });
}

async function runWorker(workerId, currentRounds) {
  const results = [];
  for (let round = 1; round <= currentRounds; round += 1) {
    for (const endpoint of endpoints) {
      const result = await request(endpoint);
      results.push({ ...result, workerId, round });
    }
  }
  return results;
}

async function runStage(currentConcurrency) {
  if (triggerResponseAnalysis) {
    const triggerEndpoint = {
      name: 'response-analysis-trigger',
      path: `/admin/workspace/${workspaceId}/coding/response-analysis`
    };
    const result = await request(triggerEndpoint, { method: 'POST' });
    console.log(JSON.stringify({ trigger: result }, null, 2));
  }

  const startedAt = performance.now();
  const workerResults = await Promise.all(
    Array.from({ length: currentConcurrency }, (_, index) => runWorker(index + 1, rounds))
  );
  const results = workerResults.flat();
  const durationMs = performance.now() - startedAt;

  return {
    baseUrl,
    workspaceId,
    endpointSet,
    concurrency: currentConcurrency,
    rounds,
    totalRequests: results.length,
    durationMs: Math.round(durationMs),
    summary: summarize(results)
  };
}

const stages = concurrencyLevels.length ? concurrencyLevels : [concurrency];
const stageResults = [];

for (const stageConcurrency of stages) {
  const result = await runStage(stageConcurrency);
  stageResults.push(result);
  console.log(JSON.stringify(result, null, 2));
}

const report = {
  generatedAt: new Date().toISOString(),
  stages: stageResults
};

if (outputJson) {
  await writeFile(outputJson, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}
