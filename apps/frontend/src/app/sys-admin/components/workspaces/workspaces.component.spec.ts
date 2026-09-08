// eslint-disable-next-line max-classes-per-file
import {
  ComponentFixture, fakeAsync, TestBed, tick
} from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { UntypedFormControl, UntypedFormGroup } from '@angular/forms';
import { MatTableModule } from '@angular/material/table';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialogModule } from '@angular/material/dialog';

import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { WorkspacesComponent } from './workspaces.component';
import { WorkspaceBackendService } from '../../../workspace/services/workspace-backend.service';
import { AppService } from '../../../core/services/app.service';

describe('WorkspaceGroupsComponent', () => {
  let component: WorkspacesComponent;
  let fixture: ComponentFixture<WorkspacesComponent>;
  let workspaceBackendService: {
    getAllWorkspacesList: jest.Mock;
    addWorkspace: jest.Mock;
    changeWorkspace: jest.Mock;
    deleteWorkspace: jest.Mock;
    setWorkspaceUsersAccessRight: jest.Mock;
  };
  let appService: { dataLoading: boolean; refreshAuthData: jest.Mock };
  let snackBar: { open: jest.Mock };

  beforeEach(async () => {
    workspaceBackendService = {
      getAllWorkspacesList: jest.fn().mockReturnValue(of({
        data: [], total: 0, page: 1, limit: 10
      })),
      addWorkspace: jest.fn().mockReturnValue(of(17)),
      changeWorkspace: jest.fn().mockReturnValue(of(true)),
      deleteWorkspace: jest.fn().mockReturnValue(of(true)),
      setWorkspaceUsersAccessRight: jest.fn().mockReturnValue(of(true))
    };
    appService = {
      dataLoading: false,
      refreshAuthData: jest.fn().mockReturnValue(of('updated'))
    };
    snackBar = { open: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [
        MatDialogModule,
        MatCheckboxModule,
        MatTooltipModule,
        MatIconModule,
        MatTableModule,
        NoopAnimationsModule,
        TranslateModule.forRoot()
      ],
      providers: [
        { provide: WorkspaceBackendService, useValue: workspaceBackendService },
        { provide: AppService, useValue: appService },
        {
          provide: MatSnackBar,
          useValue: snackBar
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(WorkspacesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should refresh auth data after creating a workspace', () => {
    const form = new UntypedFormGroup({ name: new UntypedFormControl('New') });

    component.addWorkspace(form);

    expect(workspaceBackendService.addWorkspace).toHaveBeenCalledWith({ name: 'New', settings: {} });
    expect(appService.refreshAuthData).toHaveBeenCalledTimes(1);
    expect(component.workspacesChanged).toBe(true);
  });

  it('should refresh auth data after renaming a workspace', () => {
    const form = new UntypedFormGroup({ name: new UntypedFormControl('Renamed') });

    component.editWorkspace({ selection: [3], formData: form });

    expect(workspaceBackendService.changeWorkspace).toHaveBeenCalledWith({ id: 3, name: 'Renamed' });
    expect(appService.refreshAuthData).toHaveBeenCalledTimes(1);
    expect(component.workspacesChanged).toBe(true);
  });

  it('should refresh auth data after deleting a workspace', fakeAsync(() => {
    component.deleteWorkspace([3]);
    tick(1000);

    expect(appService.refreshAuthData).toHaveBeenCalledTimes(1);
    expect(component.workspacesChanged).toBe(true);
    expect(component.isDeleting).toBe(false);
  }));

  it('should refresh auth data after changing workspace users', () => {
    component.selectedWorkspaces = [3];

    component.setWorkspaceUsersAccessRight([7, 8]);

    expect(workspaceBackendService.setWorkspaceUsersAccessRight).toHaveBeenCalledWith(3, [7, 8]);
    expect(appService.refreshAuthData).toHaveBeenCalledTimes(1);
  });

  it('should not refresh auth data after a failed workspace mutation', () => {
    workspaceBackendService.addWorkspace.mockReturnValueOnce(of(null));
    const form = new UntypedFormGroup({ name: new UntypedFormControl('New') });

    component.addWorkspace(form);

    expect(appService.refreshAuthData).not.toHaveBeenCalled();
    expect(component.workspacesChanged).toBe(false);
  });

  it('should keep a successful mutation while reporting a failed auth data refresh', () => {
    appService.refreshAuthData.mockReturnValueOnce(of('failed'));
    const form = new UntypedFormGroup({ name: new UntypedFormControl('New') });

    component.addWorkspace(form);

    expect(component.workspacesChanged).toBe(true);
    expect(snackBar.open).toHaveBeenCalledWith(
      'admin.change-saved-auth-data-refresh-failed',
      'error',
      { duration: 5000 }
    );
  });

  it('should not show an obsolete message after the auth context changed', () => {
    appService.refreshAuthData.mockReturnValueOnce(of('invalidated'));
    const form = new UntypedFormGroup({ name: new UntypedFormControl('New') });

    component.addWorkspace(form);

    expect(component.workspacesChanged).toBe(true);
    expect(snackBar.open).not.toHaveBeenCalled();
  });
});
