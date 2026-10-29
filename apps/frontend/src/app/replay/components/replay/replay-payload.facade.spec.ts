import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { ReplayBackendService, ReplayPayload, ReplayResponsePayload } from '../../services/replay-backend.service';
import { ReplayAttemptContext } from '../../utils/replay-attempt-context';
import { ReplayPayloadFacade } from './replay-payload.facade';

describe('Replay player request lifetime', () => {
  let facade: ReplayPayloadFacade;
  let full: Subject<ReplayPayload>;
  let response: Subject<ReplayResponsePayload>;
  const context = { workspaceId: 5, testPerson: 'person@code@booklet', unitId: 'UNIT' };
  const payload: ReplayPayload = {
    unitDef: [], player: [], vocs: [], response: { responses: [] }
  };
  let backend: { getReplayPayload: jest.Mock; getReplayResponse: jest.Mock };

  beforeEach(() => {
    full = new Subject<ReplayPayload>();
    response = new Subject<ReplayResponsePayload>();
    backend = { getReplayPayload: jest.fn(() => full), getReplayResponse: jest.fn(() => response) };
    TestBed.configureTestingModule({ providers: [ReplayPayloadFacade, { provide: ReplayBackendService, useValue: backend }] });
    facade = TestBed.inject(ReplayPayloadFacade);
  });

  it('replaces a full load with response-only navigation without accepting stale data', async () => {
    const first = facade.loadFull(context, new ReplayAttemptContext(), 'token', true);
    const latest = facade.loadResponse({ ...context, testPerson: 'other@code@booklet' }, new ReplayAttemptContext(), 'token');
    expect(full.observed).toBe(false);
    full.next(payload);
    response.next({ response: payload.response });
    expect(await first).toBeNull();
    expect((await latest)?.value.response).toEqual(payload.response);
    expect(backend.getReplayResponse).toHaveBeenCalledWith(5, 'other@code@booklet', 'UNIT', 'token', expect.any(String));
  });

  it('rejects current failures and allows a new full-payload retry', async () => {
    const pending = facade.loadFull(context, new ReplayAttemptContext(), undefined, false);
    const rejected = expect(pending).rejects.toThrow('failed');
    full.error(new Error('failed'));
    await rejected;
    full = new Subject<ReplayPayload>();
    const retry = facade.loadFull(context, new ReplayAttemptContext(), undefined, false);
    full.next(payload);
    expect((await retry)?.value).toEqual(payload);
  });

  it.each(['invalidate', 'destroy'])('settles response loads on %s and ignores late replies', async action => {
    const pending = facade.loadResponse(context, new ReplayAttemptContext());
    if (action === 'invalidate') facade.invalidate();
    else TestBed.resetTestingModule();
    expect(response.observed).toBe(false);
    response.next({ response: payload.response });
    expect(await pending).toBeNull();
  });

  it('does not start requests after destruction', async () => {
    TestBed.resetTestingModule();
    expect(await facade.loadFull(context, new ReplayAttemptContext(), undefined, false)).toBeNull();
    expect(backend.getReplayPayload).not.toHaveBeenCalled();
  });
});
