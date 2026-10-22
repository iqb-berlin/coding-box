import { execFileSync } from 'node:child_process';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const seconds = (start, end) => {
  if (!start || !end) return null;
  const value = (Date.parse(end) - Date.parse(start)) / 1000;
  return Number.isFinite(value) && value >= 0 ? value : null;
};
const sum = values => values.reduce((total, value) => total + (value ?? 0), 0);
const orderedTimes = values => values.filter(value => Number.isFinite(Date.parse(value)))
  .sort((left, right) => Date.parse(left) - Date.parse(right));
const minimum = values => orderedTimes(values)[0];
const maximum = values => orderedTimes(values).at(-1);

export function normalizeGitHub(run, jobs) {
  // Use a specific attempt. Never mix successful jobs from an earlier attempt.
  const attempt = run.run_attempt;
  const currentJobs = jobs.filter(job => job.run_attempt === undefined || job.run_attempt === attempt);
  const measuredJobs = currentJobs.filter(job => job.name !== 'timings' && job.started_at);
  const finished = maximum(measuredJobs.map(job => job.completed_at));
  const start = minimum(measuredJobs.map(job => job.started_at));
  return {
    provider: 'GitHub', id: run.id, attempt, sha: run.head_sha, url: run.html_url,
    status: run.status === 'completed' ? run.conclusion : run.status,
    complete: run.status === 'completed',
    createdAt: run.created_at,
    finishedAt: finished,
    // This excludes the reporting job itself, consistently on both providers.
    wallSeconds: seconds(run.created_at, finished),
    initialWaitSeconds: seconds(run.created_at, start),
    executionSpanSeconds: seconds(start, finished),
    jobs: measuredJobs.map(job => ({
      name: job.name.replace(/^production-images\s*\/\s*/, ''),
      status: job.conclusion || job.status,
      durationSeconds: seconds(job.started_at, job.completed_at),
      // GitHub does not expose GitLab's queued_duration. This includes dependencies.
      schedulingDelaySeconds: seconds(job.created_at, job.started_at),
      queueSeconds: null,
      url: job.html_url
    }))
  };
}

export function normalizeGitLab(pipeline, jobs) {
  const latest = new Map();
  for (const job of jobs) {
    if (job.retried) continue;
    if (!latest.has(job.name) || job.id > latest.get(job.name).id) latest.set(job.name, job);
  }
  const measuredJobs = [...latest.values()].filter(job => job.started_at);
  const complete = ['success', 'failed', 'canceled', 'skipped'].includes(pipeline.status);
  const start = minimum(measuredJobs.map(job => job.started_at));
  const finished = pipeline.finished_at || maximum(measuredJobs.map(job => job.finished_at));
  return {
    provider: 'GitLab', id: pipeline.id, sha: pipeline.sha, url: pipeline.web_url,
    status: pipeline.status, complete, createdAt: pipeline.created_at, finishedAt: finished,
    wallSeconds: seconds(pipeline.created_at, finished),
    initialWaitSeconds: seconds(pipeline.created_at, start),
    executionSpanSeconds: seconds(start, finished),
    jobs: measuredJobs.map(job => ({
      name: job.name, status: job.status, durationSeconds: job.duration,
      queueSeconds: job.queued_duration ?? null,
      schedulingDelaySeconds: seconds(job.created_at, job.started_at),
      url: job.web_url
    }))
  };
}

export function compareRuns(github, gitlab) {
  const warnings = [];
  const sameSha = github.sha === gitlab.sha;
  if (!sameSha) warnings.push('Different commit SHAs: these are reference values, not a controlled benchmark.');
  if (!github.complete || !gitlab.complete) warnings.push('At least one run is incomplete; timings are provisional.');
  if (github.status !== 'success' || gitlab.status !== 'success') warnings.push('Both runs must succeed before evaluating performance.');
  const alias = name => name === 'dependency-scanning' ? 'gemnasium-dependency_scanning' : name;
  const left = new Map(github.jobs.map(job => [alias(job.name), job]));
  const right = new Map(gitlab.jobs.map(job => [job.name, job]));
  const shared = [...right.keys()].filter(name => left.has(name));
  const onlyGitHub = [...left.keys()].filter(name => !right.has(name));
  const onlyGitLab = [...right.keys()].filter(name => !left.has(name));
  if (onlyGitHub.length || onlyGitLab.length) warnings.push('Job sets differ; inspect the scope differences before comparing total duration.');
  const successful = github.complete && gitlab.complete && github.status === 'success' && gitlab.status === 'success';
  const eligible = sameSha && successful && onlyGitHub.length === 0 && onlyGitLab.length === 0;
  return {
    github, gitlab, sameSha, eligible, warnings, onlyGitHub, onlyGitLab,
    wallChangePercent: eligible && Number.isFinite(github.wallSeconds) && gitlab.wallSeconds > 0
      ? (github.wallSeconds / gitlab.wallSeconds - 1) * 100 : null,
    jobs: shared.map(name => ({
      name, github: left.get(name), gitlab: right.get(name),
      changePercent: sameSha && successful && left.get(name).status === 'success' && right.get(name).status === 'success' && Number.isFinite(left.get(name).durationSeconds) && right.get(name).durationSeconds > 0
        ? (left.get(name).durationSeconds / right.get(name).durationSeconds - 1) * 100 : null
    }))
  };
}

export function formatDuration(value) {
  if (!Number.isFinite(value)) return '—';
  const rounded = Math.round(value);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
}

export function renderReport(github, comparison) {
  const lines = ['# CI runtime measurements', ''];
  const runs = comparison ? [comparison.gitlab, github] : [github];
  lines.push('| Provider | Revision | State | Wall time | Initial wait | Execution span | Sum of completed job runtimes |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: |');
  for (const run of runs) lines.push(`| [${run.provider} ${run.id}](${run.url}) | ${run.sha} | ${run.status}${run.complete ? '' : ' (provisional)'} | ${formatDuration(run.wallSeconds)} | ${formatDuration(run.initialWaitSeconds)} | ${formatDuration(run.executionSpanSeconds)} | ${formatDuration(sum(run.jobs.map(job => job.durationSeconds)))} |`);
  lines.push('', 'Wall time runs from pipeline creation to completion of the measured jobs. The reporting job is excluded. The sum of job runtimes is runner usage, not elapsed time or billed minutes.', '',
    'GitLab exposes runner queue duration. GitHub scheduling delay also includes dependencies and must not be presented as equivalent queue time.', '');
  if (comparison) {
    for (const warning of comparison.warnings) lines.push(`- ${warning}`);
    if (comparison.wallChangePercent !== null) lines.push(`\nWall-time change (GitHub versus GitLab): ${comparison.wallChangePercent.toFixed(1)}%.`);
    lines.push('', '| Shared job | GitLab runtime | GitHub runtime | GitLab runner queue | Change |', '| --- | ---: | ---: | ---: | ---: |');
    for (const job of comparison.jobs) lines.push(`| ${job.name} | ${formatDuration(job.gitlab.durationSeconds)} | ${formatDuration(job.github.durationSeconds)} | ${formatDuration(job.gitlab.queueSeconds)} | ${job.changePercent === null ? '—' : `${job.changePercent.toFixed(1)}%`} |`);
    lines.push('', `GitHub-only jobs: ${comparison.onlyGitHub.join(', ') || 'none'}.`, '', `GitLab-only jobs: ${comparison.onlyGitLab.join(', ') || 'none'}.`);
  } else {
    lines.push('| Job | State | Runtime | Scheduling/dependency delay |', '| --- | --- | ---: | ---: |');
    for (const job of github.jobs) lines.push(`| ${job.name} | ${job.status} | ${formatDuration(job.durationSeconds)} | ${formatDuration(job.schedulingDelaySeconds)} |`);
    lines.push('', 'No GitLab run supplied; no cross-provider performance claim is available.');
  }
  return `${lines.join('\n')}\n`;
}

function githubApi(endpoint, paginate = false) {
  const args = ['api', endpoint];
  if (paginate) args.push('--paginate', '--slurp');
  return JSON.parse(execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
}

async function gitlabApi(base, endpoint, token) {
  const response = await fetch(`${base.replace(/\/$/, '')}/api/v4/${endpoint}`, {
    headers: token ? { 'PRIVATE-TOKEN': token } : {},
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) throw new Error(`GitLab API returned HTTP ${response.status}.`);
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('GitLab returned non-JSON data (possibly bot protection). Use an authenticated JSON export via --gitlab-file.');
  }
  return { data: await response.json(), next: response.headers.get('x-next-page') };
}

export async function main(args) {
  const options = {};
  const allowed = new Set(['github-run', 'repository', 'gitlab-pipeline', 'gitlab-host', 'gitlab-project', 'gitlab-file', 'output']);
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index].replace(/^--/, '');
    if (!allowed.has(key) || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`Invalid argument: ${args[index]}`);
    options[key] = args[index + 1];
  }
  if (!/^\d+$/.test(options['github-run'] || '')) throw new Error('Supply --github-run RUN_ID.');
  const repository = options.repository || process.env.GITHUB_REPOSITORY || 'iqb-berlin/coding-box';
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('Invalid repository.');
  const endpoint = `repos/${repository}/actions/runs/${options['github-run']}`;
  const run = githubApi(endpoint);
  const pages = githubApi(`${endpoint}/attempts/${run.run_attempt}/jobs?per_page=100`, true);
  const jobs = pages.flatMap(page => page.jobs);
  const github = normalizeGitHub(run, jobs);
  let gitlab;
  if (options['gitlab-file']) {
    const bundle = JSON.parse(await readFile(options['gitlab-file'], 'utf8'));
    gitlab = normalizeGitLab(bundle.pipeline, bundle.jobs);
  } else if (options['gitlab-pipeline']) {
    if (!/^\d+$/.test(options['gitlab-pipeline'])) throw new Error('Invalid GitLab pipeline ID.');
    const host = options['gitlab-host'] || 'https://scm.cms.hu-berlin.de';
    if (new URL(host).protocol !== 'https:') throw new Error('GitLab requires HTTPS.');
    const project = encodeURIComponent(options['gitlab-project'] || 'iqb/coding-box');
    const token = process.env.GITLAB_TOKEN;
    const prefix = `projects/${project}/pipelines/${options['gitlab-pipeline']}`;
    const { data: pipeline } = await gitlabApi(host, prefix, token);
    const gitlabJobs = [];
    let page = '1';
    while (page) {
      const result = await gitlabApi(host, `${prefix}/jobs?per_page=100&include_retried=false&page=${page}`, token);
      gitlabJobs.push(...result.data);
      page = result.next;
    }
    gitlab = normalizeGitLab(pipeline, gitlabJobs);
  }
  const comparison = gitlab ? compareRuns(github, gitlab) : undefined;
  const markdown = renderReport(github, comparison);
  const output = path.resolve(options.output || 'tmp/ci-timings');
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'report.md'), markdown);
  await writeFile(path.join(output, 'timings.json'), `${JSON.stringify(comparison || { github }, null, 2)}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown);
  process.stdout.write(markdown);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
