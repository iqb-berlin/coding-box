import * as path from 'node:path';
import { DataSource } from 'typeorm';
import Workspace from '../../entities/workspace.entity';
import FileUpload from '../../entities/file_upload.entity';
import { DoubleCodingReviewDecision } from '../../entities/double-coding-review-decision.entity';
import { VariableBundle } from '../../entities/variable-bundle.entity';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';
import { JobDefinition } from '../../entities/job-definition.entity';
import { CodingJob } from '../../entities/coding-job.entity';
import { MissingsProfile } from '../../entities/missings-profile.entity';
import { KappaPostgresFixture } from './kappa-query.postgres.test.factory';
import { DoubleCodingReviewQueryService } from './double-coding-review-query.service';
import { MissingsProfilesService } from './missings-profiles.service';
import { WorkspaceExclusionService } from '../workspace/workspace-exclusion.service';

const serverUrl = process.env.KAPPA_QUERY_TEST_DATABASE_URL;
const describePostgres = serverUrl ? describe : describe.skip;

describePostgres('Kappa cursor connection budget', () => {
  const fixture = new KappaPostgresFixture();
  let workspaceId: number;
  beforeAll(async () => {
    await fixture.open(serverUrl!);
    const workspace = await fixture.workspace('Cursor pool');
    workspaceId = workspace.workspaceId;
    const coder = await fixture.insert('user', { username: 'Coder', identity: 'cursor', issuer: 'test' });
    const customJob = await fixture.job(workspaceId, workspace.profileId, coder);
    const defaultJob = await fixture.job(workspaceId, workspace.profileId, coder, { missings_profile_id: null });
    for (const [variable, job, code] of [['MIR', customJob, -3], ['OMITTED', customJob, -99], ['DEFAULT', defaultJob, -4]] as const) {
      const response = await fixture.response(workspaceId, 'UNIT', variable, variable);
      await fixture.result(job, response, 'UNIT', variable, { code, score: null });
    }
  }, 60000);
  afterAll(async () => fixture.close());

  it.each([[1, 1], [10, 10]])('completes %i pool connections with %i simultaneous calls', async (max, calls) => {
    const db = await new DataSource({
      type: 'postgres',
      url: (fixture.db.options as { url: string }).url,
      synchronize: false,
      entities: [path.resolve(__dirname, '../../entities/*.entity.ts')],
      extra: { max, connectionTimeoutMillis: 1000, options: '-c idle_in_transaction_session_timeout=2000' }
    }).initialize();
    try {
      const cache = { get: async () => null, set: async () => undefined };
      const missingProfiles = new MissingsProfilesService(db.getRepository(MissingsProfile), db.getRepository(CodingJob), db.getRepository(JobDefinition), cache as never);
      const exclusions = new WorkspaceExclusionService(db.getRepository(Workspace), db.getRepository(FileUpload), cache as never);
      const service = new DoubleCodingReviewQueryService(
        db.getRepository(CodingJobUnit), db.getRepository(JobDefinition), db.getRepository(VariableBundle), {} as never, exclusions, {} as never, missingProfiles, db.getRepository(DoubleCodingReviewDecision)
      );
      const results = await Promise.all(Array.from({ length: calls }, () => service.getCodedVariablesForKappa(workspaceId)));
      for (const result of results) {
        expect(result.map(item => [item.variableId, item.coderResults[0].code, item.coderResults[0].score])).toEqual([
          ['DEFAULT', -97, null], ['MIR', -98, 0], ['OMITTED', -99, 0]
        ]);
      }
      const [state] = await db.query(`SELECT count(*)::int AS active FROM pg_stat_activity
        WHERE datname=current_database() AND state='idle in transaction'`);
      expect(state.active).toBe(0);
      const [defaults] = await db.query("SELECT count(*)::int AS count FROM missings_profile WHERE workspace_id=$1 AND label='IQB-Standard'", [workspaceId]);
      expect(defaults.count).toBe(0);
    } finally { await db.destroy(); }
  }, 15000);
});
