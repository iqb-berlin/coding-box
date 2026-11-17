import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { ResetCodingPreviewState } from './reset-coding-preview-state.service';
import { CodingVersionService } from '../../../services/coding-version.service';
import { ResetCodingPreviewJobStatus, ResetCodingPreviewResult, ResetCodingScope } from '../../../../../../../../api-dto/coding/reset-coding-preview.dto';

describe('ResetCodingPreviewState', () => {
  const result: ResetCodingPreviewResult = {
    status: 'valid',
    unknownUnits: [],
    unknownVariables: [],
    affectedResponseCount: 1234567,
    resetResponseCount: 1234567,
    deletedGeneratedResponseCount: 0,
    checkedAt: '2026-11-17T10:00:00Z'
  };
  const scope: ResetCodingScope = { version: 'v1', unitFilters: ['DHB003'], variableFilters: [] };
  let state: ResetCodingPreviewState;
  const backend = { previewReset: jest.fn(), getResetPreview: jest.fn() };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    backend.previewReset.mockReturnValue(of({ jobId: 'preview-1' }));
    backend.getResetPreview.mockReturnValue(of({ status: 'completed', result }));
    TestBed.configureTestingModule({ providers: [ResetCodingPreviewState, { provide: CodingVersionService, useValue: backend }] });
    state = TestBed.inject(ResetCodingPreviewState);
  });

  afterEach(() => { state.ngOnDestroy(); jest.useRealTimers(); });

  it('does not query while opening or editing the dialog; starts exactly once on request', () => {
    state.configure(5, scope);
    state.configure(5, { ...scope, variableFilters: ['V1'] });
    expect(backend.previewReset).not.toHaveBeenCalled();
    state.check();
    state.check();
    expect(backend.previewReset).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(0);
    expect(state.result()?.affectedResponseCount).toBe(1234567);
    expect(state.canConfirm()).toBe(true);
    state.configure(5, scope);
    expect(state.result()).toBeNull();
    expect(state.canConfirm()).toBe(false);
  });

  it('ignores a previous result after the scope or workspace changes', () => {
    const pending = new Subject<ResetCodingPreviewJobStatus>();
    backend.getResetPreview.mockReturnValue(pending);
    state.configure(5, scope);
    state.check();
    jest.advanceTimersByTime(0);
    state.configure(6, scope);
    pending.next({ status: 'completed', result });
    expect(state.result()).toBeNull();
    expect(state.matches(5, scope)).toBe(false);
    expect(state.canConfirm()).toBe(false);
  });

  it.each([
    { ...result, affectedResponseCount: 0 },
    {
      ...result, status: 'invalid-filters' as const, unknownUnits: ['missing'], affectedResponseCount: null
    }
  ])('does not permit a reset with an empty or invalid scope', response => {
    backend.getResetPreview.mockReturnValue(of({ status: 'completed', result: response }));
    state.configure(5, scope);
    state.check();
    jest.advanceTimersByTime(0);
    expect(state.canConfirm()).toBe(false);
    expect(state.result()).toEqual(response);
  });

  it('allows retry after a transport error and never confirms an unverified scope', () => {
    backend.previewReset.mockReturnValue(throwError(() => new Error('offline')));
    state.configure(5, scope);
    state.check();
    expect(state.failed()).toBe(true);
    expect(state.busy()).toBe(false);
    expect(state.canConfirm()).toBe(false);
    backend.previewReset.mockReturnValue(of({ jobId: 'retry' }));
    state.check();
    jest.advanceTimersByTime(0);
    expect(state.canConfirm()).toBe(true);
  });
});
