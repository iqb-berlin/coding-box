#!/usr/bin/env node

/**
 * Repro helper for scale tests without creating additional large workspaces.
 *
 * It temporarily changes persons.consider in an existing scale workspace to
 * emulate 1k/2.5k/5k active test persons, clears relevant caches, measures
 * selected API endpoints, and restores the original consider flags.
 *
 * Example:
 * AUTH_TOKEN=... WORKSPACE_ID=54 TIERS=1000,2500,5000 CONCURRENCY_LEVELS=1,4 \
 *   node scripts/repro/workspace-consider-scale-load-test.mjs
 *
 * Optional ENDPOINTS:
 * - overview
 * - geogebra
 * - applied
 * - readiness (uses forceRefresh=true and can be expensive on large workspaces)
 */

import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

const authToken = process.env.AUTH_TOKEN;
const baseUrl = process.env.BASE_URL || 'http://localhost:3333/api';
const workspaceId = Number.parseInt(process.env.WORKSPACE_ID || '54', 10);
const tiers = (process.env.TIERS || '1000,2500,5000')
  .split(',')
  .map(value => Number.parseInt(value.trim(), 10))
  .filter(value => Number.isInteger(value) && value > 0);
const concurrencyLevels = (process.env.CONCURRENCY_LEVELS || '1,4')
  .split(',')
  .map(value => Number.parseInt(value.trim(), 10))
  .filter(value => Number.isInteger(value) && value > 0);
const rounds = Number.parseInt(process.env.ROUNDS || '1', 10);
const dbContainer = process.env.DB_CONTAINER || 'kodierbox-db-1';
const redisContainer = process.env.REDIS_CONTAINER || 'kodierbox-redis-1';
const outputJson = process.env.OUTPUT_JSON;
const requestedEndpointNames = (process.env.ENDPOINTS || 'overview,geogebra,applied')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);

if (!authToken) {
  throw new Error('AUTH_TOKEN is required.');
}
if (!Number.isInteger(workspaceId) || workspaceId <= 0) {
  throw new Error('WORKSPACE_ID must be a positive integer.');
}
if (tiers.length === 0) {
  throw new Error('TIERS must contain at least one positive integer.');
}
if (concurrencyLevels.length === 0) {
  throw new Error('CONCURRENCY_LEVELS must contain at least one positive integer.');
}
if (!Number.isInteger(rounds) || rounds <= 0) {
  throw new Error('ROUNDS must be a positive integer.');
}

const endpointCatalog = {
  overview: {
    name: 'test-results-overview',
    path: `/admin/workspace/${workspaceId}/test-results/overview`
  },
  geogebra: {
    name: 'geogebra-existence',
    path: `/admin/workspace/${workspaceId}/responses/geogebra-existence`
  },
  readiness: {
    name: 'coding-readiness',
    path: `/admin/workspace/${workspaceId}/coding/readiness?autoCoderRun=1&forceRefresh=true`
  },
  applied: {
    name: 'applied-results-overview',
    path: `/admin/workspace/${workspaceId}/coding/applied-results-overview`
  }
};

const endpoints = requestedEndpointNames.map(name => {
  const endpoint = endpointCatalog[name];
  if (!endpoint) {
    throw new Error(
      `Unknown endpoint "${name}". Supported: ${Object.keys(endpointCatalog).join(', ')}.`
    );
  }
  return endpoint;
});

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
    ...options
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed:\n${result.stderr || result.stdout}`
    );
  }
  return result.stdout;
}

function sql(query) {
  return run('docker', [
    'exec',
    dbContainer,
    'psql',
    '-U',
    'root',
    '-d',
    'coding-box',
    '-At',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    query
  ]).trim();
}

function captureOriginalConsiderState() {
  const rows = sql(`
    SELECT id || ':' || CASE WHEN consider THEN '1' ELSE '0' END
    FROM persons
    WHERE workspace_id = ${workspaceId}
    ORDER BY id
  `);
  return rows ? rows.split('\n') : [];
}

function restoreOriginalConsiderState(rows) {
  if (rows.length === 0) {
    return;
  }
  const falseIds = rows
    .filter(row => row.endsWith(':0'))
    .map(row => Number.parseInt(row.split(':')[0], 10))
    .filter(Number.isInteger);

  sql(`UPDATE persons SET consider = true WHERE workspace_id = ${workspaceId}`);
  if (falseIds.length > 0) {
    sql(`
      UPDATE persons
      SET consider = false
      WHERE workspace_id = ${workspaceId}
        AND id IN (${falseIds.join(',')})
    `);
  }
}

function setActivePersons(activePersons) {
  sql(`
    WITH ranked AS (
      SELECT id, row_number() OVER (ORDER BY id) AS rn
      FROM persons
      WHERE workspace_id = ${workspaceId}
    )
    UPDATE persons p
    SET consider = ranked.rn <= ${activePersons}
    FROM ranked
    WHERE p.id = ranked.id
  `);
  return Number.parseInt(sql(`
    SELECT count(*)
    FROM persons
    WHERE workspace_id = ${workspaceId}
      AND consider = true
  `), 10);
}

function redisScan(pattern) {
  const output = run('docker', [
    'exec',
    redisContainer,
    'redis-cli',
    '--scan',
    '--pattern',
    pattern
  ]);
  return output.split('\n').map(line => line.trim()).filter(Boolean);
}

function clearRedisPattern(pattern) {
  const keys = redisScan(pattern);
  for (let index = 0; index < keys.length; index += 200) {
    const chunk = keys.slice(index, index + 200);
    if (chunk.length > 0) {
      run('docker', ['exec', redisContainer, 'redis-cli', 'UNLINK', ...chunk]);
    }
  }
  return keys.length;
}

function clearWorkspaceCaches() {
  const patterns = [
    `*workspace-overview-stats-${workspaceId}*`,
    `*geogebra-existence:${workspaceId}*`,
    `*coding_readiness:${workspaceId}*`,
    `*coding_applied_results_overview*${workspaceId}*`,
    `*flat_responses_count:${workspaceId}*`,
    `*response-analysis:${workspaceId}*`
  ];
  return Object.fromEntries(
    patterns.map(pattern => [pattern, clearRedisPattern(pattern)])
  );
}

async function request(endpoint) {
  const startedAt = performance.now();
  const response = await fetch(`${baseUrl}${endpoint.path}`, {
    headers: { Authorization: `Bearer ${authToken}` }
  });
  const text = await response.text();
  return {
    endpoint: endpoint.name,
    status: response.status,
    ok: response.ok,
    durationMs: performance.now() - startedAt,
    bytes: Buffer.byteLength(text)
  };
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
  return endpoints.map(endpoint => {
    const endpointResults = results.filter(
      result => result.endpoint === endpoint.name
    );
    const durations = endpointResults.map(result => result.durationMs);
    return {
      endpoint: endpoint.name,
      requests: endpointResults.length,
      errors: endpointResults.filter(result => !result.ok).length,
      p50Ms: Math.round(percentile(durations, 50)),
      p95Ms: Math.round(percentile(durations, 95)),
      maxMs: Math.round(Math.max(...durations, 0))
    };
  });
}

async function runStage(concurrency) {
  const startedAt = performance.now();
  const workers = await Promise.all(
    Array.from({ length: concurrency }, async (_, index) => {
      const results = [];
      for (let round = 1; round <= rounds; round += 1) {
        for (const endpoint of endpoints) {
          results.push({
            ...(await request(endpoint)),
            workerId: index + 1,
            round
          });
        }
      }
      return results;
    })
  );
  const results = workers.flat();
  return {
    concurrency,
    rounds,
    totalRequests: results.length,
    durationMs: Math.round(performance.now() - startedAt),
    summary: summarize(results)
  };
}

const originalConsiderState = captureOriginalConsiderState();
const report = {
  generatedAt: new Date().toISOString(),
  baseUrl,
  workspaceId,
  endpoints: requestedEndpointNames,
  tiers: []
};

try {
  for (const tier of tiers) {
    const activePersons = setActivePersons(tier);
    const clearedCaches = clearWorkspaceCaches();
    const tierResult = {
      requestedPersons: tier,
      activePersons,
      clearedCaches,
      stages: []
    };
    for (const concurrency of concurrencyLevels) {
      tierResult.stages.push(await runStage(concurrency));
    }
    report.tiers.push(tierResult);
    console.log(JSON.stringify(tierResult, null, 2));
  }
} finally {
  restoreOriginalConsiderState(originalConsiderState);
  clearWorkspaceCaches();
}

if (outputJson) {
  await writeFile(outputJson, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}
