import {
  ComponentFixture, TestBed, fakeAsync, tick
} from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
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

describe('WsUsersComponent', () => {
  let component: WsUsersComponent;
  let fixture: ComponentFixture<WsUsersComponent>;
  let mockBackendService: Partial<BackendService>;
  let mockAppService: Partial<AppService>;
  let mockDialog: Partial<MatDialog>;

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
        { provide: MatSnackBar, useValue: { open: jest.fn() } }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(WsUsersComponent);
    component = fixture.componentInstance;
    // We need to wait for the setTimeout in ngOnInit
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

  it('should handle delete users confirmation', fakeAsync(() => {
    fixture.detectChanges();
    tick();
    component.checkedRows = [mockUsers[0]];
    component.selectedRows = [];

    (mockDialog.open as jest.Mock).mockReturnValue({ afterClosed: () => of(true) });
    component.deleteUsers();

    expect(mockDialog.open).toHaveBeenCalled();
    // In the component, deleteUsers only opens the dialog currently,
    // it doesn't call backendservice.deleteUsers in the afterClosed subscription yet (it's commented out)
    // Actually let's check the component code again.
  }));
});
