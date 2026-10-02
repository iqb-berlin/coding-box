import {
  decideReplayNavigationStrategy,
  ReplayNavigationContext
} from './replay-navigation-strategy';

describe('decideReplayNavigationStrategy', () => {
  const current: ReplayNavigationContext = {
    workspaceId: 12,
    testPerson: 'person-1',
    unitId: 'unit-1'
  };

  it('navigates directly for the same workspace, unit and person', () => {
    expect(decideReplayNavigationStrategy(current, { ...current }))
      .toBe('direct-page-navigation');
  });

  it('loads only responses when the person changes within the same unit', () => {
    expect(decideReplayNavigationStrategy(current, {
      ...current,
      testPerson: 'person-2'
    })).toBe('load-responses');
  });

  it('loads the full payload when the unit changes', () => {
    expect(decideReplayNavigationStrategy(current, {
      ...current,
      unitId: 'unit-2'
    })).toBe('load-full-payload');
  });

  it('loads the full payload without an applied replay context', () => {
    expect(decideReplayNavigationStrategy(null, current))
      .toBe('load-full-payload');
  });
});
