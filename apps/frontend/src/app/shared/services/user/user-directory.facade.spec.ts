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
