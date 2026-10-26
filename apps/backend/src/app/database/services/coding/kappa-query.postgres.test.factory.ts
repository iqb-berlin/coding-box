import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import * as path from 'path';
import { DataSource } from 'typeorm';
import Workspace from '../../entities/workspace.entity';
import FileUpload from '../../entities/file_upload.entity';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';
import { CodingJob } from '../../entities/coding-job.entity';
import { JobDefinition } from '../../entities/job-definition.entity';
import { VariableBundle } from '../../entities/variable-bundle.entity';
import { MissingsProfile } from '../../entities/missings-profile.entity';
import { DoubleCodingReviewDecision } from '../../entities/double-coding-review-decision.entity';
import { WorkspaceExclusionService } from '../workspace/workspace-exclusion.service';
import { MissingsProfilesService } from './missings-profiles.service';
import { CodingStatisticsService } from './coding-statistics.service';
import { DoubleCodingReviewQueryService } from './double-coding-review-query.service';
import { CohensKappaStatisticsService } from './cohens-kappa-statistics.service';

/** Disposable database on an explicitly supplied PostgreSQL test server; never synchronize entities. */
export class KappaPostgresFixture {
  db: DataSource;
  private admin: DataSource;
  private databaseName = `kappa_query_${process.pid}_${Date.now()}`;
  query: DoubleCodingReviewQueryService;
  calculator = Object.create(CodingStatisticsService.prototype) as CodingStatisticsService;
  statistics: CohensKappaStatisticsService;

  async open(serverUrl: string): Promise<void> {
    this.admin = await new DataSource({ type: 'postgres', url: serverUrl }).initialize();
    await this.admin.query(`CREATE DATABASE "${this.databaseName}"`);
    const url = new URL(serverUrl);
    url.pathname = `/${this.databaseName}`;
    this.db = await new DataSource({
      type: 'postgres',
      url: url.toString(),
      synchronize: false,
      entities: [path.resolve(__dirname, '../../entities/*.entity.ts')],
      extra: { max: 2 }
    }).initialize();
    const root = path.resolve('database/changelog');
    const changelog = readFileSync(path.join(root, 'coding-box.changelog-root.xml'), 'utf8');
    for (const [, file] of changelog.matchAll(/<include file="([^"]+)"/g)) {
      const input = readFileSync(path.join(root, file), 'utf8').split(/^-- changeset /m).slice(1).map(chunk => {
        const end = chunk.indexOf('\n');
        const statements = chunk.slice(end + 1);
        return chunk.slice(0, end).includes('runInTransaction:false') ? statements : `BEGIN;\n${statements}\nCOMMIT;`;
      })
        .join('\n');
      execFileSync(process.env.PSQL_BIN || 'psql', [url.toString(), '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', '-'], { input, stdio: 'pipe' });
    }
    const cache = { get: async () => null, set: async () => undefined };
    const exclusions = new WorkspaceExclusionService(this.db.getRepository(Workspace), this.db.getRepository(FileUpload), cache as never);
    const missings = new MissingsProfilesService(this.db.getRepository(MissingsProfile), this.db.getRepository(CodingJob), this.db.getRepository(JobDefinition), cache as never);
    this.query = new DoubleCodingReviewQueryService(
      this.db.getRepository(CodingJobUnit),
      this.db.getRepository(JobDefinition),
      this.db.getRepository(VariableBundle),
      this.calculator,
      exclusions,
      {} as never,
      missings,
      this.db.getRepository(DoubleCodingReviewDecision)
    );
    this.statistics = new CohensKappaStatisticsService(this.query, this.calculator);
  }

  async close(): Promise<void> {
    if (this.db?.isInitialized) await this.db.destroy();
    if (this.admin?.isInitialized) {
      await this.admin.query(`DROP DATABASE IF EXISTS "${this.databaseName}" WITH (FORCE)`);
      await this.admin.destroy();
    }
  }

  async insert(table: string, values: Record<string, unknown>): Promise<number> {
    const columns = Object.keys(values);
    const rows = await this.db.query(
      `INSERT INTO public."${table}" (${columns.map(c => `"${c}"`).join(',')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`,
      Object.values(values)
    ) as { id: number }[];
    return rows[0].id;
  }

  async workspace(name: string): Promise<{ workspaceId: number; profileId: number }> {
    const workspaceId = await this.insert('workspace', { name });
    const profileId = await this.insert('missings_profile', {
      workspace_id: workspaceId,
      label: 'Kappa regression',
      missings: JSON.stringify([
        {
          id: 'mir', label: 'Missing', code: -98, score: 0
        },
        {
          id: 'mci', label: 'Invalid', code: -97, score: null
        },
        {
          id: 'omitted', label: 'Omitted', code: -99, score: 0
        }
      ])
    });
    return { workspaceId, profileId };
  }

  async job(workspaceId: number, profileId: number, coderId: number, extra: Record<string, unknown> = {}): Promise<number> {
    const id = await this.insert('coding_job', {
      workspace_id: workspaceId, missings_profile_id: profileId, name: `Job ${coderId}`, ...extra
    });
    await this.insert('coding_job_coder', { coding_job_id: id, user_id: coderId });
    return id;
  }

  async response(workspaceId: number, unitName: string, variableId: string, login: string): Promise<number> {
    const personId = await this.insert('persons', {
      workspace_id: workspaceId, group: 'group', login, code: 'person-code'
    });
    const [info] = await this.db.query("INSERT INTO bookletinfo(name) VALUES ('BOOKLET') ON CONFLICT (name,size) DO UPDATE SET name=excluded.name RETURNING id");
    const infoId = info.id;
    const bookletId = await this.insert('booklet', { personid: personId, infoid: infoId });
    const unitId = await this.insert('unit', { bookletid: bookletId, name: unitName });
    return this.insert('response', { unitid: unitId, variableid: variableId, status: 1 });
  }

  async result(jobId: number, responseId: number, unitName: string, variableId: string, extra: Record<string, unknown> = {}): Promise<void> {
    await this.insert('coding_job_unit', {
      coding_job_id: jobId,
      response_id: responseId,
      unit_name: unitName,
      variable_id: variableId,
      variable_anchor: `anchor-${variableId}`,
      booklet_name: 'BOOKLET',
      person_login: `person-${responseId}`,
      person_code: 'person-code',
      person_group: 'group',
      code: 0,
      score: 0,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      ...extra
    });
  }
}
