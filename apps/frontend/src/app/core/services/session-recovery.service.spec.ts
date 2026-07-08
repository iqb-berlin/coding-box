import { TestBed } from '@angular/core/testing';
import { SessionRecoveryService } from './session-recovery.service';

describe('SessionRecoveryService', () => {
  let service: SessionRecoveryService;

  beforeEach(() => {
    sessionStorage.clear();

    TestBed.configureTestingModule({
      providers: [SessionRecoveryService]
    });

    service = TestBed.inject(SessionRecoveryService);
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it('should save and consume a draft once', () => {
    service.saveDraft('k', { value: 'draft' });

    expect(service.peekDraft('k')).toEqual({ value: 'draft' });
    expect(service.consumeDraft('k')).toEqual({ value: 'draft' });
    expect(service.consumeDraft('k')).toBeNull();
  });

  it('should capture all registered providers', () => {
    const unregister = service.registerProvider({
      key: 'provider',
      capture: () => ({ value: 42 })
    });

    service.captureRegisteredDrafts();

    expect(service.consumeDraft('provider')).toEqual({ value: 42 });
    unregister();
  });

  it('should ignore null provider captures', () => {
    service.registerProvider({
      key: 'empty',
      capture: () => null
    });

    service.captureRegisteredDrafts();

    expect(service.consumeDraft('empty')).toBeNull();
  });

  it('should clear only recovery drafts when requested', () => {
    service.saveDraft('draft-one', { value: 1 });
    service.saveDraft('draft-two', { value: 2 });
    sessionStorage.setItem('other-key', 'keep');

    service.clearAllDrafts();

    expect(service.peekDraft('draft-one')).toBeNull();
    expect(service.peekDraft('draft-two')).toBeNull();
    expect(sessionStorage.getItem('other-key')).toBe('keep');
  });

  it('should scope drafts to the active owner', () => {
    service.setOwnerId('user-1');
    service.saveDraft('owned', { value: 'draft' });

    service.setOwnerId(undefined);
    expect(service.peekDraft('owned')).toBeNull();

    service.setOwnerId('user-1');
    expect(service.peekDraft('owned')).toEqual({ value: 'draft' });

    service.setOwnerId('user-2');
    expect(service.peekDraft('owned')).toBeNull();

    service.setOwnerId('user-1');
    expect(service.peekDraft('owned')).toBeNull();
  });
});
