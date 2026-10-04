import { ChangeDetectorRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { Observable, of, Subject } from 'rxjs';
import { FormControl, FormGroup } from '@angular/forms';
import { AuthDataDto } from '../../../../../../../api-dto/auth-data-dto';
import { UsersComponent } from './users.component';
import { UserBackendService } from '../../../shared/services/user/user-backend.service';
import { WorkspaceBackendService } from '../../../workspace/services/workspace-backend.service';
import { AppService } from '../../../core/services/app.service';

describe('UsersComponent', () => {
  let component: UsersComponent;
  let userBackendService: { setUserWorkspaceAccessRight: jest.Mock; changeUserData: jest.Mock };
  let appService: {
    dataLoading: boolean;
    authData$: Observable<AuthDataDto>;
    refreshAuthData: jest.Mock;
  };
  let snackBar: { open: jest.Mock };

  beforeEach(() => {
    userBackendService = {
      setUserWorkspaceAccessRight: jest.fn().mockReturnValue(of(true)),
      changeUserData: jest.fn().mockReturnValue(of(true))
    };
    appService = {
      dataLoading: false,
      authData$: of(AppService.defaultAuthData),
      refreshAuthData: jest.fn().mockReturnValue(of('updated'))
    };
    snackBar = { open: jest.fn() };

    TestBed.configureTestingModule({
      providers: [
        { provide: UserBackendService, useValue: userBackendService },
        { provide: WorkspaceBackendService, useValue: {} },
        { provide: AppService, useValue: appService },
        { provide: MatSnackBar, useValue: snackBar },
        { provide: ChangeDetectorRef, useValue: { markForCheck: jest.fn() } },
        { provide: TranslateService, useValue: { instant: (key: string) => key } }
      ]
    });

    component = TestBed.runInInjectionContext(() => new UsersComponent());
    component.selectedUsers.set([7]);
  });

  it('should refresh auth data after assigning workspaces to a user', () => {
    component.setUserWorkspaceAccessRight([2, 3]);

    expect(userBackendService.setUserWorkspaceAccessRight).toHaveBeenCalledWith(7, [2, 3]);
    expect(appService.refreshAuthData).toHaveBeenCalledTimes(1);
    expect(snackBar.open).toHaveBeenCalledWith('admin.workspace-access-right-set', '', { duration: 1000 });
  });

  it('sends the disabled username and false admin value without losing fields', () => {
    jest.spyOn(component, 'updateUserList').mockImplementation(() => undefined);
    const form = new FormGroup({
      username: new FormControl({ value: 'existing-user', disabled: true }, { nonNullable: true }),
      isAdmin: new FormControl(false, { nonNullable: true })
    });
    component.editUser({ selection: [{ id: 7, username: 'existing-user', isAdmin: true }], user: form });
    expect(userBackendService.changeUserData).toHaveBeenCalledWith(AppService.defaultAuthData.userId, {
      id: 7, username: 'existing-user', isAdmin: false
    });
  });

  it('clears the global loading flag when a pending edit is cancelled with the view', () => {
    const response = new Subject<boolean>();
    userBackendService.changeUserData.mockReturnValue(response);
    const refreshList = jest.spyOn(component, 'updateUserList').mockImplementation(() => undefined);
    const form = new FormGroup({
      username: new FormControl('existing-user', { nonNullable: true }),
      isAdmin: new FormControl(false, { nonNullable: true })
    });
    component.editUser({ selection: [{ id: 7, username: 'existing-user', isAdmin: true }], user: form });
    expect(appService.dataLoading).toBe(true);
    TestBed.resetTestingModule();
    expect(response.observed).toBe(false);
    expect(appService.dataLoading).toBe(false);
    response.next(true);
    expect(refreshList).not.toHaveBeenCalled();
    expect(snackBar.open).not.toHaveBeenCalled();
  });

  it('should refresh auth data after removing all workspace assignments', () => {
    component.setUserWorkspaceAccessRight([]);

    expect(userBackendService.setUserWorkspaceAccessRight).toHaveBeenCalledWith(7, []);
    expect(appService.refreshAuthData).toHaveBeenCalledTimes(1);
  });

  it('should not refresh auth data when assigning workspaces fails', () => {
    userBackendService.setUserWorkspaceAccessRight.mockReturnValueOnce(of(false));

    component.setUserWorkspaceAccessRight([2]);

    expect(appService.refreshAuthData).not.toHaveBeenCalled();
    expect(snackBar.open).toHaveBeenCalledWith(
      'admin.workspace-access-right-not-set',
      'error',
      { duration: 3000 }
    );
  });

  it('should report a saved mutation separately from a failed auth data refresh', () => {
    appService.refreshAuthData.mockReturnValueOnce(of('failed'));

    component.setUserWorkspaceAccessRight([2]);

    expect(snackBar.open).toHaveBeenCalledWith(
      'admin.change-saved-auth-data-refresh-failed',
      'error',
      { duration: 5000 }
    );
  });

  it('should not show an obsolete message after the auth context changed', () => {
    appService.refreshAuthData.mockReturnValueOnce(of('invalidated'));

    component.setUserWorkspaceAccessRight([2]);

    expect(snackBar.open).not.toHaveBeenCalled();
  });
});
