import { ComponentFixture, TestBed } from '@angular/core/testing';

import { KeycloakService } from 'keycloak-angular';
import { TranslateModule } from '@ngx-translate/core';
import { ActivatedRoute } from '@angular/router';
import { HttpClientModule } from '@angular/common/http';
import { HomeComponent } from './home.component';
import { AuthService } from '../../auth/service/auth.service';
import { environment } from '../../../environments/environment';

describe('HomeComponent', () => {
  let component: HomeComponent;
  let fixture: ComponentFixture<HomeComponent>;

  const fakeActivatedRoute = {
    snapshot: { data: { } }
  } as ActivatedRoute;
  // class MockAuthService {}
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HttpClientModule, HomeComponent, TranslateModule.forRoot()],
      providers: [KeycloakService, AuthService, {
        provide: ActivatedRoute,
        useValue: fakeActivatedRoute
      }, {
        provide: 'SERVER_URL',
        useValue: environment.backendUrl
      }]
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
