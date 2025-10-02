import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import {
  BehaviorSubject,
  Observable,
  Subject
} from 'rxjs';
import { DecodedToken } from '../core/services/auth.service';
import { AppLogoDto } from '../../../../../api-dto/app-logo-dto';
import { AuthDataDto } from '../../../../../api-dto/auth-data-dto';
import { AppHttpError } from '../core/interceptors/app-http-error.class';
import { CreateUserDto } from '../../../../../api-dto/user/create-user-dto';
import { LogoService } from './logo.service';
import { SERVER_URL } from '../injection-tokens';

export interface AuthIdentity {
  identity: string;
}

@Injectable({
  providedIn: 'root'
})
export class AppService {
  readonly serverUrl = inject(SERVER_URL);
  private http = inject(HttpClient);
  private logoService = inject(LogoService);

  static defaultAuthData = <AuthDataDto>{
    userId: 0,
    userName: '',
    email: '',
    firstName: '',
    lastName: '',
    workspaces: []
  };

  user !:CreateUserDto;
  isLoggedIn = false;
  errorMessagesDisabled = false;
  selectedWorkspaceId = 0;
  dataLoading: boolean | number = false;
  appLogo: AppLogoDto = standardLogo;
  postMessage$ = new Subject<MessageEvent>();
  loggedUser: DecodedToken | undefined;
  errorMessages: AppHttpError[] = [];
  errorMessageCounter = 0;
  authHeader = { Authorization: `Bearer ${localStorage.getItem('auth_token')}` };
  backendUnavailable = false;
  needsReAuthentication = false;

  authHeader = { Authorization: `Bearer ${localStorage.getItem('id_token')}` };
  constructor() {
    this.loadLogoSettings();
  }

  createToken(workspace_id: number, identity: string, duration: number): Observable<string> {
    return this.http.get<string>(
      `${this.serverUrl}admin/workspace/${workspace_id}/${identity}/token/${duration}`,
      { headers: this.authHeader }
    );
  }

  getAuthData(authObj: AuthIdentity): Observable<AuthDataDto> {
    return this.http.get<AuthDataDto>(
      `${this.serverUrl}auth-data?identity=${authObj.identity}`,
      { headers: this.authHeader }
    );
  }

  refreshAuthData(): void {
    if (this.loggedUser?.sub) {
      this.getAuthData({ identity: this.loggedUser.sub }).subscribe(authData => {
        this.updateAuthData(authData);
      });
    }
  }

  private loadLogoSettings(): void {
    this.logoService.getLogoSettings().subscribe({
      next: settings => {
        if (settings) {
          this.appLogo = settings;
        }
      },
      error: () => {
        this.appLogo = standardLogo;
      }
    });
  }

  private authDataSubject = new BehaviorSubject<AuthDataDto>(AppService.defaultAuthData);

  get authData$() {
    return this.authDataSubject.asObservable();
  }

  get authData(): AuthDataDto {
    return this.authDataSubject.value;
  }

  set authData(newAuthData: AuthDataDto) {
    this.authDataSubject.next(newAuthData);
  }

  get userId(): number {
    return this.authDataSubject.value.userId;
  }

  updateAuthData(newAuthData: AuthDataDto): void {
    this.authDataSubject.next(newAuthData);
  }

  processMessagePost(postData: MessageEvent): void {
    const msgData = postData.data;
    const msgType = msgData.type;
    if ((typeof msgType !== 'undefined') && (msgType !== null)) {
      this.postMessage$.next(postData);
    }
  }

  addErrorMessage(error: AppHttpError) {
    if (!this.errorMessagesDisabled) {
      const alikeErrors = this.errorMessages.filter(e => e.status === error.status);
      if (alikeErrors.length > 0) {
        alikeErrors[0].message += `; ${error.message}`;
      } else {
        this.errorMessageCounter += 1;
        error.id = this.errorMessageCounter;
        this.errorMessages.push(error);
      }
    }
  }

  setBackendUnavailable(unavailable: boolean): void {
    this.backendUnavailable = unavailable;
  }

  setNeedsReAuthentication(needs: boolean): void {
    this.needsReAuthentication = needs;
  }
}

export const standardLogo: AppLogoDto = {
  data: 'assets/images/IQB-LogoA.png',
  alt: 'Zur Startseite',
  bodyBackground: 'linear-gradient(180deg, rgba(7,70,94,1) 0%, rgba(6,112,123,1) 24%, rgba(1,192,229,1) 85%)',
  boxBackground: 'lightgray'
};
