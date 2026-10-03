import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { of, Subject } from 'rxjs';
import { UserFullDto } from '../../../../../../../api-dto/user/user-full-dto';
import { WorkspaceUserDto } from '../../../../../../../api-dto/workspaces/workspace-user-dto';
import { UserBackendService } from '../../../shared/services/user/user-backend.service';
import { WorkspaceBackendService } from '../../../workspace/services/workspace-backend.service';
import { UserAccessRightsDialogComponent } from '../user-access-rights-dialog/user-access-rights-dialog.component';

describe('User selection in the workspace rights dialog without Zone', () => {
  let users: Subject<UserFullDto[]>;
  let rights: Subject<WorkspaceUserDto[]>;

  beforeEach(async () => {
    users = new Subject<UserFullDto[]>();
    rights = new Subject<WorkspaceUserDto[]>();
    await TestBed.configureTestingModule({
      imports: [UserAccessRightsDialogComponent, TranslateModule.forRoot()],
      providers: [
        provideZonelessChangeDetection(),
        { provide: MAT_DIALOG_DATA, useValue: { selectedWorkspace: [1] } },
        { provide: MatDialogRef, useValue: { close: jest.fn() } },
        {
          provide: UserBackendService,
          useValue: {
            getUsersFull: () => users,
            getWorkspacesByUserList: () => of([])
          }
        },
        {
          provide: WorkspaceBackendService,
          useValue: {
            getAllWorkspaceUsers: () => rights,
            getAllWorkspacesList: () => of({ data: [], total: 0 })
          }
        }
      ]
    }).compileComponents();
  });

  it.each(['rights-first', 'users-first'])('renders delayed users and saved selection with %s responses', async order => {
    const fixture = TestBed.createComponent(UserAccessRightsDialogComponent);
    fixture.autoDetectChanges();
    await fixture.whenStable();
    const emitUsers = () => {
      users.next([
        { id: 7, username: 'Existing user' },
        { id: 8, username: 'Other user' }
      ]);
      users.complete();
    };
    const emitRights = () => {
      rights.next([{
        userId: 7, workspaceId: 1, accessLevel: 3, canCode: false
      }]);
      rights.complete();
    };

    expect(fixture.nativeElement.querySelectorAll('mat-row')).toHaveLength(0);
    if (order === 'rights-first') emitRights();
    else emitUsers();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelectorAll('mat-row')).toHaveLength(order === 'rights-first' ? 0 : 2);

    if (order === 'rights-first') emitUsers();
    else emitRights();
    await fixture.whenStable();

    const rows: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('mat-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Existing user');
    expect(rows[1].textContent).toContain('Other user');
    expect(rows[0].querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(true);
    expect(rows[1].querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(false);
    expect(fixture.componentInstance.result()).toEqual([7]);
    const saveButton: HTMLButtonElement = fixture.nativeElement.querySelector('button[color="primary"]');
    expect(saveButton.disabled).toBe(false);
  });
});
