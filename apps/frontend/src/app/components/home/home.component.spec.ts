import { ComponentFixture, TestBed } from '@angular/core/testing';

import { KeycloakService } from 'keycloak-angular';
import { TranslateModule } from '@ngx-translate/core';
import { ActivatedRoute } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HomeComponent } from './home.component';
import { AuthService } from '../../auth/service/auth.service';
import { environment } from '../../../environments/environment';

const mockKeycloakService = {
  idTokenParsed: {} // Mock-Daten
  // Fügen Sie weitere Methoden oder Eigenschaften hinzu, falls nötig
};

describe('HomeComponent', () => {
  let component: HomeComponent;
  let fixture: ComponentFixture<HomeComponent>;

  const fakeActivatedRoute = {
    snapshot: { data: { } }
  } as ActivatedRoute;
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HomeComponent, TranslateModule.forRoot()],
      providers: [{ provide: KeycloakService, useValue: mockKeycloakService },
        AuthService, {
          provide: ActivatedRoute,
          useValue: fakeActivatedRoute
        }, {
          provide: 'SERVER_URL',
          useValue: environment.backendUrl
        }, provideHttpClient()]
    })
      .compileComponents();

    fixture = TestBed.createComponent(HomeComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
