import { DataSource } from 'typeorm';
import { CodingResetPreviewService } from './coding-reset-preview.service';

describe('CodingResetPreviewService', () => {
  const scope = { version: 'v2' as const, unitFilters: ['DHB003'], variableFilters: ['V1'] };
  const builder = {
    leftJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    getRawOne: jest.fn()
  };
  const manager = { query: jest.fn(), getRepository: jest.fn(() => ({ createQueryBuilder: () => builder })) };
  const transaction = jest.fn(async (_isolation, run) => run(manager));
  const service = new CodingResetPreviewService({ transaction } as unknown as DataSource);

  beforeEach(() => {
    jest.clearAllMocks();
    manager.query.mockResolvedValue([]);
    builder.getRawOne.mockResolvedValue({ affected: '1234567', reset: '1234566', deleted: '2' });
  });

  it('uses a bounded read-only snapshot and aggregates without loading response rows', async () => {
    await expect(service.preview(5, scope)).resolves.toMatchObject({
      status: 'valid', affectedResponseCount: 1234567, resetResponseCount: 1234566, deletedGeneratedResponseCount: 2
    });
    expect(transaction).toHaveBeenCalledWith('REPEATABLE READ', expect.any(Function));
    expect(manager.query).toHaveBeenCalledWith('SET TRANSACTION READ ONLY');
    expect(manager.query).toHaveBeenCalledWith("SET LOCAL statement_timeout = '120s'");
    expect(builder.andWhere).toHaveBeenCalledWith('unit.name IN (:...unitNames)', { unitNames: ['DHB003'] });
    expect(builder.andWhere).toHaveBeenCalledWith('response.variableid IN (:...variableIds)', { variableIds: ['V1'] });
    expect(builder.addSelect).toHaveBeenCalledWith(expect.stringContaining('response.code_v2 != -111'), 'reset');
  });

  it('does not count when a unit does not exist and uses bound values for filter checks', async () => {
    manager.query.mockImplementation(async sql => (sql.includes('unnest') ? [{ value: 'unknown' }] : []));
    await expect(service.preview(5, scope)).resolves.toMatchObject({
      status: 'invalid-filters', unknownUnits: ['unknown'], affectedResponseCount: null
    });
    expect(builder.getRawOne).not.toHaveBeenCalled();
    expect(manager.query).toHaveBeenCalledWith(expect.stringContaining('WHERE NOT EXISTS'), [5, ['DHB003']]);
  });

  it('checks variable existence inside the selected units and skips global existence scans', async () => {
    manager.query.mockImplementation(async sql => (sql.includes('JOIN response r') ? [{ value: 'V1' }] : []));
    await expect(service.preview(5, scope)).resolves.toMatchObject({ status: 'invalid-filters', unknownVariables: ['V1'] });
    expect(manager.query).toHaveBeenCalledWith(expect.stringContaining('u.name = ANY($3::text[])'), [5, ['V1'], ['DHB003']]);
    expect(builder.getRawOne).not.toHaveBeenCalled();
    manager.query.mockClear().mockResolvedValue([]);
    await service.preview(5, { version: 'v1', unitFilters: [], variableFilters: [] });
    expect(manager.query).toHaveBeenCalledTimes(2);
  });
});
