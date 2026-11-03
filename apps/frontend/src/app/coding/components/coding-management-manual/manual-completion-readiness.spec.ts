import { translateGerman } from '../../../../testing/german-translations';
import { completionReadinessTitle } from './manual-completion-readiness';

describe('manual completion readiness', () => {
  it('prioritizes completed application, then ready jobs, then review over open work', () => {
    const state = {
      complete: true, readyJobs: 2, reviewJobs: 1, executionOpen: true
    };
    expect(completionReadinessTitle(state, translateGerman)).toBe('Alle Ergebnisse sind übernommen');
    const ready = completionReadinessTitle({ ...state, complete: false }, translateGerman);
    expect(ready).toContain('2');
    expect(ready).toContain('1');
    expect(completionReadinessTitle({ ...state, complete: false, readyJobs: 0 }, translateGerman)).toContain('Review');
    expect(completionReadinessTitle({
      complete: false, readyJobs: 0, reviewJobs: 0, executionOpen: true
    }, translateGerman)).toContain('nicht alle');
  });
});
