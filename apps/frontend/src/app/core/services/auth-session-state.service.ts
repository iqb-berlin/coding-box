import { computed, Injectable, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { BehaviorSubject } from 'rxjs';
import { AuthDataDto } from '../../../../../../api-dto/auth-data-dto';
import { CreateUserDto } from '../../../../../../api-dto/user/create-user-dto';
import { DecodedToken } from './auth.models';

export const DEFAULT_AUTH_DATA: AuthDataDto = {
  userId: 0, userName: '', email: '', firstName: '', lastName: '', isAdmin: false, workspaces: []
};

interface SessionIdentity {
  credentialsAvailable: boolean;
  accepted: boolean;
  claims: DecodedToken | undefined;
  profile: Partial<CreateUserDto>;
}

const emptyIdentity = (): SessionIdentity => ({
  credentialsAvailable: false, accepted: false, claims: undefined, profile: {}
});

/** Shared session state. Token transport and backend bootstrap retain their own lifecycles. */
@Injectable({ providedIn: 'root' })
export class AuthSessionState {
  private readonly identity = signal<SessionIdentity>(emptyIdentity());
  // Guards need synchronous notifications, including during a permission refresh.
  private readonly authDataSubject = new BehaviorSubject<AuthDataDto>(DEFAULT_AUTH_DATA);
  readonly authData$ = this.authDataSubject.asObservable();
  readonly authData = toSignal(this.authData$, { requireSync: true });
  // Recoverable stored credentials and an accepted UI session are distinct states.
  readonly credentialsAvailable = computed(() => this.identity().credentialsAvailable);
  readonly isLoggedIn = computed(() => this.identity().accepted);
  readonly loggedUser = computed(() => this.identity().claims);
  readonly userProfile = computed(() => this.identity().profile);

  establish(claims: DecodedToken | undefined): void {
    this.identity.set({
      credentialsAvailable: true,
      accepted: true,
      claims,
      profile: {
        username: claims?.preferred_username,
        firstName: claims?.given_name || '',
        lastName: claims?.family_name || '',
        email: claims?.email
      }
    });
  }

  setCredentialsAvailable(credentialsAvailable: boolean): void {
    this.identity.update(current => ({ ...current, credentialsAvailable }));
  }

  // Compatibility commands for existing AppService consumers.
  setLoggedIn(accepted: boolean): void {
    this.identity.update(current => ({ ...current, accepted }));
  }

  setClaims(claims: DecodedToken | undefined): void {
    this.identity.update(current => ({ ...current, claims }));
  }

  setProfile(profile: Partial<CreateUserDto>): void {
    this.identity.update(current => ({ ...current, profile }));
  }

  updateAuthData(authData: AuthDataDto): void {
    this.authDataSubject.next(authData);
  }

  clear(): void {
    this.identity.set(emptyIdentity());
    this.authDataSubject.next(DEFAULT_AUTH_DATA);
  }
}
