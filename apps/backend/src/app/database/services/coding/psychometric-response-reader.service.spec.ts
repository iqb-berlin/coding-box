import { PsychometricResponseReader } from './psychometric-response-reader.service';

describe('PsychometricResponseReader', () => {
  it('reuses one read-only repeatable-read snapshot for multiple passes', async () => {
    const rows = [
      {
        responseId: 1,
        personId: 1,
        unitName: 'UNIT_A',
        variableId: 'V1',
        value: 'A',
        codeV1: 1,
        scoreV1: 1,
        codeV2: 1,
        scoreV2: 1,
        codeV3: 1,
        scoreV3: 1
      }
    ];
    const responseRepository = {
      createQueryBuilder: jest.fn(() => {
        let grouped = false;
        const queryBuilder = {
          innerJoin: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          addSelect: jest.fn().mockReturnThis(),
          groupBy: jest.fn(() => {
            grouped = true;
            return queryBuilder;
          }),
          addGroupBy: jest.fn().mockReturnThis(),
          having: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          getCount: jest.fn().mockResolvedValue(rows.length),
          getRawMany: jest.fn(async () => (grouped ? [] : rows))
        };
        return queryBuilder;
      })
    };
    const queryRunner = {
      manager: {
        getRepository: jest.fn().mockReturnValue(responseRepository)
      },
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockResolvedValue([]),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      isTransactionActive: true,
      isReleased: false
    };
    const workspaceExclusionService = {
      resolveExclusionsForQueries: jest.fn().mockResolvedValue({
        globalIgnoredUnits: [],
        ignoredBooklets: [],
        testletIgnoredUnits: []
      })
    };
    const reader = new PsychometricResponseReader(
      workspaceExclusionService as never,
      {
        createQueryRunner: jest.fn().mockReturnValue(queryRunner)
      } as never
    );
    const mapping = {
      items: [],
      byLogicalKey: new Map(),
      issues: []
    };
    const firstPass = jest.fn().mockResolvedValue(undefined);
    const secondPass = jest.fn().mockResolvedValue(undefined);

    await reader.withSnapshot(
      {
        workspaceId: 7,
        version: 'v2',
        mapping
      },
      async snapshot => {
        expect(snapshot.totalRows).toBe(1);
        await snapshot.forEachBatch(firstPass);
        await snapshot.forEachBatch(secondPass);
      }
    );

    expect(firstPass).toHaveBeenCalledWith(rows, 1);
    expect(secondPass).toHaveBeenCalledWith(rows, 1);
    expect(
      workspaceExclusionService.resolveExclusionsForQueries
    ).toHaveBeenCalledTimes(1);
    expect(queryRunner.startTransaction).toHaveBeenCalledWith(
      'REPEATABLE READ'
    );
    expect(queryRunner.query).toHaveBeenCalledWith(
      'SET TRANSACTION READ ONLY'
    );
    expect(queryRunner.commitTransaction).toHaveBeenCalledTimes(1);
    expect(queryRunner.rollbackTransaction).not.toHaveBeenCalled();
    expect(queryRunner.release).toHaveBeenCalledTimes(1);
  });
});
