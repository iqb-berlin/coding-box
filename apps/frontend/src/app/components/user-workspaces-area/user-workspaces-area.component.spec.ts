// eslint-disable-next-line max-classes-per-file
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, Input } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { UserWorkspacesAreaComponent } from './user-workspaces-area.component';
import { environment } from '../../../environments/environment';
import { HomeComponent } from '../home/home.component';
import { UserMenuComponent } from '../user-menu/user-menu.component';
import { BackendService } from '../../services/backend.service';


describe('UserWorkspacesAreaComponent', () => {
  let component: UserWorkspacesAreaComponent;
  let fixture: ComponentFixture<UserWorkspacesAreaComponent>;

  @Component({ selector: 'studio-lite-user-menu', template: '' })
  class MockUserMenuComponent {}

  @Component({ selector: 'studio-lite-user-workspaces-groups', template: '' })
  class MockUserWorkspacesGroupsComponent {
    //@Input() workspaceGroups!: WorkspaceGroupDto[];
  }

  @Component({ selector: 'studio-lite-warning', template: '' })
  class MockWarningComponent {
    @Input() warnMessage!: string;
  }

  @Component({ selector: 'studio-lite-area-title', template: '' })
  class MockAreaTitleComponent {
    @Input() title!: string;
  }

  @Component({ selector: 'studio-lite-wrapped-icon', template: '' })
  class MockWrappedIconComponent {
    @Input() icon!: string;
  }

  class MockBackendService {}

  class MockAuthService {}

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        TranslateModule.forRoot()
      ],
      providers: [
        {
          provide: BackendService,
          useValue: MockBackendService
        },
        {
          //provide: AuthService,
          useValue: MockAuthService
        },
        {
          provide: 'SERVER_URL',
          useValue: environment.backendUrl
        }]
    }).overrideComponent(HomeComponent, {
      remove: {
        imports: [

          UserMenuComponent,

        ]
      },
      add: {
        imports: [
          MockUserMenuComponent,
          MockUserWorkspacesGroupsComponent,
          MockAreaTitleComponent,
          MockWarningComponent,
          MockWrappedIconComponent
        ]
      }
    }).compileComponents();

    fixture = TestBed.createComponent(UserWorkspacesAreaComponent);
    component = fixture.componentInstance;
    //component.workspaceGroups = [];
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
