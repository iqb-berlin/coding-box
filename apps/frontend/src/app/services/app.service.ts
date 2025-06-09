import { Injectable } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';
import { KeycloakProfile, KeycloakTokenParsed } from 'keycloak-js';
import { AppLogoDto } from '../../../../../api-dto/app-logo-dto';
import { AuthDataDto } from '../../../../../api-dto/auth-data-dto';
import { AppHttpError } from '../interceptors/app-http-error.class';
import { TestGroupsInListDto } from '../../../../../api-dto/test-groups/testgroups-in-list.dto';
import { FilesInListDto } from '../../../../../api-dto/files/files-in-list.dto';
import { CreateUserDto } from '../../../../../api-dto/user/create-user-dto';
import { LogoService } from './logo.service';

type WorkspaceData = {
  testGroups: TestGroupsInListDto[];
  testFiles: { data:FilesInListDto[] };
  settings: unknown;
  selectUnitPlay: unknown;
};
@Injectable({
  providedIn: 'root'
})
export class AppService {
  static defaultAuthData = <AuthDataDto>{
    userId: 0,
    userName: '',
    email: '',
    firstName: '',
    lastName: '',
    workspaces: []
  };

  kcUser !:CreateUserDto;
  userProfile: KeycloakProfile = {};
  isLoggedInKeycloak = false;
  errorMessagesDisabled = false;
  selectedWorkspaceId = 0;
  dataLoading: boolean | number = false;
  appLogo: AppLogoDto = standardLogo;
  postMessage$ = new Subject<MessageEvent>();
  loggedUser: KeycloakTokenParsed | undefined;
  errorMessages: AppHttpError[] = [];
  errorMessageCounter = 0;
  workspaceData : WorkspaceData = {
    testGroups: [],
    testFiles: { data: [] },
    settings: {},
    selectUnitPlay: {}
  };

  constructor(private logoService: LogoService) {
    // Load saved logo settings when the application starts
    this.loadLogoSettings();
  }

  /**
   * Loads saved logo settings from the server
   */
  private loadLogoSettings(): void {
    this.logoService.getLogoSettings().subscribe({
      next: settings => {
        if (settings) {
          this.appLogo = settings;
        }
      },
      error: error => {
        console.error('Error loading logo settings:', error);
        this.appLogo = standardLogo;
      }
    });
  }

  private authDataSubject = new BehaviorSubject<AuthDataDto>(AppService.defaultAuthData);

  get authData$() {
    return this.authDataSubject.asObservable();
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
}

export const standardLogo: AppLogoDto = {
  data: 'assets/IQB-LogoA.png',
  alt: 'Zur Startseite',
  // eslint-disable-next-line max-len
  bodyBackground: 'linear-gradient(180deg, rgba(7,70,94,1) 0%, rgba(6,112,123,1) 24%, rgba(1,192,229,1) 85%)',
  boxBackground: 'lightgray'
};
