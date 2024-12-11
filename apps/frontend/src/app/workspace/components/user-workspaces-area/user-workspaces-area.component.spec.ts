// eslint-disable-next-line max-classes-per-file
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, Input } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { KeycloakService } from 'keycloak-angular';
import { UserWorkspacesAreaComponent } from './user-workspaces-area.component';
import { environment } from '../../../../environments/environment';
import { HomeComponent } from '../../../components/home/home.component';
import { BackendService } from '../../../services/backend.service';
import { AuthService } from '../../../auth/service/auth.service';

describe('UserWorkspacesAreaComponent', () => {
  let component: UserWorkspacesAreaComponent;
  let fixture: ComponentFixture<UserWorkspacesAreaComponent>;

  @Component({ selector: 'coding-box-user-menu', template: '' })
  class MockUserMenuComponent {}

  @Component({ selector: 'coding-box-warning', template: '' })
  class MockWarningComponent {
    @Input() warnMessage!: string;
  }

  @Component({ selector: 'coding-box-area-title', template: '' })
  class MockAreaTitleComponent {
    @Input() title!: string;
  }

  @Component({ selector: 'coding-box-wrapped-icon', template: '' })
  class MockWrappedIconComponent {
    @Input() icon!: string;
  }

  class MockBackendService {}

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        TranslateModule.forRoot()
      ],
      providers: [
        KeycloakService,
        {
          provide: BackendService,
          useValue: MockBackendService
        },
        AuthService,
        {
          provide: 'SERVER_URL',
          useValue: environment.backendUrl
        }]
    }).overrideComponent(HomeComponent, {
      remove: {
        imports: [
        ]
      },
      add: {
        imports: [
          MockUserMenuComponent,
          MockAreaTitleComponent,
          MockWarningComponent,
          MockWrappedIconComponent
        ]
      }
    }).compileComponents();

    fixture = TestBed.createComponent(UserWorkspacesAreaComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
