import { Booklet, BookletLog, Unit } from './test-results.models';
import { calculateBookletProcessingTime, hasShortBookletProcessingTime, isBookletComplete } from './booklet-result-status';

describe('booklet result status', () => {
  const log = (key: string, parameter: string, ts = '0'): BookletLog => ({
    id: 1, bookletid: 1, key, parameter, ts
  });
  const unit = (alias: string): Unit => ({
    id: 1, bookletid: 1, name: 'U', alias, results: [], logs: [], tags: []
  });
  const booklet: Booklet = {
    id: 1, personid: 1, name: 'B', size: 1, units: [unit('A'), unit('B')], logs: []
  };
  it('retains compatibility for missing logs and requires every unit alias otherwise', () => {
    expect(isBookletComplete(booklet)).toBe(true);
    expect(isBookletComplete({ ...booklet, logs: [log('CURRENT_UNIT_ID', 'A')] })).toBe(false);
    expect(isBookletComplete({ ...booklet, logs: [log('CURRENT_UNIT_ID', 'A'), log('CURRENT_UNIT_ID', 'B')] })).toBe(true);
    expect(isBookletComplete({ ...booklet, units: [], logs: [log('CURRENT_UNIT_ID', 'A')] })).toBe(false);
  });
  it('calculates elapsed milliseconds and respects the strict short-time threshold', () => {
    const measured = { ...booklet, logs: [log('CONTROLLER', 'RUNNING', '1000'), log('CONTROLLER', 'TERMINATED', '3000')] };
    expect(calculateBookletProcessingTime(measured)).toBe(2000);
    expect(hasShortBookletProcessingTime(measured, 2000)).toBe(false);
    expect(hasShortBookletProcessingTime(measured, 2001)).toBe(true);
    expect(calculateBookletProcessingTime({ ...measured, logs: [log('CONTROLLER', 'RUNNING', 'invalid')] })).toBeNull();
    expect(hasShortBookletProcessingTime(booklet, 2000)).toBe(false);
  });
});
