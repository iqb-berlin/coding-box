// eslint-disable-next-line max-classes-per-file
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { Component, Input } from '@angular/core';
import { UserMenuComponent } from './user-menu.component';
import { AccountActionComponent } from '../account-action/account-action.component';
import { WrappedIconComponent } from '../../../shared/wrapped-icon/wrapped-icon.component';
import { AuthService } from '../../../auth/service/auth.service';
import { KeycloakService } from 'keycloak-angular';
import { HttpService } from '@nestjs/axios';
import { createMock } from '@golevelup/ts-jest';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { environment } from '../../../../environments/environment';

describe('UserMenuComponent', () => {
  let component: UserMenuComponent;
  let fixture: ComponentFixture<UserMenuComponent>;

  @Component({ selector: 'coding-box-account-action', standalone: true, template: '' })
  class MockAccountActionComponentComponent {
    @Input() type!: string;
    @Input() iconName!: string;
  }

  @Component({ selector: 'coding-box-wrapped-icon', standalone: true, template: '' })
  class MockWrappedIconComponent {
    @Input() icon!: string;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [AuthService,KeycloakService,{
        provide: 'SERVER_URL',
        useValue: environment.backendUrl
      },],
      imports: [
        HttpClientModule,
        UserMenuComponent,
        TranslateModule.forRoot()
      ]
    }).overrideComponent(UserMenuComponent, {
      remove: {
        imports: [
          WrappedIconComponent,
          AccountActionComponent
        ]
      },
      add: { imports: [MockAccountActionComponentComponent, MockWrappedIconComponent] }
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
