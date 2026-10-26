import { TestBed } from '@angular/core/testing';
import { PostMessageService } from '../../../core/services/post-message.service';
import { TrainingReplayBridge } from './training-replay-bridge.service';

describe('TrainingReplayBridge', () => {
  let bridge: TrainingReplayBridge;
  let replayFrame: HTMLIFrameElement;
  let replayWindow: Window;
  let received: jest.Mock;
  const selection = {
    type: 'replayCodeSelected',
    responseId: 77,
    variableId: 'VAR',
    unitId: 'UNIT',
    testPerson: 'login@code@booklet',
    code: '0',
    score: 0,
    notes: 'Replay note'
  };
  const send = (data: unknown, origin = window.location.origin, source: MessageEventSource | null = replayWindow) => {
    window.dispatchEvent(new MessageEvent('message', { data, origin, source }));
  };

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [TrainingReplayBridge, PostMessageService] });
    replayFrame = document.createElement('iframe');
    document.body.appendChild(replayFrame);
    replayWindow = replayFrame.contentWindow!;
    bridge = TestBed.inject(TrainingReplayBridge);
    bridge.register(77, 'VAR', replayWindow);
    received = jest.fn();
    bridge.messages$.subscribe(received);
  });

  afterEach(() => replayFrame.remove());

  it('accepts selections and notes from the registered window, preserving optional field semantics', () => {
    send(selection);
    send({
      ...selection, code: '-3', score: null, notes: null
    });
    const withoutOptionalFields: Partial<typeof selection> = { ...selection };
    delete withoutOptionalFields.notes;
    delete withoutOptionalFields.score;
    send(withoutOptionalFields);
    send({
      type: 'replayNotesCommitted', responseId: 77, variableId: 'var', unitId: 'UNIT', testPerson: 'person', notes: ''
    });
    expect(received).toHaveBeenCalledTimes(4);
    expect(received.mock.calls[0][0].message).toEqual(selection);
    expect(received.mock.calls[1][0].message.score).toBeNull();
    expect(received.mock.calls[2][0].message).not.toHaveProperty('notes');
    expect(received.mock.calls[2][0].message).not.toHaveProperty('score');
    expect(received.mock.calls[3][0].message.notes).toBe('');
  });

  it('rejects foreign origins, unknown windows and messages for another response or variable', () => {
    send(selection, 'https://foreign.example');
    send(selection, window.location.origin, window);
    send(selection, window.location.origin, null);
    send({ ...selection, responseId: 78 });
    send({ ...selection, variableId: 'OTHER' });
    expect(received).not.toHaveBeenCalled();
    send(selection);
    expect(received).toHaveBeenCalledTimes(1);
  });

  it.each([
    { responseId: '77' }, { responseId: 0 }, { variableId: null }, { unitId: [] }, { testPerson: 7 },
    { code: '2junk' }, { code: '1.5' }, { code: '1e2' }, { code: '' }, { code: 1 }, { code: '9007199254740993' },
    { score: '2' }, { score: NaN }, { score: Infinity }, { notes: { text: 'invalid' } }
  ])('rejects malformed replay fields %j without losing the subscription', patch => {
    send({ ...selection, ...patch });
    send(selection);
    expect(received).toHaveBeenCalledTimes(1);
    expect(received.mock.calls[0][0].message).toEqual(selection);
  });

  it('rejects malformed notes messages', () => {
    send({ ...selection, type: 'replayNotesCommitted', notes: [] });
    expect(received).not.toHaveBeenCalled();
  });

  it('revokes old windows when the editing context changes or another window replaces them', () => {
    bridge.reset();
    send(selection);
    bridge.register(77, 'VAR', window);
    send(selection);
    expect(received).not.toHaveBeenCalled();
    send(selection, window.location.origin, window);
    expect(received).toHaveBeenCalledTimes(1);
  });
});
