import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { MatIconModule } from '@angular/material/icon';
import { Subject, of } from 'rxjs';
import { WorkspaceAccessRightsDialogComponent } from './workspace-access-rights-dialog.component';
import { UserBackendService } from '../../../shared/services/user/user-backend.service';
import { WorkspaceBackendService } from '../../../workspace/services/workspace-backend.service';

describe('WorkspaceAccessRightsDialogComponent', () => {
  let component: WorkspaceAccessRightsDialogComponent;
  let fixture: ComponentFixture<WorkspaceAccessRightsDialogComponent>;
  let workspacesByUser$: Subject<number[]>;
  let userBackendService: {
    getWorkspacesByUserListOrFail: jest.Mock;
  };

  beforeEach(async () => {
    workspacesByUser$ = new Subject<number[]>();
    userBackendService = {
      getWorkspacesByUserListOrFail: jest.fn().mockReturnValue(workspacesByUser$)
    };

    await TestBed.configureTestingModule({
      providers: [{
        provide: MAT_DIALOG_DATA,
        useValue: {
          selectedUser: [{ id: 5, username: 'user-5' }]
        }
      },
      {
        provide: UserBackendService,
        useValue: userBackendService
      },
      {
        provide: WorkspaceBackendService,
        useValue: {
          getAllWorkspacesList: jest.fn().mockReturnValue(of({
            data: [
              { id: 2, name: 'Workspace 2' },
              { id: 3, name: 'Workspace 3' }
            ],
            total: 2,
            page: 1,
            limit: 20
          }))
        }
      }
      ],
      imports: [
        TranslateModule.forRoot(),
        MatDialogModule,
        MatIconModule
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(WorkspaceAccessRightsDialogComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('initializes selected workspaces as the dialog result', () => {
    fixture.detectChanges();

    workspacesByUser$.next([2, 3]);
    workspacesByUser$.complete();
    fixture.detectChanges();

    expect(userBackendService.getWorkspacesByUserListOrFail).toHaveBeenCalledWith(5);
    expect(component.selectedWorkspacesIds).toEqual([2, 3]);
    expect(component.result).toEqual([2, 3]);
    expect(component.isLoadingUserWorkspaces).toBe(false);
    expect(component.userWorkspacesLoadingFailed).toBe(false);
  });

  it('disables save while user workspaces are loading', () => {
    fixture.detectChanges();

    const saveButton = fixture.nativeElement.querySelector('mat-dialog-actions button');

    expect(component.isLoadingUserWorkspaces).toBe(true);
    expect(saveButton.disabled).toBe(true);
  });

  it('disables save when user workspaces cannot be loaded', () => {
    fixture.detectChanges();

    workspacesByUser$.error(new Error('database unavailable'));
    fixture.detectChanges();

    const saveButton = fixture.nativeElement.querySelector('mat-dialog-actions button');

    expect(component.selectedWorkspacesIds).toEqual([]);
    expect(component.result).toEqual([]);
    expect(component.isLoadingUserWorkspaces).toBe(false);
    expect(component.userWorkspacesLoadingFailed).toBe(true);
    expect(saveButton.disabled).toBe(true);
  });
});
