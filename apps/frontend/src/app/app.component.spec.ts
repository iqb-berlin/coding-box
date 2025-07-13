import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { InjectionToken } from '@angular/core';
import { KeycloakService } from 'keycloak-angular';
import { AppComponent } from './app.component';
import { environment } from '../environments/environment';
import { AuthService } from './core/services/auth.service';

export const AUTH_TOKEN = new InjectionToken<string>('AUTH_TOKEN');
const mockAuthService = {
  isLoggedIn: jest.fn(() => true)
};

const mockKeycloakService = {
  isLoggedIn: () => true,
  getToken: () => 'mocked-jwt-token',
  login: jest.fn(),
  logout: jest.fn()
};

describe('AppComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [provideHttpClient(), { provide: AUTH_TOKEN, useValue: 'dummy-auth-token' },
        { provide: AuthService, useValue: mockAuthService },
        { provide: KeycloakService, useValue: mockKeycloakService },

        {
          provide: 'SERVER_URL',
          useValue: environment.backendUrl
        }],
      imports: [AppComponent]
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });
});
