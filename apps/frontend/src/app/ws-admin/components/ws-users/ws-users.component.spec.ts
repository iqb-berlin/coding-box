import {
  ComponentFixture, TestBed, fakeAsync, tick
} from '@angular/core/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { WsUsersComponent } from './ws-users.component';
import { BackendService } from '../../../services/backend.service';
import { AppService } from '../../../services/app.service';
import { UserFullDto } from '../../../../../../../api-dto/user/user-full-dto';
import { MessageDialogComponent, MessageType } from '../../../shared/dialogs/message-dialog.component';
import { EditUserComponent } from '../../../sys-admin/components/edit-user/edit-user.component';
import { ConfirmDialogComponent } from '../../../shared/dialogs/confirm-dialog.component';
import { WorkspaceAccessRightsDialogComponent } from '../../../sys-admin/components/workspace-access-rights-dialog/workspace-access-rights-dialog.component';

describe('WsUsersComponent', () => {
  let component: WsUsersComponent;
  let fixture: ComponentFixture<WsUsersComponent>;
  let mockBackendService: Partial<BackendService>;
  let mockAppService: Partial<AppService>;
  let mockDialog: Partial<MatDialog>;
  let mockTranslateService: Partial<TranslateService>;

  const mockUsers: (UserFullDto & { name: string })[] = [
    {
      id: 1, username: 'user1', name: 'user1', isAdmin: false
    },
    {
      id: 2, username: 'user2', name: 'user2', isAdmin: true
    }
  ];

  beforeEach(async () => {
    mockBackendService = {
      getUsersFull: jest.fn().mockReturnValue(of(mockUsers)),
      getAllWorkspacesList: jest.fn().mockReturnValue(of({ data: [] })),
      getWorkspacesByUserList: jest.fn().mockReturnValue(of([])),
      deleteUsers: jest.fn().mockReturnValue(of(true))
    };

    mockAppService = {
      dataLoading: false
    };

    mockDialog = {
      open: jest.fn().mockReturnValue({ afterClosed: () => of(true) })
    };

    mockTranslateService = {
      instant: jest.fn().mockImplementation((key: string) => key)
    };

    await TestBed.configureTestingModule({
      imports: [
        WsUsersComponent,
        MatCheckboxModule,
        MatTooltipModule,
        MatIconModule,
        MatTableModule,
        MatDialogModule,
        NoopAnimationsModule,
        TranslateModule.forRoot()
      ],
      providers: [
        { provide: BackendService, useValue: mockBackendService },
        { provide: AppService, useValue: mockAppService },
        { provide: MatDialog, useValue: mockDialog },
        { provide: MatSnackBar, useValue: { open: jest.fn() } },
        { provide: TranslateService, useValue: mockTranslateService }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(WsUsersComponent);
    component = fixture.componentInstance;
    // Initialize properties that are normally set by inputs or other means if necessary
    component.selectedRows = [];
    component.checkedRows = [];
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load users on init', fakeAsync(() => {
    component.ngOnInit();
    tick(); // processes setTimeout
    expect(mockBackendService.getUsersFull).toHaveBeenCalled();
    expect(component.userObjectsDatasource.data.length).toBe(2);
  }));

  it('should load users when updateUserList is called', () => {
    component.updateUserList();
    expect(mockBackendService.getUsersFull).toHaveBeenCalled();
    expect(component.userObjectsDatasource.data.length).toBe(2);
  });

  it('should filter users correctly', fakeAsync(() => {
    component.ngOnInit();
    tick();
    component.userObjectsDatasource.filter = 'user1';
    expect(component.userObjectsDatasource.filteredData.length).toBe(1);
    expect(component.userObjectsDatasource.filteredData[0].username).toBe('user1');
  }));

  it('should toggle checkbox and emit selection', fakeAsync(() => {
    fixture.detectChanges();
    tick();
    const emitSpy = jest.spyOn(component.userSelectionChanged, 'emit');
    component.checkboxToggle(mockUsers[0]);
    expect(component.tableSelectionCheckboxes.isSelected(mockUsers[0])).toBe(true);
    expect(emitSpy).toHaveBeenCalledWith([mockUsers[0]]);
  }));

  describe('Dialogs', () => {
    beforeEach(() => {
      // Reset dialog spy
      (mockDialog.open as jest.Mock).mockClear();
    });

    it('editUser should open MessageDialog if no selection', () => {
      component.selectedRows = [];
      component.checkedRows = [];
      component.editUser();
      expect(mockDialog.open).toHaveBeenCalledWith(MessageDialogComponent, expect.objectContaining({
        data: expect.objectContaining({ type: MessageType.error })
      }));
    });

    it('editUser should open EditUserComponent if user selected', () => {
      component.selectedRows = [mockUsers[0]];
      component.editUser();
      expect(mockDialog.open).toHaveBeenCalledWith(EditUserComponent, expect.anything());
    });

    it('deleteUsers should open MessageDialog if no selection', () => {
      component.selectedRows = [];
      component.checkedRows = [];
      component.deleteUsers();
      expect(mockDialog.open).toHaveBeenCalledWith(MessageDialogComponent, expect.objectContaining({
        data: expect.objectContaining({ type: MessageType.error })
      }));
    });

    it('deleteUsers should open ConfirmDialog if user selected', () => {
      component.selectedRows = [mockUsers[0]];
      component.deleteUsers();
      expect(mockDialog.open).toHaveBeenCalledWith(ConfirmDialogComponent, expect.anything());
    });

    it('setUserWorkspaceAccessRight should open MessageDialog if no selection', () => {
      component.selectedRows = [];
      component.checkedRows = [];
      component.setUserWorkspaceAccessRight();
      expect(mockDialog.open).toHaveBeenCalledWith(MessageDialogComponent, expect.objectContaining({
        data: expect.objectContaining({ type: MessageType.error })
      }));
    });

    it('setUserWorkspaceAccessRight should open WorkspaceAccessRightsDialogComponent if user selected', () => {
      component.selectedRows = [mockUsers[0]];
      component.setUserWorkspaceAccessRight();
      expect(mockDialog.open).toHaveBeenCalledWith(WorkspaceAccessRightsDialogComponent, expect.anything());
    });
  });
});
