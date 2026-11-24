import AdmZip from 'adm-zip';
import { statusStringToNumber } from '../../utils/response-status-converter';
import { CodingAggregationPeerService } from './coding-aggregation-peer.service';

const createQueryBuilder = (rows: unknown[]) => {
  const queryBuilder: Record<string, jest.Mock> = {};
  [
    'select',
    'addSelect',
    'innerJoin',
    'leftJoin',
    'where',
    'andWhere',
    'distinct',
    'orderBy'
  ].forEach(method => {
    queryBuilder[method] = jest.fn().mockReturnValue(queryBuilder);
  });
  queryBuilder.getRawMany = jest.fn().mockResolvedValue(rows);
  return queryBuilder;
};

describe('CodingAggregationPeerService', () => {
  it('loads normalized completed peers in two exclusion-safe queries', async () => {
    const peerValueQuery = createQueryBuilder([
      {
        unitName: 'unit',
        variableId: 'VAR',
        value: ' sameanswer '
      }
    ]);
    const completedPeersQuery = createQueryBuilder([
      {
        responseId: '7',
        unitName: 'unit',
        unitAlias: null,
        variableId: 'VAR',
        value: ' sameanswer ',
        statusV1: '2',
        statusV2: '5',
        codeV2: '1',
        bookletName: 'Booklet',
        personLogin: 'login',
        personCode: 'code',
        personGroup: 'group'
      }
    ]);
    const responseRepository = {
      createQueryBuilder: jest.fn()
        .mockReturnValueOnce(peerValueQuery)
        .mockReturnValueOnce(completedPeersQuery)
    };
    const loadQueryContext = jest.fn().mockResolvedValue({
      defaultMirCode: -98,
      exclusions: {
        globalIgnoredUnits: [],
        ignoredBooklets: ['blocked'],
        testletIgnoredUnits: [{ bookletId: 'Booklet', unitId: 'UNIT.XML' }]
      }
    });
    const service = new CodingAggregationPeerService(responseRepository as never);

    const result = await service.findCompletedPeers({
      workspaceId: 5,
      sourceResponses: [{
        responseId: 1,
        unitName: 'UNIT',
        variableId: 'VAR',
        value: 'Same\u00a0answer'
      }],
      matchingFlags: ['IGNORE_CASE', 'IGNORE_WHITESPACE'],
      derivedVariableMap: new Map(),
      loadQueryContext
    });

    expect(result).toEqual([expect.objectContaining({
      responseId: 7,
      unitName: 'unit',
      variableId: 'VAR',
      codeV2: 1
    })]);
    expect(responseRepository.createQueryBuilder).toHaveBeenCalledTimes(2);
    expect(peerValueQuery.select).toHaveBeenCalledWith(
      'unit.name',
      'unitName'
    );
    expect(peerValueQuery.distinct).toHaveBeenCalledWith(true);
    expect(peerValueQuery.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('aggregation_peer_variable'),
      {
        aggregationPeerVariables: JSON.stringify([
          { unitName: 'UNIT', variableId: 'VAR' }
        ])
      }
    );
    expect(peerValueQuery.andWhere).toHaveBeenCalledWith(
      'UPPER(bookletinfo.name) NOT IN (:...completedAggregationPeersValuesIgnoredBooklets)',
      { completedAggregationPeersValuesIgnoredBooklets: ['BLOCKED'] }
    );
    expect(completedPeersQuery.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('completedAggregationPeersPeersBooklet0'),
      {
        completedAggregationPeersPeersBooklet0: 'BOOKLET',
        completedAggregationPeersPeersUnit0: 'UNIT'
      }
    );
    expect(loadQueryContext).toHaveBeenCalledTimes(1);
  });

  it('does not load query context when no source response can form a peer key', async () => {
    const responseRepository = { createQueryBuilder: jest.fn() };
    const loadQueryContext = jest.fn();
    const service = new CodingAggregationPeerService(responseRepository as never);

    await expect(service.findCompletedPeers({
      workspaceId: 5,
      sourceResponses: [{
        responseId: 1,
        unitName: 'UNIT',
        variableId: 'VAR',
        value: null
      }],
      matchingFlags: ['IGNORE_CASE'],
      derivedVariableMap: new Map(),
      loadQueryContext
    })).resolves.toEqual([]);

    expect(loadQueryContext).not.toHaveBeenCalled();
    expect(responseRepository.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('ignores a completed displayed GeoGebra answer even when an edited peer has the same archive', async () => {
    const archive = new AdmZip();
    archive.addFile('geogebra.xml', Buffer.from('<geogebra/>'));
    const drawing = {
      unitName: 'GEOGEBRA', variableId: 'drawing', value: archive.toBuffer().toString('base64')
    };
    const viewed = {
      ...drawing, responseId: 2, status: statusStringToNumber('DISPLAYED')
    };
    const edited = {
      ...drawing, responseId: 3, status: statusStringToNumber('VALUE_CHANGED')
    };
    const values = createQueryBuilder([viewed, edited]);
    const peers = createQueryBuilder([viewed, edited]);
    const repository = {
      createQueryBuilder: jest.fn().mockReturnValueOnce(values).mockReturnValueOnce(peers)
    };
    const service = new CodingAggregationPeerService(repository as never);

    const result = await service.findCompletedPeers({
      workspaceId: 5,
      sourceResponses: [{ ...edited, responseId: 1 }],
      matchingFlags: [],
      derivedVariableMap: new Map(),
      loadQueryContext: async () => ({
        defaultMirCode: -98,
        exclusions: { globalIgnoredUnits: [], ignoredBooklets: [], testletIgnoredUnits: [] }
      })
    });
    expect(result.map(response => response.responseId)).toEqual([3]);
    expect(values.addSelect).toHaveBeenCalledWith('response.status', 'status');
    expect(peers.addSelect).toHaveBeenCalledWith('response.status', 'status');
  });
});
