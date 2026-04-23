import {
  buildPayloadCandidates,
  normalizePlayerId,
  parseReplayUrl,
  summarizeFailuresByMessage,
  summarizeFailuresByStage
} from './replay-health.utils';
import { ReplayHealthCheckResult } from './replay-health.types';

describe('replay-health utils', () => {
  it('should parse replay URLs with encoded values', () => {
    const parsed = parseReplayUrl(
      'http://localhost/#/replay/user%40mail%40group%40BOOKLET/UNIT-1/3/VAR_1?auth='
    );

    expect(parsed).toEqual({
      testPerson: 'user@mail@group@BOOKLET',
      unitId: 'UNIT-1',
      page: '3',
      anchor: 'VAR_1'
    });
  });

  it('should return null for invalid replay URLs', () => {
    expect(parseReplayUrl('http://localhost/#/home')).toBeNull();
    expect(parseReplayUrl('not-a-url')).toBeNull();
  });

  it('should normalize player ids', () => {
    expect(normalizePlayerId('ASPECT@2.5.1')).toBe('ASPECT-2.5.1');
    expect(normalizePlayerId('iqb-player-aspect-2.9.4')).toBe(
      'IQB-PLAYER-ASPECT-2.9.4'
    );
  });

  it('should group replay URLs into payload candidates', () => {
    const grouped = buildPayloadCandidates(7, [
      {
        responseId: 1,
        unitName: 'UNIT-1',
        unitAlias: 'UNIT-1',
        variableId: 'VAR_A',
        bookletName: 'BOOKLET',
        personLogin: 'login',
        personCode: 'code',
        personGroup: '',
        replayUrl: 'http://localhost/#/replay/login%40code%40%40BOOKLET/UNIT-1/1/VAR_A?auth='
      },
      {
        responseId: 2,
        unitName: 'UNIT-1',
        unitAlias: 'UNIT-1',
        variableId: 'VAR_B',
        bookletName: 'BOOKLET',
        personLogin: 'login',
        personCode: 'code',
        personGroup: '',
        replayUrl: 'http://localhost/#/replay/login%40code%40%40BOOKLET/UNIT-1/2/VAR_B?auth='
      }
    ]);

    expect(grouped.parseFailures).toHaveLength(0);
    expect(grouped.payloadCandidates).toHaveLength(1);
    expect(grouped.payloadCandidates[0]).toMatchObject({
      workspaceId: 7,
      testPerson: 'login@code@@BOOKLET',
      unitId: 'UNIT-1',
      occurrenceCount: 2
    });
    expect(grouped.payloadCandidates[0].pages).toEqual(['1', '2']);
    expect(grouped.payloadCandidates[0].anchors).toEqual(['VAR_A', 'VAR_B']);
    expect(grouped.payloadCandidates[0].responseIds).toEqual([1, 2]);
  });

  it('should summarize failures by stage and message', () => {
    const results: ReplayHealthCheckResult[] = [
      {
        ok: false,
        phase: 'payload',
        stage: 'findUnitDef',
        workspaceId: 1,
        testPerson: 'a',
        unitId: 'b',
        replayUrl: 'u1',
        responseIds: [1],
        occurrenceCount: 1,
        anchors: ['x'],
        message: 'missing voud'
      },
      {
        ok: false,
        phase: 'payload',
        stage: 'findUnitDef',
        workspaceId: 1,
        testPerson: 'c',
        unitId: 'd',
        replayUrl: 'u2',
        responseIds: [2],
        occurrenceCount: 1,
        anchors: ['y'],
        message: 'missing voud'
      },
      {
        ok: false,
        phase: 'payload',
        stage: 'findPlayer',
        workspaceId: 1,
        testPerson: 'e',
        unitId: 'f',
        replayUrl: 'u3',
        responseIds: [3],
        occurrenceCount: 1,
        anchors: ['z'],
        message: 'player missing'
      }
    ];

    expect(summarizeFailuresByStage(results)).toEqual({
      findUnitDef: 2,
      findPlayer: 1
    });
    expect(summarizeFailuresByMessage(results)).toEqual([
      { message: 'missing voud', count: 2 },
      { message: 'player missing', count: 1 }
    ]);
  });
});
