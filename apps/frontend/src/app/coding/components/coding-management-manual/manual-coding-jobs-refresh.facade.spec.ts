import { Component, inject } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CodingJobsReloadScope, ManualCodingJobsRefreshFacade } from './manual-coding-jobs-refresh.facade';
import type { ManualCodingTab } from './manual-coding-planning';

@Component({
  standalone: true,
  template: '',
  providers: [ManualCodingJobsRefreshFacade]
})
class JobsRefreshHost {
  readonly refresh = inject(ManualCodingJobsRefreshFacade);
}

describe('ManualCodingJobsRefreshFacade', () => {
  let fixture: ComponentFixture<JobsRefreshHost>;
  let refresh: ManualCodingJobsRefreshFacade;
  let activeTab: ManualCodingTab;
  let productive: { loadCodingJobs: jest.Mock } | undefined;
  let training: { loadCodingJobs: jest.Mock } | undefined;
  let coderTrainings: { loadCoderTrainings: jest.Mock } | undefined;

  beforeEach(() => {
    jest.useFakeTimers();
    TestBed.configureTestingModule({ imports: [JobsRefreshHost] });
    fixture = TestBed.createComponent(JobsRefreshHost);
    refresh = fixture.componentInstance.refresh;
    activeTab = 'preparation';
    productive = { loadCodingJobs: jest.fn() };
    training = { loadCodingJobs: jest.fn() };
    coderTrainings = { loadCoderTrainings: jest.fn() };
    refresh.connectViews({
      activeTab: () => activeTab,
      productive: () => productive,
      training: () => training,
      coderTrainings: () => coderTrainings
    });
  });

  afterEach(() => {
    fixture.destroy();
    jest.useRealTimers();
  });

  it('reloads productive jobs without requesting training data', () => {
    refresh.reload('productive');

    expect(productive?.loadCodingJobs).toHaveBeenCalledTimes(1);
    expect(training?.loadCodingJobs).not.toHaveBeenCalled();
    expect(coderTrainings?.loadCoderTrainings).not.toHaveBeenCalled();
  });

  it('reloads training jobs together with the training list', () => {
    refresh.reload('training');

    expect(productive?.loadCodingJobs).not.toHaveBeenCalled();
    expect(training?.loadCodingJobs).toHaveBeenCalledTimes(1);
    expect(coderTrainings?.loadCoderTrainings).toHaveBeenCalledTimes(1);
  });

  it('resolves the active scope when the reload is requested', () => {
    activeTab = 'execution';
    refresh.reload();
    activeTab = 'training';
    refresh.reload();

    expect(productive?.loadCodingJobs).toHaveBeenCalledTimes(1);
    expect(training?.loadCodingJobs).toHaveBeenCalledTimes(1);
    expect(coderTrainings?.loadCoderTrainings).toHaveBeenCalledTimes(1);
  });

  it.each<ManualCodingTab>(['preparation', 'planning', 'completion'])('keeps lists idle on %s', tab => {
    activeTab = tab;
    refresh.reload();
    refresh.refreshAfterDataChange('active');

    expect(productive?.loadCodingJobs).not.toHaveBeenCalled();
    expect(training?.loadCodingJobs).not.toHaveBeenCalled();
    expect(coderTrainings?.loadCoderTrainings).not.toHaveBeenCalled();
  });

  it('explicitly reloads both rendered scopes, including the training list', () => {
    refresh.reload('rendered');

    expect(productive?.loadCodingJobs).toHaveBeenCalledTimes(1);
    expect(training?.loadCodingJobs).toHaveBeenCalledTimes(1);
    expect(coderTrainings?.loadCoderTrainings).toHaveBeenCalledTimes(1);
  });

  it('refreshes the active list immediately and coalesces changes for hidden lists', () => {
    activeTab = 'execution';
    refresh.refreshAfterDataChange('rendered');
    refresh.refreshAfterDataChange('training');
    refresh.refreshAfterDataChange('training');

    expect(productive?.loadCodingJobs).toHaveBeenCalledTimes(1);
    expect(training?.loadCodingJobs).not.toHaveBeenCalled();
    expect(coderTrainings?.loadCoderTrainings).not.toHaveBeenCalled();

    activeTab = 'training';
    refresh.reloadPendingForTab(activeTab);
    refresh.reloadPendingForTab(activeTab);

    expect(training?.loadCodingJobs).toHaveBeenCalledTimes(1);
    expect(coderTrainings?.loadCoderTrainings).toHaveBeenCalledTimes(1);
    expect(productive?.loadCodingJobs).toHaveBeenCalledTimes(1);
  });

  it('retains each hidden scope until its tab is visited', () => {
    refresh.refreshAfterDataChange('rendered');
    refresh.reloadPendingForTab('planning');
    refresh.reloadPendingForTab('execution');

    expect(productive?.loadCodingJobs).toHaveBeenCalledTimes(1);
    expect(training?.loadCodingJobs).not.toHaveBeenCalled();

    refresh.reloadPendingForTab('training');
    expect(training?.loadCodingJobs).toHaveBeenCalledTimes(1);
  });

  it('reads deferred view queries again after rendering and consumes the pending reload once', () => {
    productive = undefined;
    refresh.reload('productive');
    refresh.schedulePendingForTab('execution');
    productive = { loadCodingJobs: jest.fn() };

    expect(productive.loadCodingJobs).not.toHaveBeenCalled();
    jest.runOnlyPendingTimers();
    refresh.reloadPendingForTab('execution');

    expect(productive.loadCodingJobs).toHaveBeenCalledTimes(1);
  });

  it('keeps a reload pending if the deferred view is still absent at the scheduled retry', () => {
    training = undefined;
    coderTrainings = undefined;
    refresh.reload('training');
    refresh.schedulePendingForTab('training');
    jest.runOnlyPendingTimers();
    training = { loadCodingJobs: jest.fn() };
    coderTrainings = { loadCoderTrainings: jest.fn() };
    refresh.reloadPendingForTab('training');

    expect(training.loadCodingJobs).toHaveBeenCalledTimes(1);
    expect(coderTrainings.loadCoderTrainings).toHaveBeenCalledTimes(1);
  });

  it('replaces a scheduled retry without dropping the other pending scope', () => {
    refresh.refreshAfterDataChange('rendered');
    refresh.schedulePendingForTab('execution');
    refresh.schedulePendingForTab('training');
    jest.runOnlyPendingTimers();

    expect(productive?.loadCodingJobs).not.toHaveBeenCalled();
    expect(training?.loadCodingJobs).toHaveBeenCalledTimes(1);
    refresh.reloadPendingForTab('execution');
    expect(productive?.loadCodingJobs).toHaveBeenCalledTimes(1);
  });

  it('does not schedule a retry when the tab has no pending reload', () => {
    const timers = jest.getTimerCount();
    refresh.schedulePendingForTab('training');

    expect(jest.getTimerCount()).toBe(timers);
  });

  it('debounces definition changes and retains the most recent requested scope', () => {
    const changes: CodingJobsReloadScope[] = [];
    refresh.definitionChanges$.subscribe(scope => changes.push(scope));
    refresh.definitionChanged('productive');
    jest.advanceTimersByTime(400);
    refresh.definitionChanged('training');
    jest.advanceTimersByTime(499);
    expect(changes).toEqual([]);
    jest.advanceTimersByTime(1);
    expect(changes).toEqual(['training']);

    refresh.definitionChanged();
    jest.advanceTimersByTime(500);
    expect(changes).toEqual(['training', 'active']);
  });

  it('cancels deferred reloads and debounced notifications on host destruction', () => {
    const changed = jest.fn();
    refresh.definitionChanges$.subscribe(changed);
    refresh.definitionChanged('rendered');
    refresh.refreshAfterDataChange('rendered');
    refresh.schedulePendingForTab('execution');

    fixture.destroy();
    jest.runOnlyPendingTimers();

    expect(changed).not.toHaveBeenCalled();
    expect(productive?.loadCodingJobs).not.toHaveBeenCalled();
    expect(training?.loadCodingJobs).not.toHaveBeenCalled();
  });

  it('keeps pending work local to its component instance', () => {
    refresh.refreshAfterDataChange('productive');
    const other = TestBed.createComponent(JobsRefreshHost);
    const otherJobs = { loadCodingJobs: jest.fn() };
    other.componentInstance.refresh.connectViews({
      activeTab: () => 'execution',
      productive: () => otherJobs,
      training: () => undefined,
      coderTrainings: () => undefined
    });
    other.componentInstance.refresh.reloadPendingForTab('execution');
    expect(otherJobs.loadCodingJobs).not.toHaveBeenCalled();

    refresh.reloadPendingForTab('execution');
    expect(productive?.loadCodingJobs).toHaveBeenCalledTimes(1);
    other.destroy();
  });
});
