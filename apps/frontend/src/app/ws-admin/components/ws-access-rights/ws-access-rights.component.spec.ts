import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { WsAccessRightsComponent } from './ws-access-rights.component';
import { BackendService } from '../../../services/backend.service';
import { AppService } from '../../../services/app.service';

describe('WsAccessRightsComponent', () => {
  let component: WsAccessRightsComponent;
  let fixture: ComponentFixture<WsAccessRightsComponent>;
  let mockBackendService: Partial<BackendService>;
  let mockAppService: Partial<AppService>;
  let mockSnackBar: Partial<MatSnackBar>;

  const mockUsers = [
    {
      id: 1, name: 'user1', displayName: 'User One', accessLevel: 1
    },
    {
      id: 2, name: 'user2', displayName: 'User Two', accessLevel: 2
    }
  ];

  beforeEach(async () => {
    mockBackendService = {
      getUsers: jest.fn().mockReturnValue(of(mockUsers)),
      saveUsers: jest.fn().mockReturnValue(of(true))
    };

    mockAppService = {
      selectedWorkspaceId: 1
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
        { provide: BackendService, useValue: mockBackendService },
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
    expect(mockBackendService.getUsers).toHaveBeenCalledWith(1);
    expect(component.workspaceUsers.entries.length).toBe(2);
    expect(component.workspaceUsers.entries[0].name).toBe('user1');
  });

  it('should change access level correctly', () => {
    const user = component.workspaceUsers.entries[0];
    component.changeAccessLevel(true, user, 3);
    expect(user.accessLevel).toBe(3);
    expect(user.isChecked).toBe(true);
    expect(component.workspaceUsers.hasChanged).toBe(true);

    component.changeAccessLevel(false, user, 3);
    expect(user.accessLevel).toBe(0);
    expect(user.isChecked).toBe(false);
  });

  it('should save access rights successfully', () => {
    const user = component.workspaceUsers.entries[0];
    component.changeAccessLevel(true, user, 3);

    component.save();

    expect(mockBackendService.saveUsers).toHaveBeenCalled();
    expect(mockSnackBar.open).toHaveBeenCalledWith('Zugriffsrechte erfolgreich gespeichert', 'Schließen', expect.any(Object));
    expect(component.workspaceUsers.hasChanged).toBe(false);
  });
});
