import { Inject, Injectable } from '@angular/core';
import { KeycloakService } from 'keycloak-angular';
import { KeycloakProfile, KeycloakTokenParsed } from 'keycloak-js';
import { catchError, map, Observable, of } from 'rxjs';
import { HttpClient, HttpHeaders } from '@angular/common/http';

@Injectable()
export class AuthService {
  constructor(private keycloakService: KeycloakService, private http: HttpClient, @Inject('SERVER_URL') private readonly serverUrl: string) {
  }

  getLoggedUser(): KeycloakTokenParsed | undefined {
    try {
      return this.keycloakService.getKeycloakInstance()
        .idTokenParsed;
    } catch (e) {
      return { message: 'Parsing id token failed', err: e };
    }
  }

  getToken() {
    let  returnToken ='';
     this.keycloakService.getToken().then(token =>  returnToken = token);
     console.log('TOKEN', returnToken);
    return returnToken;
  }

  isLoggedIn(): boolean {
    return this.keycloakService.isLoggedIn();
  }

  loadUserProfile(): Promise<KeycloakProfile> {
    return this.keycloakService.loadUserProfile();
  }

  async login(): Promise<void> {
    await this.keycloakService.login();
  }

  async logout(): Promise<void> {
    await this.keycloakService.logout(window.location.origin);
  }

  async redirectToProfile(): Promise<void> {
    await this.keycloakService.getKeycloakInstance().accountManagement();
  }

  setPassword(new_password:string, token:string): Observable<any> {
    return this.http
      .post<any>(`${this.serverUrl}/`,{ token:token,new_password:new_password }).pipe(
        catchError(() => of(false)),
        map(() => true)
      );
  }

  getRoles(): string[] {
    return this.keycloakService.getUserRoles();
  }
}
