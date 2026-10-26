import { TestBed } from '@angular/core/testing';
import { AuthSessionState, DEFAULT_AUTH_DATA } from './auth-session-state.service';

describe('AuthSessionState', () => {
  let state: AuthSessionState;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    state = TestBed.inject(AuthSessionState);
  });

  it('distinguishes recoverable credentials from an accepted session', () => {
    state.setCredentialsAvailable(true);
    expect(state.credentialsAvailable()).toBe(true);
    expect(state.isLoggedIn()).toBe(false);
    expect(state.loggedUser()).toBeUndefined();
    state.establish({
      sub: 'user', preferred_username: 'tester', given_name: 'Ada', family_name: 'Example'
    });
    expect(state.isLoggedIn()).toBe(true);
    expect(state.loggedUser()?.sub).toBe('user');
    expect(state.userProfile()).toEqual({
      username: 'tester', firstName: 'Ada', lastName: 'Example', email: undefined
    });
    // Losing credentials must leave the identity available for draft capture.
    state.setCredentialsAvailable(false);
    expect(state.loggedUser()?.sub).toBe('user');
  });

  it('publishes cleared auth data after the identity and profile have been cleared', () => {
    state.establish({ sub: 'user', preferred_username: 'tester' });
    state.updateAuthData({
      ...DEFAULT_AUTH_DATA, userId: 7, userName: 'tester', isAdmin: true
    });
    const cleared = jest.fn();
    const subscription = state.authData$.subscribe(authData => {
      if (authData.userId === 0) {
        cleared({ loggedIn: state.isLoggedIn(), user: state.loggedUser(), profile: state.userProfile() });
      }
    });
    state.clear();
    expect(cleared).toHaveBeenCalledWith({ loggedIn: false, user: undefined, profile: {} });
    expect(state.authData()).toEqual(DEFAULT_AUTH_DATA);
    expect(state.credentialsAvailable()).toBe(false);
    subscription.unsubscribe();
  });

  it('exposes readonly signals and replaces names when another session is established', () => {
    state.establish({ sub: 'first', given_name: 'Ada', family_name: 'Example' });
    state.establish({ sub: 'second', preferred_username: 'another' });
    expect(state.userProfile()).toEqual({
      username: 'another', firstName: '', lastName: '', email: undefined
    });
    for (const value of [state.authData, state.isLoggedIn, state.loggedUser, state.userProfile, state.credentialsAvailable]) {
      expect(Reflect.get(value, 'set')).toBeUndefined();
      expect(Reflect.get(value, 'update')).toBeUndefined();
    }
    expect(Reflect.get(state.authData$, 'next')).toBeUndefined();
  });
});
