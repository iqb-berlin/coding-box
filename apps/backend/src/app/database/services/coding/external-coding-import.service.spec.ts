import { ExternalCodingImportService } from './external-coding-import.service';
import { statusStringToNumber } from '../../utils/response-status-converter';

const createQueryBuilder = (result: unknown = []) => {
  const qb: Record<string, jest.Mock> = {};
  [
    'leftJoinAndSelect',
    'andWhere',
    'setParameters',
    'update',
    'set',
    'where'
  ].forEach(method => {
    qb[method] = jest.fn().mockReturnValue(qb);
  });
  qb.getMany = jest.fn().mockResolvedValue(result);
  qb.execute = jest.fn().mockResolvedValue({ affected: 1 });
  return qb;
};

describe('ExternalCodingImportService', () => {
  it('updates responses and manual freshness in one transaction', async () => {
    const selectQuery = createQueryBuilder([{
      id: 99,
      status_v2: null,
      code_v2: null,
      score_v2: null,
      unit: { id: 7, name: 'UNIT', alias: 'UNIT' }
    }]);
    const updateQuery = createQueryBuilder();
    const transactionalResponseRepository = {
      createQueryBuilder: jest.fn()
        .mockReturnValueOnce(selectQuery)
        .mockReturnValueOnce(updateQuery)
    };
    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      manager: {
        query: jest.fn().mockResolvedValue([]),
        getRepository: jest.fn().mockReturnValue(transactionalResponseRepository)
      }
    };
    const responseRepository = {
      manager: {
        connection: {
          createQueryRunner: jest.fn().mockReturnValue(queryRunner)
        }
      }
    };
    const cacheService = { delete: jest.fn().mockResolvedValue(undefined) };
    const codingFreshnessService = {
      markManualCodingCurrent: jest.fn().mockResolvedValue(undefined)
    };
    const service = new ExternalCodingImportService(
      responseRepository as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      cacheService as never,
      codingFreshnessService as never
    );
    jest.spyOn(service as unknown as {
      validateCodeAgainstScheme: () => Promise<unknown>;
    }, 'validateCodeAgainstScheme')
      .mockResolvedValue({
        isValid: true,
        score: 1,
        status: 'CODING_COMPLETE'
      });

    const result = await service.importExternalCoding(17, {
      file: Buffer.from('unit_key,variable_id,code\nUNIT,VAR,1\n').toString('base64'),
      fileName: 'coding.csv',
      previewOnly: false
    });

    expect(result.updatedRows).toBe(1);
    expect(queryRunner.startTransaction).toHaveBeenCalledWith('READ COMMITTED');
    expect(queryRunner.manager.query).toHaveBeenCalledWith(
      expect.stringContaining('pg_advisory_xact_lock'),
      [expect.any(Number), 17]
    );
    expect(updateQuery.set).toHaveBeenCalledWith({
      status_v2: statusStringToNumber('CODING_COMPLETE'),
      code_v2: 1,
      score_v2: 1
    });
    expect(codingFreshnessService.markManualCodingCurrent).toHaveBeenCalledWith(
      17,
      [99],
      { clearCoveredReviewJobs: true, manager: queryRunner.manager }
    );
    expect(queryRunner.manager.query.mock.invocationCallOrder[0])
      .toBeLessThan(updateQuery.set.mock.invocationCallOrder[0]);
    expect(queryRunner.manager.query.mock.invocationCallOrder[0])
      .toBeLessThan(codingFreshnessService.markManualCodingCurrent.mock.invocationCallOrder[0]);
    expect(queryRunner.commitTransaction).toHaveBeenCalled();
    expect(queryRunner.rollbackTransaction).not.toHaveBeenCalled();
    expect(queryRunner.release).toHaveBeenCalled();
    expect(cacheService.delete).toHaveBeenCalledWith('coding_incomplete_variables_v5:17');
  });

  it('imports DERIVE_ERROR without turning it into completed false coding', async () => {
    const selectQuery = createQueryBuilder([{
      id: 550,
      status_v1: statusStringToNumber('DERIVE_ERROR'),
      status_v2: null,
      code_v1: null,
      code_v2: null,
      score_v1: null,
      score_v2: null,
      unit: { id: 7, name: 'UNIT', alias: 'UNIT' }
    }]);
    const updateQuery = createQueryBuilder();
    const transactionalResponseRepository = {
      createQueryBuilder: jest.fn()
        .mockReturnValueOnce(selectQuery)
        .mockReturnValueOnce(updateQuery)
    };
    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      manager: {
        query: jest.fn().mockResolvedValue([]),
        getRepository: jest.fn().mockReturnValue(transactionalResponseRepository)
      }
    };
    const responseRepository = {
      manager: {
        connection: {
          createQueryRunner: jest.fn().mockReturnValue(queryRunner)
        }
      }
    };
    const cacheService = { delete: jest.fn().mockResolvedValue(undefined) };
    const codingFreshnessService = {
      markManualCodingCurrent: jest.fn().mockResolvedValue(undefined)
    };
    const service = new ExternalCodingImportService(
      responseRepository as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      cacheService as never,
      codingFreshnessService as never
    );
    jest.spyOn(service as unknown as {
      validateCodeAgainstScheme: () => Promise<unknown>;
    }, 'validateCodeAgainstScheme')
      .mockResolvedValue({
        isValid: false,
        score: null,
        status: 'CODING_INCOMPLETE'
      });

    const result = await service.importExternalCoding(17, {
      file: Buffer.from('unit_key,variable_id,status\nUNIT,VAR,DERIVE_ERROR\n').toString('base64'),
      fileName: 'coding.csv',
      previewOnly: false
    });

    expect(result.updatedRows).toBe(1);
    expect(updateQuery.set).toHaveBeenCalledWith({
      status_v2: statusStringToNumber('DERIVE_ERROR'),
      code_v2: null,
      score_v2: null
    });
    expect(result.affectedRows[0]).toMatchObject({
      originalCodedStatus: 'DERIVE_ERROR',
      originalCode: null,
      originalScore: null,
      updatedCodedStatus: 'DERIVE_ERROR',
      updatedCode: null,
      updatedScore: null
    });
    expect(updateQuery.set).not.toHaveBeenCalledWith(expect.objectContaining({
      status_v2: statusStringToNumber('CODING_COMPLETE'),
      code_v2: 0
    }));
  });

  it('rolls back and fails the import when manual freshness cannot be finalized', async () => {
    const selectQuery = createQueryBuilder([{
      id: 99,
      status_v2: null,
      code_v2: null,
      score_v2: null,
      unit: { id: 7, name: 'UNIT', alias: 'UNIT' }
    }]);
    const updateQuery = createQueryBuilder();
    const transactionalResponseRepository = {
      createQueryBuilder: jest.fn()
        .mockReturnValueOnce(selectQuery)
        .mockReturnValueOnce(updateQuery)
    };
    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      manager: {
        query: jest.fn().mockResolvedValue([]),
        getRepository: jest.fn().mockReturnValue(transactionalResponseRepository)
      }
    };
    const responseRepository = {
      manager: {
        connection: {
          createQueryRunner: jest.fn().mockReturnValue(queryRunner)
        }
      }
    };
    const codingFreshnessService = {
      markManualCodingCurrent: jest.fn().mockRejectedValue(new Error('freshness failed'))
    };
    const service = new ExternalCodingImportService(
      responseRepository as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { delete: jest.fn().mockResolvedValue(undefined) } as never,
      codingFreshnessService as never
    );
    jest.spyOn(service as unknown as {
      validateCodeAgainstScheme: () => Promise<unknown>;
    }, 'validateCodeAgainstScheme')
      .mockResolvedValue({
        isValid: true,
        score: 1,
        status: 'CODING_COMPLETE'
      });

    await expect(service.importExternalCoding(17, {
      file: Buffer.from('unit_key,variable_id,code\nUNIT,VAR,1\n').toString('base64'),
      fileName: 'coding.csv',
      previewOnly: false
    })).rejects.toThrow('freshness failed');

    expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
    expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
    expect(queryRunner.release).toHaveBeenCalled();
  });
});
