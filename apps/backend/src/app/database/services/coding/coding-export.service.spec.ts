import { Repository } from 'typeorm';
import { CodingExportService } from './coding-export.service';
import { ResponseEntity } from '../../entities/response.entity';
import { CodingJob } from '../../entities/coding-job.entity';
import { CodingJobVariable } from '../../entities/coding-job-variable.entity';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';
import { CoderTrainingDiscussionResult } from '../../entities/coder-training-discussion-result.entity';
import User from '../../entities/user.entity';
import { CodingListService } from './coding-list.service';
import { WorkspaceCoreService } from '../workspace/workspace-core.service';
import { WorkspaceExclusionService } from '../workspace/workspace-exclusion.service';

type MockedRepo<T> = Partial<Record<keyof Repository<T>, jest.Mock>>;

function createServiceWithDetailedMocks(codingIssueOption: number) {
  const totalCountQueryBuilder = {
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getCount: jest.fn().mockResolvedValue(1)
  };

  const unitsBatchQueryBuilder = {
    innerJoinAndSelect: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([{
      code: 7,
      coding_issue_option: codingIssueOption,
      notes: '',
      updated_at: new Date('2026-04-14T10:00:00.000Z'),
      response_id: 123,
      unit_name: 'U1',
      variable_id: 'V1',
      coding_job: {
        training_id: null,
        codingJobCoders: [{ user: { username: 'coder1' } }]
      },
      response: {
        unit: {
          name: 'U1',
          booklet: {
            person: {
              login: 'p-login',
              code: 'p-code',
              group: 'G1'
            },
            bookletinfo: {
              name: 'B1'
            }
          }
        }
      }
    }])
  };

  const codingJobUnitRepository: MockedRepo<CodingJobUnit> = {
    createQueryBuilder: jest
      .fn()
      .mockReturnValueOnce(totalCountQueryBuilder)
      .mockReturnValueOnce(unitsBatchQueryBuilder)
  };

  const workspaceExclusionService = {
    resolveExclusionsForQueries: jest.fn().mockResolvedValue({
      globalIgnoredUnits: [],
      ignoredBooklets: [],
      testletIgnoredUnits: []
    })
  } as unknown as WorkspaceExclusionService;

  const service = new CodingExportService(
    {} as Repository<ResponseEntity>,
    {} as Repository<CodingJob>,
    {} as Repository<CodingJobVariable>,
    codingJobUnitRepository as unknown as Repository<CodingJobUnit>,
    {} as Repository<CoderTrainingDiscussionResult>,
    {} as Repository<User>,
    {} as CodingListService,
    {} as WorkspaceCoreService,
    workspaceExclusionService
  );

  return { service, totalCountQueryBuilder, unitsBatchQueryBuilder };
}

describe('CodingExportService (WS-Admin export smoke)', () => {
  it('keeps code value and writes code hint when coding_issue_option is set', async () => {
    const { service } = createServiceWithDetailedMocks(1);

    const buffer = await service.exportCodingResultsDetailed(1, false, false, false, false);
    const csv = buffer.toString('utf-8');

    expect(csv).toContain('"Code";"Code-Hinweis"');
    expect(csv).toContain('"7";"Code-Vergabe unsicher"');
  });

  it('normalizes negative coding_issue_option values in detailed export', async () => {
    const { service } = createServiceWithDetailedMocks(-1);

    const buffer = await service.exportCodingResultsDetailed(1, false, false, false, false);
    const csv = buffer.toString('utf-8');

    expect(csv).toContain('"7";"Code-Vergabe unsicher"');
  });
});
