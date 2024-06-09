import { TestBed } from '@angular/core/testing';
import { KeycloakService } from 'keycloak-angular';
import { HttpClientModule } from '@angular/common/http';
import { AppComponent } from './app.component';
import { environment } from '../environments/environment';

describe('AppComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [KeycloakService, {
        provide: 'SERVER_URL',
        useValue: environment.backendUrl
      }],
      imports: [AppComponent, HttpClientModule]
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });
});
