import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { of, Subject } from 'rxjs';
import { UserFullDto } from '../../../../../../../api-dto/user/user-full-dto';
import { WorkspaceUserDto } from '../../../../../../../api-dto/workspaces/workspace-user-dto';
import { UserBackendService } from '../../../shared/services/user/user-backend.service';
import { WorkspaceBackendService } from '../../../workspace/services/workspace-backend.service';
import { UserAccessRightsDialogComponent } from '../user-access-rights-dialog/user-access-rights-dialog.component';
import { UsersSelectionComponent } from './users-selection.component';

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

describe('UsersSelectionComponent delayed lists', () => {
  let fixture: ComponentFixture<UsersSelectionComponent>;
  let response: Subject<UserFullDto[]>;
  let getUsersFull: jest.Mock;

  beforeEach(async () => {
    response = new Subject<UserFullDto[]>();
    getUsersFull = jest.fn().mockReturnValue(response);
    await TestBed.configureTestingModule({
      imports: [UsersSelectionComponent, TranslateModule.forRoot()],
      providers: [
        provideZonelessChangeDetection(),
        { provide: UserBackendService, useValue: { getUsersFull } },
        { provide: WorkspaceBackendService, useValue: { getAllWorkspacesList: () => of({ data: [] }) } }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(UsersSelectionComponent);
    fixture.componentRef.setInput('selectedUserIds', [7]);
    await fixture.whenStable();
  });

  afterEach(() => fixture.destroy());

  it('renders delayed users and existing access selections without another interaction', async () => {
    response.next([{ id: 7, username: 'delayed-user' }]);
    await fixture.whenStable();

    const row = fixture.nativeElement.querySelector('mat-row') as HTMLElement;
    expect(row?.textContent).toContain('delayed-user');
    expect((row.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(true);
  });

  it('replaces the visible list when a later refresh arrives', async () => {
    response.next([{ id: 1, username: 'before-refresh' }]);
    response.complete();
    await fixture.whenStable();
    const refreshed = new Subject<UserFullDto[]>();
    getUsersFull.mockReturnValue(refreshed);
    fixture.componentInstance.updateUserList();
    refreshed.next([{ id: 1, username: 'after-refresh' }]);
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('after-refresh');
    expect(fixture.nativeElement.textContent).not.toContain('before-refresh');
  });

  it('renders, filters and sorts by the full name returned by the user directory', async () => {
    response.next([
      { id: 7, username: 'z-login', displayName: 'Ada Lovelace' },
      { id: 8, username: 'a-login', displayName: 'Grace Hopper' },
      { id: 9, username: 'legacy-login' }
    ]);
    await fixture.whenStable();

    const cells = (): string[] => Array.from(fixture.nativeElement.querySelectorAll('mat-row .mat-column-displayName'))
      .map(cell => (cell as HTMLElement).textContent?.trim() || '');
    expect(cells()).toEqual(['Ada Lovelace', 'Grace Hopper', '']);
    const header: HTMLElement = fixture.nativeElement.querySelector('mat-header-cell.mat-column-displayName');
    header.click();
    await fixture.whenStable();
    expect(cells()).toEqual(['', 'Ada Lovelace', 'Grace Hopper']);
    header.click();
    await fixture.whenStable();
    expect(cells()).toEqual(['Grace Hopper', 'Ada Lovelace', '']);

    const filter: HTMLInputElement = fixture.nativeElement.querySelector('coding-box-search-filter input');
    filter.value = 'lovelace';
    filter.dispatchEvent(new Event('input'));
    await new Promise(resolve => { setTimeout(resolve, 350); });
    await fixture.whenStable();
    expect(cells()).toEqual(['Ada Lovelace']);
    expect(fixture.nativeElement.querySelector('mat-row').textContent).toContain('z-login');
  });
});
