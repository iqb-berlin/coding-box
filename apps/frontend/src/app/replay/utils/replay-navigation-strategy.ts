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
