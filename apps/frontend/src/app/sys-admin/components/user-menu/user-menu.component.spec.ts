import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { KeycloakService } from 'keycloak-angular';
import { HttpClientModule } from '@angular/common/http';
import { UserMenuComponent } from './user-menu.component';
import { AuthService } from '../../../auth/service/auth.service';
import { environment } from '../../../../environments/environment';

describe('UserMenuComponent', () => {
  let component: UserMenuComponent;
  let fixture: ComponentFixture<UserMenuComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [AuthService, KeycloakService, {
        provide: 'SERVER_URL',
        useValue: environment.backendUrl
      }],
      imports: [
        HttpClientModule,
        UserMenuComponent,
        TranslateModule.forRoot()
      ]
    })
      .compileComponents();
    fixture = TestBed.createComponent(UserMenuComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
