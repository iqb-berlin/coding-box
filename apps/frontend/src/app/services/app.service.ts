import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { AppLogoDto } from '../../../api-dto/app-logo-dto';
import { AuthDataDto } from '../../../api-dto/auth-data-dto';
import { KeycloakProfile } from 'keycloak-js';

@Injectable({
  providedIn: 'root'
})
export class AppService {
  static defaultAuthData = <AuthDataDto>{
    userId: '0',
    userName: '',
    email: '',
    firstName: '',
    lastName: '',
    workspaces: []
  };

  userProfile: KeycloakProfile = {};
  isLoggedInKeycloak = false;
  errorMessagesDisabled = false;
  globalWarning = '';
  authData = AppService.defaultAuthData;
  dataLoading: boolean | number = false;
  appLogo: AppLogoDto = standardLogo;
  postMessage$ = new Subject<MessageEvent>();
  processMessagePost(postData: MessageEvent): void {
    const msgData = postData.data;
    const msgType = msgData.type;
    if ((typeof msgType !== 'undefined') && (msgType !== null)) {
      this.postMessage$.next(postData);
    }
  }
}

export const standardLogo: AppLogoDto = {
  data: 'assets/IQB-LogoA.png',
  alt: 'Zur Startseite',
  // eslint-disable-next-line max-len
  bodyBackground: 'linear-gradient(180deg, rgba(7,70,94,1) 0%, rgba(6,112,123,1) 24%, rgba(1,192,229,1) 85%)',
  boxBackground: 'lightgray',
};
