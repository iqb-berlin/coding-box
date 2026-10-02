import { provideZonelessChangeDetection } from '@angular/core';
import { delay } from 'rxjs/operators';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { WsAccessRightsComponent } from './ws-access-rights.component';
import { UserBackendService } from '../../../shared/services/user/user-backend.service';
import { AppService } from '../../../core/services/app.service';

describe('WsAccessRightsComponent', () => {
  let component: WsAccessRightsComponent;
  let fixture: ComponentFixture<WsAccessRightsComponent>;
  let mockUserBackendService: Partial<UserBackendService>;
  let mockAppService: Partial<AppService>;
  let mockSnackBar: Partial<MatSnackBar>;

  const mockUsers = [
    {
      id: 1, name: 'user1', displayName: 'User One', accessLevel: 1, canCode: true
    },
    {
      id: 2, name: 'user2', displayName: 'User Two', accessLevel: 2, canCode: false
    }
  ];

  beforeEach(async () => {
    mockUserBackendService = {
      getUsers: jest.fn().mockReturnValue(of(mockUsers)),
      saveUsers: jest.fn().mockReturnValue(of(true))
    };

    mockAppService = {
      selectedWorkspaceId: 1,
      refreshAuthData: jest.fn().mockReturnValue(of('updated'))
    };

    mockSnackBar = {
      open: jest.fn()
    };

    await TestBed.configureTestingModule({
      imports: [
        WsAccessRightsComponent,
        MatCheckboxModule,
        MatTooltipModule,
        MatIconModule,
        NoopAnimationsModule,
        TranslateModule.forRoot()
      ],
      providers: [
        provideZonelessChangeDetection(),
        { provide: UserBackendService, useValue: mockUserBackendService },
        { provide: AppService, useValue: mockAppService },
        { provide: MatSnackBar, useValue: mockSnackBar }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(WsAccessRightsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load users on creation', () => {
    expect(mockUserBackendService.getUsers).toHaveBeenCalledWith(1);
    expect(component.workspaceUsers().entries.length).toBe(2);
    expect(component.workspaceUsers().entries[0].name).toBe('user1');
  });

  it('should change access level correctly', () => {
    const user = component.workspaceUsers().entries[0];
    component.changeAccessLevel(true, user, 3);
    expect(component.workspaceUsers().entries[0].accessLevel).toBe(3);
    expect(component.workspaceUsers().entries[0].isChecked).toBe(true);
    expect(component.workspaceUsers().hasChanged).toBe(true);

    component.changeAccessLevel(false, user, 3);
    expect(component.workspaceUsers().entries[0].accessLevel).toBe(0);
    expect(component.workspaceUsers().entries[0].isChecked).toBe(false);
    expect(component.workspaceUsers().entries[0].canCode).toBe(false);
  });

  it('should keep coding capability independent when changing workspace access', () => {
    const user = component.workspaceUsers().entries[1];

    component.changeAccessLevel(true, user, 3);
    expect(component.workspaceUsers().entries[1].accessLevel).toBe(3);
    expect(component.workspaceUsers().entries[1].canCode).toBe(false);

    component.changeCanCode(true, user);
    component.changeAccessLevel(true, user, 2);
    expect(component.workspaceUsers().entries[1].accessLevel).toBe(2);
    expect(component.workspaceUsers().entries[1].canCode).toBe(true);

    component.changeCanCode(false, user);
    component.changeAccessLevel(true, user, 1);
    expect(component.workspaceUsers().entries[1].accessLevel).toBe(1);
    expect(component.workspaceUsers().entries[1].canCode).toBe(false);
  });

  it('should change coding capability independently from access level', () => {
    const user = component.workspaceUsers().entries[1];

    component.changeCanCode(true, user);

    expect(component.workspaceUsers().entries[1].accessLevel).toBe(2);
    expect(component.workspaceUsers().entries[1].canCode).toBe(true);
    expect(component.workspaceUsers().hasChanged).toBe(true);
  });

  it('should allow disabling coding capability for access level 1', () => {
    const user = component.workspaceUsers().entries[0];

    component.changeCanCode(false, user);

    expect(component.workspaceUsers().entries[0].accessLevel).toBe(1);
    expect(component.workspaceUsers().entries[0].canCode).toBe(false);
    expect(component.workspaceUsers().hasChanged).toBe(true);
  });

  it('should save access rights successfully', () => {
    const user = component.workspaceUsers().entries[0];
    component.changeAccessLevel(true, user, 3);

    component.save();

    expect(mockUserBackendService.saveUsers).toHaveBeenCalled();
    expect(mockAppService.refreshAuthData).toHaveBeenCalled();
    expect(mockSnackBar.open).toHaveBeenCalledWith(
      'admin.workspace-access-right-set',
      '',
      expect.any(Object)
    );
    expect(component.workspaceUsers().hasChanged).toBe(false);
  });

  it('should send removed existing access rights when saving', () => {
    const user = component.workspaceUsers().entries[0];

    component.changeAccessLevel(false, user, 1);
    component.save();

    expect(mockUserBackendService.saveUsers).toHaveBeenCalledWith(1, expect.arrayContaining([
      {
        id: 1,
        accessLevel: 0,
        canCode: false
      }
    ]));
  });

  it('should keep changes pending when saving access rights fails', () => {
    const user = component.workspaceUsers().entries[0];
    component.changeAccessLevel(true, user, 3);
    (mockUserBackendService.saveUsers as jest.Mock).mockReturnValueOnce(of(false));

    component.save();

    expect(mockAppService.refreshAuthData).not.toHaveBeenCalled();
    expect(component.workspaceUsers().hasChanged).toBe(true);
    expect(mockSnackBar.open).toHaveBeenCalledWith(
      'admin.workspace-access-right-not-set',
      'error',
      expect.any(Object)
    );
  });

  it('should clear persisted changes and report a failed auth data refresh separately', () => {
    const user = component.workspaceUsers().entries[0];
    component.changeAccessLevel(true, user, 3);
    (mockAppService.refreshAuthData as jest.Mock).mockReturnValueOnce(of('failed'));

    component.save();

    expect(component.workspaceUsers().hasChanged).toBe(false);
    expect(mockSnackBar.open).toHaveBeenCalledWith(
      'admin.change-saved-auth-data-refresh-failed',
      'error',
      { duration: 5000 }
    );
  });

  it('should clear persisted changes without an obsolete message after the auth context changed', () => {
    const user = component.workspaceUsers().entries[0];
    component.changeAccessLevel(true, user, 3);
    (mockAppService.refreshAuthData as jest.Mock).mockReturnValueOnce(of('invalidated'));

    component.save();

    expect(component.workspaceUsers().hasChanged).toBe(false);
    expect(mockSnackBar.open).not.toHaveBeenCalled();
  });
  it('renders a delayed server response without another user action', async () => {
    const backend = TestBed.inject(UserBackendService);
    const response = backend.getUsers(1).pipe(delay(30));
    jest.spyOn(backend, 'getUsers').mockReturnValue(response);
    fixture.destroy();
    fixture = TestBed.createComponent(WsAccessRightsComponent);
    component = fixture.componentInstance;
    fixture.autoDetectChanges();
    await new Promise<void>(resolve => { setTimeout(resolve, 80); });
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('user1');
    expect(fixture.nativeElement.querySelector('input:checked')).toBeTruthy();
  });
});
