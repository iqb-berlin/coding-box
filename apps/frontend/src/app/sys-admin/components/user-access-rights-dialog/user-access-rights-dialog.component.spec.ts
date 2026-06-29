import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { MatIconModule } from '@angular/material/icon';
import { of, throwError } from 'rxjs';
import { UserAccessRightsDialogComponent } from './user-access-rights-dialog.component';
import { environment } from '../../../../environments/environment';
import { SERVER_URL } from '../../../injection-tokens';
import { WorkspaceBackendService } from '../../../workspace/services/workspace-backend.service';
import { UserBackendService } from '../../../shared/services/user/user-backend.service';

describe('UserAccessRightsDialogComponent', () => {
  const workspaceBackendService = {
    getAllWorkspaceUsers: jest.fn(),
    getAllWorkspacesList: jest.fn()
  };
  const userBackendService = {
    getUsersFull: jest.fn()
  };

  function createComponent(dialogData: { selectedWorkspace?: number[] } = {}):
  ComponentFixture<UserAccessRightsDialogComponent> {
    TestBed.overrideProvider(MAT_DIALOG_DATA, { useValue: dialogData });
    const fixture = TestBed.createComponent(UserAccessRightsDialogComponent);
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(async () => {
    workspaceBackendService.getAllWorkspaceUsers.mockReset();
    workspaceBackendService.getAllWorkspacesList.mockReset();
    userBackendService.getUsersFull.mockReset();
    workspaceBackendService.getAllWorkspaceUsers.mockReturnValue(of([]));
    workspaceBackendService.getAllWorkspacesList.mockReturnValue(of({ data: [], total: 0 }));
    userBackendService.getUsersFull.mockReturnValue(of([]));

    await TestBed.configureTestingModule({
      providers: [{
        provide: MAT_DIALOG_DATA,
        useValue: {}

      }, {
        provide: SERVER_URL,
        useValue: environment.backendUrl
      },
      provideHttpClient(),
      {
        provide: WorkspaceBackendService,
        useValue: workspaceBackendService
      },
      {
        provide: UserBackendService,
        useValue: userBackendService
      }
      ],
      imports: [
        TranslateModule.forRoot(),
        MatDialogModule,
        MatIconModule
      ]
    }).compileComponents();
  });

  it('should create', () => {
    const fixture = createComponent();
    const component = fixture.componentInstance;

    expect(component).toBeTruthy();
  });

  it('should initialize the saved result from loaded workspace users', () => {
    workspaceBackendService.getAllWorkspaceUsers.mockReturnValue(of([
      {
        workspaceId: 1, userId: 7, accessLevel: 3, canCode: false
      },
      {
        workspaceId: 1, userId: 8, accessLevel: 1, canCode: true
      }
    ]));

    const fixture = createComponent({ selectedWorkspace: [1] });
    const component = fixture.componentInstance;

    expect(component.selectedUserIds).toEqual([7, 8]);
    expect(component.result).toEqual([7, 8]);
    expect(component.isLoadingWorkspaceUsers).toBe(false);
    expect(component.workspaceUsersLoadingFailed).toBe(false);
  });

  it('should disable saving when loading workspace users fails', () => {
    workspaceBackendService.getAllWorkspaceUsers.mockReturnValue(throwError(() => new Error('load failed')));

    const fixture = createComponent({ selectedWorkspace: [1] });
    const component = fixture.componentInstance;

    expect(component.result).toEqual([]);
    expect(component.isLoadingWorkspaceUsers).toBe(false);
    expect(component.workspaceUsersLoadingFailed).toBe(true);
    const saveButton: HTMLButtonElement = fixture.nativeElement.querySelector('button[color="primary"]');
    expect(saveButton.disabled).toBe(true);
  });
});
