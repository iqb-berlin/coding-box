import { IsNull, Repository } from 'typeorm';
import * as ExcelJS from 'exceljs';
import { CodingTimesExportService } from './coding-times-export.service';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';
import { CodingListService } from './coding-list.service';
import { WorkspaceExclusionService } from '../workspace/workspace-exclusion.service';

type MockedRepo<T> = Partial<Record<keyof Repository<T>, jest.Mock>>;

describe('CodingTimesExportService', () => {
  it('limits coding time export reads to non-training jobs', async () => {
    const codingJobUnitRepository: MockedRepo<CodingJobUnit> = {
      find: jest.fn().mockResolvedValue([])
    };
    const codingListService = {
      getCodingListVariables: jest.fn().mockResolvedValue([])
    } as unknown as CodingListService;
    const workspaceExclusionService = {
      resolveExclusionsForQueries: jest.fn().mockResolvedValue({
        globalIgnoredUnits: [],
        ignoredBooklets: [],
        testletIgnoredUnits: []
      })
    } as unknown as WorkspaceExclusionService;
    const service = new CodingTimesExportService(
      codingJobUnitRepository as unknown as Repository<CodingJobUnit>,
      codingListService,
      workspaceExclusionService
    );

    await expect(service.exportCodingTimesReport(1)).resolves.toBeInstanceOf(Buffer);

    expect(codingJobUnitRepository.find).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        coding_job: expect.objectContaining({
          workspace_id: 1,
          training_id: IsNull()
        })
      })
    }));
  });

  it('keeps unit and variable labels separate when rendering coded rows', async () => {
    const codingJobUnitRepository: MockedRepo<CodingJobUnit> = {
      find: jest.fn().mockResolvedValue([{
        id: 1,
        variable_id: 'VAR',
        updated_at: new Date('2026-04-14T10:00:00.000Z'),
        code: 4,
        coding_job: {
          codingJobCoders: [{
            user: {
              username: 'Coder A'
            }
          }]
        },
        response: {
          unit: {
            name: 'UNIT',
            booklet: {
              bookletinfo: {
                name: 'BOOKLET-A'
              }
            }
          }
        }
      }])
    };
    const codingListService = {
      getCodingListVariables: jest.fn().mockResolvedValue([])
    } as unknown as CodingListService;
    const workspaceExclusionService = {
      resolveExclusionsForQueries: jest.fn().mockResolvedValue({
        globalIgnoredUnits: [],
        ignoredBooklets: [],
        testletIgnoredUnits: []
      })
    } as unknown as WorkspaceExclusionService;
    const service = new CodingTimesExportService(
      codingJobUnitRepository as unknown as Repository<CodingJobUnit>,
      codingListService,
      workspaceExclusionService
    );

    const buffer = await service.exportCodingTimesReport(1);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const worksheet = workbook.getWorksheet('Kodierzeiten-Bericht');

    expect(worksheet?.getRow(2).getCell(1).value).toBe('UNIT');
    expect(worksheet?.getRow(2).getCell(2).value).toBe('VAR');
  });
});
