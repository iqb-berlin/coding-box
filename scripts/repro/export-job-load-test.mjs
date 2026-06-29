#!/usr/bin/env node

/**
 * Repro/load helper for issue 815 export jobs.
 *
 * Example:
 * AUTH_TOKEN=... WORKSPACE_ID=5 MODE=parallel \
 *   node scripts/repro/export-job-load-test.mjs
 *
 * Optional:
 * - CANCEL_AFTER_MS=5000 CANCEL_JOB_INDEX=0 measures cancellation latency.
 * - DOWNLOAD_COMPLETED=false skips downloading completed export files.
 * - JOBS_JSON='[{"name":"csv","payload":{"exportType":"results-by-version","format":"csv","version":"v2"}}]'
 *   overrides the default export matrix.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const baseUrl = process.env.BASE_URL || 'http://localhost:3333/api';
const workspaceId = process.env.WORKSPACE_ID || '5';
const authToken = process.env.AUTH_TOKEN;
const mode = process.env.MODE || 'sequential';
const pollIntervalMs = Number.parseInt(process.env.POLL_INTERVAL_MS || '2000', 10);
const cancelAfterMs = process.env.CANCEL_AFTER_MS ?
  Number.parseInt(process.env.CANCEL_AFTER_MS, 10) :
  null;
const cancelJobIndex = Number.parseInt(process.env.CANCEL_JOB_INDEX || '0', 10);
const downloadCompleted = process.env.DOWNLOAD_COMPLETED !== 'false';
const downloadDir = process.env.DOWNLOAD_DIR ||
  path.join('/tmp', `kodierbox-export-load-${workspaceId}-${Date.now()}`);

const defaultJobs = [
  {
    name: 'results-by-version-excel',
    payload: {
      exportType: 'results-by-version',
      format: 'excel',
      version: 'v2',
      includeResponseValues: true
    }
  },
  {
    name: 'coding-list-excel',
    payload: {
      exportType: 'coding-list',
      format: 'excel'
    }
  },
  {
    name: 'item-matrix-excel',
    payload: {
      exportType: 'item-matrix',
      format: 'excel',
      version: 'v2',
      matrixValue: 'score'
    }
  }
];

const jobs = process.env.JOBS_JSON ?
  JSON.parse(process.env.JOBS_JSON) :
  defaultJobs;

if (!globalThis.fetch) {
  throw new Error('This script requires a Node.js version with global fetch support.');
}

if (!authToken) {
  throw new Error('AUTH_TOKEN is required. Example: AUTH_TOKEN=... node scripts/repro/export-job-load-test.mjs');
}

if (!Number.isInteger(pollIntervalMs) || pollIntervalMs <= 0) {
  throw new Error('POLL_INTERVAL_MS must be a positive integer.');
}

if (mode !== 'sequential' && mode !== 'parallel') {
  throw new Error('MODE must be either "sequential" or "parallel".');
}

async function requestJson(urlPath, options = {}) {
  const response = await fetch(`${baseUrl}${urlPath}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${authToken}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = text;
  }

  if (!response.ok) {
    throw new Error(`${options.method || 'GET'} ${urlPath} failed with ${response.status}: ${text}`);
  }

  return body;
}

async function startExportJob(jobDefinition) {
  const startedAt = performance.now();
  const body = await requestJson(
    `/admin/workspace/${workspaceId}/coding/export/start`,
    {
      method: 'POST',
      body: JSON.stringify(jobDefinition.payload)
    }
  );

  return {
    ...jobDefinition,
    jobId: String(body.jobId),
    startedAt,
    startRequestMs: performance.now() - startedAt,
    cancelledAt: null,
    cancelRequestMs: null
  };
}

async function getExportStatus(jobId) {
  return requestJson(`/admin/workspace/${workspaceId}/coding/export/job/${jobId}`);
}

async function cancelExportJob(jobId) {
  const startedAt = performance.now();
  const body = await requestJson(
    `/admin/workspace/${workspaceId}/coding/export/job/${jobId}/cancel`,
    { method: 'POST' }
  );
  return {
    body,
    requestMs: performance.now() - startedAt
  };
}

function sleep(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

function getDownloadFilename(response, fallback) {
  const contentDisposition = response.headers.get('content-disposition') || '';
  const filenameMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
  return filenameMatch?.[1] || fallback;
}

async function downloadExport(job) {
  const startedAt = performance.now();
  const response = await fetch(
    `${baseUrl}/admin/workspace/${workspaceId}/coding/export/job/${job.jobId}/download`,
    {
      headers: {
        Authorization: `Bearer ${authToken}`
      }
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`download for ${job.name} failed with ${response.status}: ${text}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.mkdir(downloadDir, { recursive: true });
  const filename = getDownloadFilename(response, `${job.name}-${job.jobId}.bin`);
  const filePath = path.join(downloadDir, filename);
  await fs.writeFile(filePath, buffer);

  return {
    bytes: buffer.length,
    filePath,
    downloadMs: performance.now() - startedAt
  };
}

async function waitForFinalStatus(job, index) {
  let lastStatus = null;
  let cancelRequested = false;
  const statuses = [];

  for (;;) {
    const elapsedMs = performance.now() - job.startedAt;

    if (
      cancelAfterMs !== null &&
      index === cancelJobIndex &&
      !cancelRequested &&
      elapsedMs >= cancelAfterMs
    ) {
      const cancelResult = await cancelExportJob(job.jobId);
      job.cancelledAt = performance.now();
      job.cancelRequestMs = cancelResult.requestMs;
      cancelRequested = true;
    }

    const status = await getExportStatus(job.jobId);
    lastStatus = status;
    statuses.push({
      atMs: Math.round(elapsedMs),
      status: status.status || 'unknown',
      progress: status.progress ?? null
    });

    if (['completed', 'failed', 'cancelled'].includes(status.status)) {
      break;
    }

    await sleep(pollIntervalMs);
  }

  const finishedAt = performance.now();
  const result = {
    name: job.name,
    jobId: job.jobId,
    status: lastStatus.status,
    progress: lastStatus.progress,
    generationMs: finishedAt - job.startedAt,
    startRequestMs: job.startRequestMs,
    cancelRequestMs: job.cancelRequestMs,
    result: lastStatus.result,
    error: lastStatus.error,
    statuses
  };

  if (downloadCompleted && lastStatus.status === 'completed') {
    Object.assign(result, await downloadExport(job));
  }

  return result;
}

function printSummary(results) {
  const rows = results.map(result => ({
    name: result.name,
    jobId: result.jobId,
    status: result.status,
    generationSeconds: (result.generationMs / 1000).toFixed(1),
    downloadSeconds: result.downloadMs === undefined ? '-' : (result.downloadMs / 1000).toFixed(1),
    bytes: result.bytes ?? result.result?.fileSize ?? '-'
  }));

  console.table(rows);
  console.log(JSON.stringify({
    baseUrl,
    workspaceId,
    mode,
    pollIntervalMs,
    cancelAfterMs,
    cancelJobIndex,
    downloadDir: downloadCompleted ? downloadDir : null,
    results
  }, null, 2));
}

async function runSequential() {
  const results = [];
  for (const [index, jobDefinition] of jobs.entries()) {
    const job = await startExportJob(jobDefinition);
    results.push(await waitForFinalStatus(job, index));
  }
  return results;
}

async function runParallel() {
  const startedJobs = await Promise.all(jobs.map(job => startExportJob(job)));
  return Promise.all(startedJobs.map((job, index) => waitForFinalStatus(job, index)));
}

const results = mode === 'parallel' ?
  await runParallel() :
  await runSequential();

printSummary(results);
