import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { BookletLog } from '../apps/backend/src/app/database/entities/bookletLog.entity';
import { Booklet } from '../apps/backend/src/app/database/entities/booklet.entity';
import { BookletInfo } from '../apps/backend/src/app/database/entities/bookletInfo.entity';
import { ChunkEntity } from '../apps/backend/src/app/database/entities/chunk.entity';
import { CodingJobCoder } from '../apps/backend/src/app/database/entities/coding-job-coder.entity';
import { CodingJobUnit } from '../apps/backend/src/app/database/entities/coding-job-unit.entity';
import { CodingJobVariableBundle } from '../apps/backend/src/app/database/entities/coding-job-variable-bundle.entity';
import { CodingJobVariable } from '../apps/backend/src/app/database/entities/coding-job-variable.entity';
import { CodingJob } from '../apps/backend/src/app/database/entities/coding-job.entity';
import { CoderTrainingBundle } from '../apps/backend/src/app/database/entities/coder-training-bundle.entity';
import { CoderTrainingCoder } from '../apps/backend/src/app/database/entities/coder-training-coder.entity';
import { CoderTrainingDiscussionResult } from '../apps/backend/src/app/database/entities/coder-training-discussion-result.entity';
import { CoderTrainingVariable } from '../apps/backend/src/app/database/entities/coder-training-variable.entity';
import { CoderTraining } from '../apps/backend/src/app/database/entities/coder-training.entity';
import FileUpload from '../apps/backend/src/app/database/entities/file_upload.entity';
import { JobDefinition } from '../apps/backend/src/app/database/entities/job-definition.entity';
import { Job } from '../apps/backend/src/app/database/entities/job.entity';
import { JournalEntry } from '../apps/backend/src/app/database/entities/journal-entry.entity';
import Logs from '../apps/backend/src/app/database/entities/logs.entity';
import { MissingsProfile } from '../apps/backend/src/app/database/entities/missings-profile.entity';
import Persons from '../apps/backend/src/app/database/entities/persons.entity';
import { ReplayStatistics } from '../apps/backend/src/app/database/entities/replay-statistics.entity';
import ResourcePackage from '../apps/backend/src/app/database/entities/resource-package.entity';
import { ResponseEntity } from '../apps/backend/src/app/database/entities/response.entity';
import { Session } from '../apps/backend/src/app/database/entities/session.entity';
import { Setting } from '../apps/backend/src/app/database/entities/setting.entity';
import { Unit } from '../apps/backend/src/app/database/entities/unit.entity';
import { UnitLastState } from '../apps/backend/src/app/database/entities/unitLastState.entity';
import { UnitLog } from '../apps/backend/src/app/database/entities/unitLog.entity';
import { UnitNote } from '../apps/backend/src/app/database/entities/unitNote.entity';
import { UnitTag } from '../apps/backend/src/app/database/entities/unitTag.entity';
import User from '../apps/backend/src/app/database/entities/user.entity';
import { ValidationTask } from '../apps/backend/src/app/database/entities/validation-task.entity';
import { VariableAnalysisJob } from '../apps/backend/src/app/database/entities/variable-analysis-job.entity';
import { VariableBundle } from '../apps/backend/src/app/database/entities/variable-bundle.entity';
import WorkspaceAdmin from '../apps/backend/src/app/database/entities/workspace-admin.entity';
import WorkspaceUser from '../apps/backend/src/app/database/entities/workspace_user.entity';
import Workspace from '../apps/backend/src/app/database/entities/workspace.entity';
import { ReplayHealthRunner } from '../apps/backend/src/app/replay-health/replay-health.runner';
import { ReplayHealthCheckOptions } from '../apps/backend/src/app/replay-health/replay-health.types';

type CliArgs = ReplayHealthCheckOptions & {
  output?: string;
};

function printHelp(): void {
  console.log(`Replay health check for Kodierbox workspaces.

Usage:
  nx run backend:replay-health --workspaceId=12
  nx run backend:replay-health --workspaceId=12 --limit=500
  nx run backend:replay-health --workspaceId=12 --responseIds=101,202 --output=tmp/replay-health.json
  nx run backend:replay-health --workspaceId=12 --browser --baseUrl=https://coding.example.org --authToken=... --output=tmp/replay-health.json
  nx run backend:replay-health --workspaceId=12 --browser --baseUrl=https://coding.example.org --authIdentity=my-user-id

Options:
  --workspaceId   Required workspace id
  --limit         Optional limit for the number of response candidates
  --responseIds   Optional comma-separated response ids
  --output        Optional path for a JSON report
  --browser       Also open the real replay URLs in Chromium
  --baseUrl       Frontend base URL for browser mode, e.g. https://coding.example.org
  --authToken     Existing JWT for browser mode
  --authIdentity  User identity to mint a JWT for browser mode
  --authTokenDays Token lifetime in days when --authIdentity is used (default: 1)
  --browserConcurrency  Number of parallel browser pages (default: 3)
  --browserTimeoutMs    Browser timeout per replay (default: 30000)
  --screenshotsDir      Optional directory for failure screenshots
  --headed        Run Chromium with UI instead of headless
  --help          Show this help
`);
}

function getArgValue(args: string[], name: string): string | undefined {
  const directPrefix = `--${name}=`;
  const directMatch = args.find(arg => arg.startsWith(directPrefix));
  if (directMatch) {
    return directMatch.substring(directPrefix.length);
  }

  const index = args.indexOf(`--${name}`);
  if (index >= 0 && index + 1 < args.length) {
    return args[index + 1];
  }

  return undefined;
}

function parseResponseIds(value: string | undefined): number[] | undefined {
  if (!value) {
    return undefined;
  }

  const ids = value
    .split(',')
    .map(part => parseInt(part.trim(), 10))
    .filter(id => !Number.isNaN(id));

  return ids.length > 0 ? ids : undefined;
}

function parseArgs(args: string[]): CliArgs {
  if (args.includes('--help')) {
    printHelp();
    process.exit(0);
  }

  const workspaceId = parseInt(getArgValue(args, 'workspaceId') || '', 10);
  if (!Number.isInteger(workspaceId) || workspaceId <= 0) {
    throw new Error('Missing or invalid --workspaceId argument.');
  }

  const limitRaw = getArgValue(args, 'limit');
  const limit = limitRaw ? parseInt(limitRaw, 10) : undefined;
  if (limitRaw && (!Number.isInteger(limit) || limit <= 0)) {
    throw new Error('Invalid --limit argument.');
  }

  const browserEnabled = args.includes('--browser');
  const baseUrl = getArgValue(args, 'baseUrl');
  const authToken = getArgValue(args, 'authToken');
  const authIdentity = getArgValue(args, 'authIdentity');
  const authTokenDaysRaw = getArgValue(args, 'authTokenDays');
  const authTokenDays = authTokenDaysRaw ?
    parseInt(authTokenDaysRaw, 10) :
    1;
  if (authTokenDaysRaw && (!Number.isInteger(authTokenDays) || authTokenDays <= 0)) {
    throw new Error('Invalid --authTokenDays argument.');
  }

  const browserConcurrencyRaw = getArgValue(args, 'browserConcurrency');
  const browserConcurrency = browserConcurrencyRaw ?
    parseInt(browserConcurrencyRaw, 10) :
    3;
  if (
    browserConcurrencyRaw &&
    (!Number.isInteger(browserConcurrency) || browserConcurrency <= 0)
  ) {
    throw new Error('Invalid --browserConcurrency argument.');
  }

  const browserTimeoutRaw = getArgValue(args, 'browserTimeoutMs');
  const browserTimeoutMs = browserTimeoutRaw ?
    parseInt(browserTimeoutRaw, 10) :
    30000;
  if (browserTimeoutRaw && (!Number.isInteger(browserTimeoutMs) || browserTimeoutMs <= 0)) {
    throw new Error('Invalid --browserTimeoutMs argument.');
  }

  if (browserEnabled && !baseUrl) {
    throw new Error('Missing --baseUrl argument for browser mode.');
  }
  if (browserEnabled && !authToken && !authIdentity) {
    throw new Error('Browser mode requires either --authToken or --authIdentity.');
  }

  return {
    workspaceId,
    limit,
    responseIds: parseResponseIds(getArgValue(args, 'responseIds')),
    output: getArgValue(args, 'output'),
    browser: browserEnabled ? {
      enabled: true,
      baseUrl: baseUrl || '',
      authIdentity,
      authToken,
      authTokenDays,
      concurrency: browserConcurrency,
      timeoutMs: browserTimeoutMs,
      headless: !args.includes('--headed'),
      screenshotDir: getArgValue(args, 'screenshotsDir')
    } : undefined
  };
}

function loadEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, 'utf8');
  content.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      return;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) {
      return;
    }

    const key = trimmed.substring(0, separatorIndex).trim();
    const value = trimmed.substring(separatorIndex + 1).trim();

    if (!(key in process.env)) {
      process.env[key] = value.replace(/^["']|["']$/g, '');
    }
  });
}

function loadEnvironment(): void {
  loadEnvFile(path.resolve(process.cwd(), '.env.dev'));
  loadEnvFile(path.resolve(process.cwd(), '.env.coding-box'));
}

function createDataSource(): DataSource {
  const port = parseInt(process.env.POSTGRES_PORT || '5432', 10);

  return new DataSource({
    type: 'postgres',
    host: process.env.POSTGRES_HOST || 'localhost',
    port: Number.isInteger(port) ? port : 5432,
    username: process.env.POSTGRES_USER || 'root',
    password: process.env.POSTGRES_PASSWORD || '',
    database: process.env.POSTGRES_DB || 'coding-box',
    synchronize: false,
    entities: [
      BookletInfo,
      ResponseEntity,
      User,
      Workspace,
      WorkspaceAdmin,
      ResourcePackage,
      Logs,
      Persons,
      ChunkEntity,
      UnitTag,
      UnitNote,
      JournalEntry,
      Job,
      VariableAnalysisJob,
      ValidationTask,
      Setting,
      ReplayStatistics,
      VariableBundle,
      CodingJob,
      CodingJobCoder,
      CodingJobVariable,
      CodingJobVariableBundle,
      CodingJobUnit,
      JobDefinition,
      CoderTraining,
      CoderTrainingVariable,
      CoderTrainingBundle,
      CoderTrainingCoder,
      CoderTrainingDiscussionResult,
      MissingsProfile,
      Session,
      BookletLog,
      Unit,
      Booklet,
      FileUpload,
      UnitLog,
      UnitLastState,
      WorkspaceUser
    ]
  });
}

function printSummary(
  args: CliArgs,
  reportPath: string | undefined,
  report: Awaited<ReturnType<ReplayHealthRunner['run']>>
): void {
  console.log('');
  console.log('Replay health check summary');
  console.log(`Workspace: ${args.workspaceId}`);
  console.log(`Response candidates: ${report.responseCandidateCount}`);
  console.log(`Payload candidates: ${report.payloadCandidateCount}`);
  console.log(`Successful payloads: ${report.payloadSuccessCount}`);
  console.log(`Failed payloads: ${report.payloadFailureCount}`);

  if (args.browser?.enabled) {
    console.log(`Browser candidates: ${report.browserCandidateCount}`);
    console.log(`Successful browser checks: ${report.browserSuccessCount}`);
    console.log(`Failed browser checks: ${report.browserFailureCount}`);
  }

  console.log(`Overall successes: ${report.successCount}`);
  console.log(`Overall failures: ${report.failureCount}`);

  if (Object.keys(report.failuresByStage).length > 0) {
    console.log('');
    console.log('Failures by stage:');
    Object.entries(report.failuresByStage)
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .forEach(([stage, count]) => {
        console.log(`- ${stage}: ${count}`);
      });
  }

  if (report.failuresByMessage.length > 0) {
    console.log('');
    console.log('Top failure messages:');
    report.failuresByMessage.slice(0, 10).forEach(item => {
      console.log(`- ${item.count}x ${item.message}`);
    });
  }

  if (reportPath) {
    console.log('');
    console.log(`Report written to ${reportPath}`);
  }
}

async function main(): Promise<void> {
  loadEnvironment();

  const args = parseArgs(process.argv.slice(2));
  const dataSource = createDataSource();

  try {
    await dataSource.initialize();
    const runner = new ReplayHealthRunner(dataSource);
    const report = await runner.run(args);

    let reportPath: string | undefined;
    if (args.output) {
      reportPath = path.resolve(process.cwd(), args.output);
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    }

    printSummary(args, reportPath, report);

    if (report.failureCount > 0) {
      process.exitCode = 1;
    }
  } finally {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  }
}

main().catch(error => {
  console.error(`Replay health check failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
