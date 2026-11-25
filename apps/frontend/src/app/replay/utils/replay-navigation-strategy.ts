import type { UnitsReplayUnit } from '../services/units-replay.service';

export interface ReplayNavigationContext {
  workspaceId: number;
  testPerson: string;
  unitId: string;
}

export type ReplayNavigationStrategy =
  'direct-page-navigation' |
  'load-responses' |
  'load-full-payload';

export function decideReplayNavigationStrategy(
  current: ReplayNavigationContext | null,
  target: ReplayNavigationContext
): ReplayNavigationStrategy {
  const isSameUnit = current?.workspaceId === target.workspaceId &&
    current.unitId === target.unitId;

  if (!isSameUnit) {
    return 'load-full-payload';
  }

  return current.testPerson === target.testPerson ?
    'direct-page-navigation' :
    'load-responses';
}

export function findReplayUnitIndex(units: readonly UnitsReplayUnit[], target: UnitsReplayUnit): number {
  return units.findIndex(unit => (
    unit.name === target.name &&
    (unit.testPerson ?? '') === (target.testPerson ?? '') &&
    unit.variableId === target.variableId
  ));
}
