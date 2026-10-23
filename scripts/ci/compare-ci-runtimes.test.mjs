import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareRuns, formatDuration, normalizeGitHub, normalizeGitLab, renderReport } from './compare-ci-runtimes.mjs';

const timestamp = seconds => new Date(Date.UTC(2026, 9, 22, 12, 0, seconds)).toISOString();
const githubRun = { id: 1, run_attempt: 2, head_sha: 'abc', html_url: 'https://github.com/example/run/1', status: 'completed', conclusion: 'success', created_at: timestamp(0) };
const gitlabPipeline = { id: 2, sha: 'abc', web_url: 'https://gitlab.example/pipelines/2', status: 'success', created_at: timestamp(0), finished_at: timestamp(100) };
const githubJob = overrides => ({ name: 'test-backend', run_attempt: 2, status: 'completed', conclusion: 'success', created_at: timestamp(10), started_at: timestamp(20), completed_at: timestamp(80), ...overrides });
const gitlabJob = overrides => ({ id: 3, name: 'test-backend', status: 'success', duration: 80, queued_duration: 5, created_at: timestamp(0), started_at: timestamp(10), finished_at: timestamp(90), ...overrides });
const github = () => normalizeGitHub(githubRun, [githubJob()]);
const gitlab = () => normalizeGitLab(gitlabPipeline, [gitlabJob()]);

test('wall time, execution span, runner use and waiting are distinct', () => {
  const result = github();
  assert.equal(result.wallSeconds, 80);
  assert.equal(result.initialWaitSeconds, 20);
  assert.equal(result.executionSpanSeconds, 60);
  assert.equal(result.jobs[0].durationSeconds, 60);
  assert.equal(result.jobs[0].schedulingDelaySeconds, 10);
  assert.equal(result.jobs[0].queueSeconds, null);
  assert.equal(gitlab().wallSeconds, 100);
  assert.equal(gitlab().jobs[0].queueSeconds, 5);
});

test('GitHub retries use only the requested attempt and exclude the reporting job', () => {
  const result = normalizeGitHub(githubRun, [
    githubJob({ run_attempt: 1, completed_at: timestamp(120) }), githubJob(),
    githubJob({ name: 'timings', completed_at: timestamp(150) })
  ]);
  assert.equal(result.jobs.length, 1);
  assert.equal(result.wallSeconds, 80);
});

test('GitLab retries choose the newest non-retried job regardless of API ordering', () => {
  const result = normalizeGitLab(gitlabPipeline, [
    gitlabJob({ id: 9, duration: 30 }), gitlabJob({ id: 8, duration: 40 }),
    gitlabJob({ id: 10, retried: true, duration: 99 })
  ]);
  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].durationSeconds, 30);
});

test('same successful revision and scope permit a measured comparison', () => {
  const result = compareRuns(github(), gitlab());
  assert.equal(result.eligible, true);
  assert.ok(Math.abs(result.wallChangePercent + 20) < 0.001);
  assert.equal(result.jobs[0].changePercent, -25);
});

test('different revisions suppress all improvement percentages', () => {
  const result = compareRuns({ ...github(), sha: 'other' }, gitlab());
  assert.equal(result.eligible, false);
  assert.equal(result.wallChangePercent, null);
  assert.equal(result.jobs[0].changePercent, null);
  assert.match(renderReport(result.github, result), /Different commit SHAs/);
});

test('incomplete and failed pipelines cannot be used as successful benchmarks', () => {
  for (const overrides of [{ complete: false, status: 'in_progress' }, { status: 'failure' }]) {
    const result = compareRuns({ ...github(), ...overrides }, gitlab());
    assert.equal(result.eligible, false);
    assert.equal(result.wallChangePercent, null);
    assert.equal(result.jobs[0].changePercent, null);
  }
});

test('different job scopes are listed and suppress total-duration claims', () => {
  const gh = github();
  gh.jobs.push({ name: 'extra-check', status: 'success', durationSeconds: 4 });
  const result = compareRuns(gh, gitlab());
  assert.deepEqual(result.onlyGitHub, ['extra-check']);
  assert.equal(result.wallChangePercent, null);
  assert.equal(result.jobs[0].changePercent, -25);
});

test('dependency scanner names are mapped across providers', () => {
  const gh = normalizeGitHub(githubRun, [githubJob({ name: 'dependency-scanning' })]);
  const gl = normalizeGitLab(gitlabPipeline, [gitlabJob({ name: 'gemnasium-dependency_scanning' })]);
  assert.equal(compareRuns(gh, gl).eligible, true);
});

test('unfinished jobs and absent timestamps remain unknown, not zero', () => {
  const gh = normalizeGitHub({ ...githubRun, status: 'in_progress' }, [githubJob({ completed_at: null, conclusion: null })]);
  assert.equal(gh.complete, false);
  assert.equal(gh.wallSeconds, null);
  assert.equal(gh.jobs[0].durationSeconds, null);
  assert.equal(formatDuration(null), '—');
  assert.equal(formatDuration(59.8), '1:00');
  assert.match(renderReport(gh), /provisional/);
});

test('parallel job durations do not become elapsed time', () => {
  const gh = normalizeGitHub(githubRun, [githubJob(), githubJob({ name: 'test-frontend' })]);
  const report = renderReport(gh);
  assert.equal(gh.wallSeconds, 80);
  assert.match(report, /2:00/);
  assert.match(report, /not elapsed time or billed minutes/);
});

test('absent completion timestamps never produce a false 100 percent improvement', () => {
  const gh = normalizeGitHub(githubRun, [githubJob({ completed_at: null })]);
  const result = compareRuns(gh, gitlab());
  assert.equal(result.wallChangePercent, null);
  assert.equal(result.jobs[0].changePercent, null);
});

test('timestamp ordering respects timezone offsets', () => {
  const gh = normalizeGitHub({ ...githubRun, created_at: '2026-10-22T11:00:00Z' }, [
    githubJob({ started_at: '2026-10-22T14:00:00+02:00', completed_at: '2026-10-22T14:10:00+02:00' }),
    githubJob({ name: 'other', started_at: '2026-10-22T11:30:00Z', completed_at: '2026-10-22T11:40:00Z' })
  ]);
  assert.equal(gh.initialWaitSeconds, 1800);
  assert.equal(gh.wallSeconds, 4200);
});


test('skipped jobs with synthetic timestamps do not change elapsed time or measured scope', () => {
  const result = normalizeGitHub(githubRun, [githubJob(), githubJob({
    name: 'production-images', conclusion: 'skipped',
    started_at: timestamp(200), completed_at: timestamp(100)
  })]);
  assert.equal(result.wallSeconds, 80);
  assert.deepEqual(result.jobs.map(job => job.name), ['test-backend']);
});
