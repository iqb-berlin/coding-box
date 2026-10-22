import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { findComposeContainer } from './compose-container.mjs';
import { FIXTURE_ADMIN_USERNAME } from './auth-environment.mjs';

const exec = promisify(execFile);

/** Exercise real API/BullMQ ownership boundaries in the disposable workflow stack. */
export async function verifyJobIsolation(state) {
  const { config, workspaceId, adminToken } = state;
  assert.match(config.composeProject, /^coding-box-replay-[a-z0-9-]+$/);
  assert.equal(config.composeProject, `coding-box-replay-${config.runId}`);
  assert.ok(Number.isSafeInteger(workspaceId) && workspaceId > 0);
  assert.ok(typeof adminToken === 'string' && adminToken.length > 0);
  const request = async (route, method = 'GET', body) => {
    const response = await fetch(`${config.apiUrl}/api${route}`, {
      method,
      headers: {
        authorization: `Bearer ${adminToken}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' })
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000)
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : undefined };
  };
  const identity = await request('/auth-data');
  assert.equal(identity.status, 200);
  assert.equal(identity.body.userName, FIXTURE_ADMIN_USERNAME);
  assert.equal(identity.body.isAdmin, true);
  const pollCompleted = async route => {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const response = await request(route);
      assert.equal(response.status, 200);
      assert.notEqual(response.body.status, 'failed', response.body.error || 'Job failed');
      if (response.body.status === 'completed') return response.body;
      assert.ok(['pending', 'processing', 'waiting', 'active', 'delayed'].includes(response.body.status),
        'Expected an active job while awaiting completion');
      await delay(1000);
    }
    assert.fail('Real BullMQ job did not complete within 60 seconds');
  };
  let otherWorkspaceId;
  try {
    const created = await request('/admin/workspace', 'POST', {
      name: `replay-e2e-isolation-${config.runId}`, settings: {}
    });
    assert.equal(created.status, 201);
    otherWorkspaceId = Number(created.body);
    assert.ok(Number.isSafeInteger(otherWorkspaceId) && otherWorkspaceId > 0);
    assert.notEqual(otherWorkspaceId, workspaceId);
    const owner = `/admin/workspace/${workspaceId}`;
    const other = `/admin/workspace/${otherWorkspaceId}`;
    // The same user must pass both workspace guards, reaching job ownership checks.
    for (const workspace of [owner, other]) {
      assert.equal((await request(`${workspace}/test-results/overview`)).status, 200);
    }

    const analysis = await request(`${owner}/variable-analysis/jobs`, 'POST');
    assert.equal(analysis.status, 201);
    assert.ok(typeof analysis.body.id === 'string' && analysis.body.id.length > 0);
    const analysisPath = `/variable-analysis/jobs/${encodeURIComponent(analysis.body.id)}`;
    const completedAnalysis = await pollCompleted(`${owner}${analysisPath}`);
    assert.equal(completedAnalysis.workspace_id, workspaceId);
    // Real processor results are chunked; the API serves them through pagination.
    const resultsPath = `${analysisPath}/results/page`;
    const results = await request(`${owner}${resultsPath}`);
    assert.equal(results.status, 200, JSON.stringify(results.body));
    assert.ok(Array.isArray(results.body.variableCombos));
    assert.ok(Number.isSafeInteger(results.body.total) && results.body.total >= 0);
    const assertOwnerAnalysis = async () => {
      const status = await request(`${owner}${analysisPath}`);
      assert.equal(status.status, 200);
      assert.equal(status.body.id, analysis.body.id);
      assert.equal(status.body.workspace_id, workspaceId);
      assert.equal(status.body.status, 'completed');
      assert.deepEqual(await request(`${owner}${resultsPath}`), results,
        'A foreign mutation must preserve the owner job and cached results');
    };
    const foreignCancel = await request(`${other}${analysisPath}/cancel`, 'POST');
    assert.equal(foreignCancel.status, 201);
    assert.equal(foreignCancel.body.success, false);
    await assertOwnerAnalysis();
    const foreignDelete = await request(`${other}${analysisPath}`, 'DELETE');
    assert.equal(foreignDelete.status, 200);
    assert.equal(foreignDelete.body.success, false);
    await assertOwnerAnalysis();
    assert.equal((await request(`${other}${analysisPath}`)).status, 404);
    assert.equal((await request(`${other}${analysisPath}/results`)).status, 404);
    assert.equal((await request(`${other}${resultsPath}`)).status, 404);

    // Prior browser views may have populated this exact workspace/version cache.
    // Remove only that synthetic key so the API must return a real BullMQ job.
    const redisContainer = await findComposeContainer(config.composeProject, 'redis');
    const cacheKey = `replay-e2e:${config.runId}:cache:coding-statistics:schema-v5:${workspaceId}:v1`;
    const { stdout } = await exec('docker', [
      'exec', redisContainer, 'redis-cli', 'DEL', cacheKey
    ], { timeout: 15_000 });
    assert.match(stdout.trim(), /^[01]$/);
    const statistics = await request(`${owner}/coding/statistics/job?version=v1`, 'POST');
    assert.equal(statistics.status, 201);
    assert.ok(typeof statistics.body.jobId === 'string' && statistics.body.jobId.length > 0);
    const statisticsId = encodeURIComponent(statistics.body.jobId);
    // Queue-local numeric IDs may collide; use the dedicated owner route.
    const statisticsPath = `/coding/statistics/job/${statisticsId}`;
    const completedStatistics = await pollCompleted(`${owner}${statisticsPath}`);
    assert.ok(completedStatistics.result && typeof completedStatistics.result === 'object');
    for (const foreignPath of [statisticsPath, `/coding/job/${statisticsId}`]) {
      const rejected = await request(`${other}${foreignPath}`);
      assert.equal(rejected.status, 200);
      assert.deepEqual(Object.keys(rejected.body), ['error']);
      assert.match(rejected.body.error, /not found/);
    }
    const ownerStatistics = await request(`${owner}${statisticsPath}`);
    assert.equal(ownerStatistics.status, 200);
    assert.deepEqual(ownerStatistics.body, completedStatistics);

    const deleted = await request(`${owner}${analysisPath}`, 'DELETE');
    assert.equal(deleted.status, 200);
    assert.equal(deleted.body.success, true);
    assert.equal((await request(`${owner}${analysisPath}`)).status, 404);
    assert.equal((await request(`${owner}${resultsPath}`)).status, 404);
    return {
      workspaceAccessVerified: true,
      foreignMutationsRejected: true,
      ownerResultsPreserved: true,
      statisticsReadsIsolated: true,
      ownerDeletionVerified: true
    };
  } finally {
    if (Number.isSafeInteger(otherWorkspaceId) && otherWorkspaceId > 0) {
      const cleanup = await request(`/admin/workspace?ids=${otherWorkspaceId}`, 'DELETE');
      assert.equal(cleanup.status, 200, 'Disposable second workspace must be cleaned up');
    }
  }
}
