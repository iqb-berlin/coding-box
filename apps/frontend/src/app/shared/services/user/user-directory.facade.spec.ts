import { TestBed } from '@angular/core/testing';
import {
  EMPTY, of, Subject, throwError
} from 'rxjs';
import type { UserFullDto } from '../../../../../../../api-dto/user/user-full-dto';
import { UserDirectoryFacade } from './user-directory.facade';

describe('UserDirectoryFacade', () => {
  let directory: UserDirectoryFacade;
  const user: UserFullDto = { id: 7, username: 'current-user' };

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [UserDirectoryFacade] });
    directory = TestBed.inject(UserDirectoryFacade);
  });

  it('distinguishes delayed, empty, failed and successfully retried requests', () => {
    const delayed = new Subject<UserFullDto[]>();
    expect(directory.status()).toBe('idle');
    directory.load(() => delayed);
    expect(directory.status()).toBe('loading');
    delayed.next([]);
    expect(directory.status()).toBe('loaded');
    expect(directory.users()).toEqual([]);
    delayed.complete();
    directory.load(() => throwError(() => new Error('offline')));
    expect(directory.status()).toBe('error');
    directory.load(() => of([user]));
    expect(directory.status()).toBe('loaded');
    expect(directory.users()).toEqual([user]);
  });

  it('refreshes the open directory on focus while retaining data during failures', () => {
    const pending = new Subject<UserFullDto[]>();
    const request = jest.fn().mockReturnValueOnce(of([user])).mockReturnValueOnce(pending);
    directory.load(request);
    window.dispatchEvent(new Event('focus'));
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenNthCalledWith(1, false);
    expect(request).toHaveBeenNthCalledWith(2, true);
    expect(directory.status()).toBe('loaded');
    expect(directory.users()).toEqual([user]);
    pending.error(new Error('offline'));
    expect(directory.users()).toEqual([user]);
    expect(directory.status()).toBe('loaded');
  });

  it('retries an initial failure silently on return to the view', () => {
    const request = jest.fn().mockReturnValueOnce(throwError(() => new Error('offline'))).mockReturnValueOnce(of([user]));
    directory.load(request);
    expect(directory.status()).toBe('error');
    window.dispatchEvent(new Event('focus'));
    expect(request).toHaveBeenLastCalledWith(true);
    expect(directory.status()).toBe('loaded');
  });

  it('replaces pending requests and ignores their late results and errors', () => {
    const stale = new Subject<UserFullDto[]>();
    const current = new Subject<UserFullDto[]>();
    directory.load(() => stale);
    directory.load(() => current);
    expect(stale.observed).toBe(false);
    current.next([user]);
    stale.error(new Error('obsolete'));
    expect(directory.status()).toBe('loaded');
    expect(directory.users()).toEqual([user]);
  });

  it('clears obsolete data on reload and releases cancelled requests on destruction', () => {
    directory.load(() => of([user]));
    const pending = new Subject<UserFullDto[]>();
    directory.load(() => pending);
    expect(directory.users()).toEqual([]);
    TestBed.resetTestingModule();
    expect(pending.observed).toBe(false);
    pending.next([user]);
    expect(directory.users()).toEqual([]);
  });

  it('returns to idle for a cancelled context and can recover from a synchronous failure', () => {
    directory.load(() => EMPTY);
    expect(directory.status()).toBe('idle');
    directory.load(() => { throw new Error('factory failed'); });
    expect(directory.status()).toBe('error');
    directory.load(() => of([]));
    expect(directory.status()).toBe('loaded');
  });
});
