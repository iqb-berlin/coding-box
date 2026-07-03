import {
  CodingBackgroundJobsService,
  CodingStatusGuardClearedEvent
} from './coding-background-jobs.service';

describe('CodingBackgroundJobsService', () => {
  let service: CodingBackgroundJobsService;

  beforeEach(() => {
    service = new CodingBackgroundJobsService();
  });

  it('should keep the status guard active until all tracked jobs finish', () => {
    const clearedEvents: CodingStatusGuardClearedEvent[] = [];
    service.statusGuardCleared$.subscribe(event => clearedEvents.push(event));

    service.setJobRunning(1, 'autocoder-reset', true, 'reset-1');
    service.setJobRunning(1, 'response-analysis', true, 'analysis-1');

    expect(service.isStatusCheckGuardActive(1)).toBe(true);

    service.setJobRunning(1, 'autocoder-reset', false, 'reset-1');

    expect(service.isStatusCheckGuardActive(1)).toBe(true);
    expect(clearedEvents).toEqual([]);

    service.setJobRunning(1, 'response-analysis', false, 'analysis-1');

    expect(service.isStatusCheckGuardActive(1)).toBe(false);
    expect(clearedEvents).toEqual([{
      workspaceId: 1,
      kind: 'response-analysis',
      jobId: 'analysis-1'
    }]);
  });
});
