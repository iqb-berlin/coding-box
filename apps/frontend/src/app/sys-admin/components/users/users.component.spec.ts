import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { Observable, of } from 'rxjs';
import { AuthDataDto } from '../../../../../../../api-dto/auth-data-dto';
import { UsersComponent } from './users.component';
import { UserBackendService } from '../../../shared/services/user/user-backend.service';
import { WorkspaceBackendService } from '../../../workspace/services/workspace-backend.service';
import { AppService } from '../../../core/services/app.service';

describe('UsersComponent', () => {
  let component: UsersComponent;
  let userBackendService: { setUserWorkspaceAccessRight: jest.Mock };
  let appService: {
    dataLoading: boolean;
    authData$: Observable<AuthDataDto>;
    refreshAuthData: jest.Mock;
  };
  let snackBar: { open: jest.Mock };

  beforeEach(() => {
    userBackendService = {
      setUserWorkspaceAccessRight: jest.fn().mockReturnValue(of(true))
    };
    appService = {
      dataLoading: false,
      authData$: of(AppService.defaultAuthData),
      refreshAuthData: jest.fn().mockReturnValue(of(true))
    };
    snackBar = { open: jest.fn() };

    TestBed.configureTestingModule({
      providers: [
        { provide: UserBackendService, useValue: userBackendService },
        { provide: WorkspaceBackendService, useValue: {} },
        { provide: AppService, useValue: appService },
        { provide: MatSnackBar, useValue: snackBar },
        { provide: TranslateService, useValue: { instant: (key: string) => key } }
      ]
    });

    component = TestBed.runInInjectionContext(() => new UsersComponent());
    component.selectedUsers = [7];
  });

  it('should refresh auth data after assigning workspaces to a user', () => {
    component.setUserWorkspaceAccessRight([2, 3]);

    expect(userBackendService.setUserWorkspaceAccessRight).toHaveBeenCalledWith(7, [2, 3]);
    expect(appService.refreshAuthData).toHaveBeenCalledTimes(1);
    expect(snackBar.open).toHaveBeenCalledWith('admin.workspace-access-right-set', '', { duration: 1000 });
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
    appService.refreshAuthData.mockReturnValueOnce(of(false));

    component.setUserWorkspaceAccessRight([2]);

    expect(snackBar.open).toHaveBeenCalledWith(
      'admin.change-saved-auth-data-refresh-failed',
      'error',
      { duration: 5000 }
    );
  });
});
