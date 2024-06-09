import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { KeycloakProfile, KeycloakTokenParsed } from 'keycloak-js';
import { AppLogoDto } from '../../../../../api-dto/app-logo-dto';
import { AuthDataDto } from '../../../../../api-dto/auth-data-dto';
import { AppHttpError } from '../interceptors/app-http-error.class';
import { TestGroupsInListDto } from '../../../../../api-dto/test-groups/testgroups-in-list.dto';
import { FilesInListDto } from '../../../../../api-dto/files/files-in-list.dto';

type WorkspaceData = {
  testGroups: TestGroupsInListDto[];
  testFiles: FilesInListDto[];
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

  userProfile: KeycloakProfile = {};
  isLoggedInKeycloak = false;
  errorMessagesDisabled = false;
  selectedWorkspaceId = 0;
  authData = AppService.defaultAuthData;
  dataLoading: boolean | number = false;
  appLogo: AppLogoDto = standardLogo;
  postMessage$ = new Subject<MessageEvent>();
  loggedUser: KeycloakTokenParsed | undefined;
  errorMessages: AppHttpError[] = [];
  errorMessageCounter = 0;
  workspaceData : WorkspaceData = {
    testGroups: [],
    testFiles: [],
    settings: {},
    selectUnitPlay: {}
  };

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

  // removeErrorMessage(error: AppHttpError) {
  //   for (let i = 0; i < this.errorMessages.length; i++) {
  //     if (this.errorMessages[i].id === error.id) {
  //       this.errorMessages.splice(i, 1);
  //     }
  //   }
  // }
  //
  // clearErrorMessages() {
  //   this.errorMessages = [];
  // }
}

export const standardLogo: AppLogoDto = {
  data: 'assets/IQB-LogoA.png',
  alt: 'Zur Startseite',
  // eslint-disable-next-line max-len
  bodyBackground: 'linear-gradient(180deg, rgba(7,70,94,1) 0%, rgba(6,112,123,1) 24%, rgba(1,192,229,1) 85%)',
  boxBackground: 'lightgray'
};
