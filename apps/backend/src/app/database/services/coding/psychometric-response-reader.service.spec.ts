import { PsychometricResponseReader } from './psychometric-response-reader.service';
import { getPsychometricLogicalKey } from './psychometric-key.util';

describe('PsychometricResponseReader', () => {
  it('groups aliases, source IDs and unit variants by canonical item key', async () => {
    const itemKey = getPsychometricLogicalKey('UNIT_A', 'V1');
    const sourceLogicalKey = getPsychometricLogicalKey(
      'folder/UNIT_A.XML',
      'source-v1'
    );
    const rows = [
      {
        responseId: 1,
        personId: 1,
        unitName: 'UNIT_A',
        variableId: 'V1',
        value: 'A',
        code: 1,
        score: 1
      }
    ];
    const queryBuilders: Array<Record<string, jest.Mock>> = [];
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
          getRawMany: jest.fn(async () => (
            grouped ?
              [{ personId: '9', itemKey }] :
              rows
          ))
        };
        queryBuilders.push(queryBuilder);
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
    const item = { key: itemKey } as never;
    const mapping = {
      items: [item],
      byLogicalKey: new Map([
        [itemKey, item],
        [sourceLogicalKey, item]
      ]),
      issues: [],
      fallbacks: []
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
        expect(snapshot.duplicatePersonIds).toEqual(new Set([9]));
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
    expect(queryRunner.query).toHaveBeenCalledWith('SET TRANSACTION READ ONLY');
    expect(queryRunner.commitTransaction).toHaveBeenCalledTimes(1);
    expect(queryRunner.rollbackTransaction).not.toHaveBeenCalled();
    expect(queryRunner.release).toHaveBeenCalledTimes(1);
    queryBuilders.forEach(queryBuilder => {
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'CONCAT(TRIM(REGEXP_REPLACE(' +
          "REGEXP_REPLACE(UPPER(TRIM(unit.name)), '^.*[\\\\/]', ''), " +
          "'\\.(VOMD|VOCS|XML)$', '')), CHR(31), " +
          'UPPER(TRIM(response.variableid))) ' +
          'IN (:...psychometricVariablePairKeys)',
        {
          psychometricVariablePairKeys: [
            itemKey,
            sourceLogicalKey
          ]
        }
      );
    });
    const duplicateQuery = queryBuilders.find(queryBuilder => queryBuilder
      .addGroupBy
      .mock.calls
      .some(call => call[0] === 'psychometric_mapping.value'));
    expect(duplicateQuery?.innerJoin).toHaveBeenCalledWith(
      '(SELECT * FROM jsonb_each_text(' +
        'CAST(:psychometricCanonicalItemMapping AS jsonb)))',
      'psychometric_mapping',
      'psychometric_mapping.key = ' +
        'CONCAT(TRIM(REGEXP_REPLACE(' +
        "REGEXP_REPLACE(UPPER(TRIM(unit.name)), '^.*[\\\\/]', ''), " +
        "'\\.(VOMD|VOCS|XML)$', '')), CHR(31), " +
        'UPPER(TRIM(response.variableid)))',
      {
        psychometricCanonicalItemMapping: JSON.stringify({
          [itemKey]: itemKey,
          [sourceLogicalKey]: itemKey
        })
      }
    );
    expect(duplicateQuery?.addGroupBy).not.toHaveBeenCalledWith(
      'UPPER(TRIM(response.variableid))'
    );
    const batchQueries = queryBuilders.filter(
      queryBuilder => queryBuilder.orderBy.mock.calls.length > 0
    );
    expect(batchQueries).toHaveLength(2);
    batchQueries.forEach(queryBuilder => {
      expect(queryBuilder.addSelect).toHaveBeenCalledWith(
        'response.code_v2',
        'code'
      );
      expect(queryBuilder.addSelect).toHaveBeenCalledWith(
        'response.score_v2',
        'score'
      );
      expect(queryBuilder.addSelect).not.toHaveBeenCalledWith(
        'response.code_v1',
        expect.anything()
      );
      expect(queryBuilder.addSelect).not.toHaveBeenCalledWith(
        'response.code_v3',
        expect.anything()
      );
    });
  });
});
