import { Component, inject, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateModule } from '@ngx-translate/core';
import { By } from '@angular/platform-browser';
import { of, Subject } from 'rxjs';
import { WsUsersComponent } from './ws-users.component';
import { UsersComponent } from '../../../sys-admin/components/users/users.component';
import { UserBackendService } from '../../../shared/services/user/user-backend.service';
import { WorkspaceBackendService } from '../../../workspace/services/workspace-backend.service';
import { AppService } from '../../../core/services/app.service';
import { LogoService } from '../../../core/services/logo.service';
import { SessionRecoveryService } from '../../../core/services/session-recovery.service';
import { SERVER_URL } from '../../../injection-tokens';
import { UserFullDto } from '../../../../../../../api-dto/user/user-full-dto';

@Component({
  imports: [WsUsersComponent],
  template: '<span class="loading">{{ app.dataLoading }}</span><coding-box-ws-users />'
})
class RootLoadingHost {
  readonly app = inject(AppService);
}

describe('Workspace users without Zone.js', () => {
  const user: UserFullDto & { name: string } = {
    id: 1, username: 'workspaceUser', name: 'workspaceUser', isAdmin: false
  };

  async function setup(previousRequest?: Subject<UserFullDto[]>) {
    const users = new Subject<UserFullDto[]>();
    let requestStarted!: () => void;
    const requestReady = new Promise<void>(resolve => { requestStarted = resolve; });
    const getUsersFull = jest.fn(() => {
      requestStarted();
      return users;
    });
    if (previousRequest) getUsersFull.mockImplementationOnce(() => previousRequest);

    await TestBed.configureTestingModule({
      imports: [RootLoadingHost, UsersComponent, TranslateModule.forRoot()],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        AppService,
        { provide: MatSnackBar, useValue: { open: jest.fn() } },
        { provide: SERVER_URL, useValue: '/api/' },
        { provide: HttpClient, useValue: {} },
        { provide: LogoService, useValue: { getLogoSettings: () => of(null) } },
        { provide: SessionRecoveryService, useValue: {} },
        { provide: UserBackendService, useValue: { getUsersFull, getWorkspacesByUserList: () => of([]) } },
        { provide: WorkspaceBackendService, useValue: { getAllWorkspacesList: () => of({ data: [] }) } }
      ]
    }).overrideComponent(UsersComponent, { set: { template: '', imports: [] } }).compileComponents();

    if (previousRequest) {
      const previousFixture = TestBed.createComponent(UsersComponent);
      previousFixture.componentInstance.updateUserList();
      previousFixture.destroy();
    }

    const fixture = TestBed.createComponent(RootLoadingHost);
    fixture.autoDetectChanges();
    await requestReady;
    await fixture.whenStable();
    expect(TestBed.inject(AppService).dataLoading).toBe(true);
    expect(fixture.nativeElement.textContent).not.toContain(user.name);
    const child = fixture.debugElement.query(By.directive(WsUsersComponent)).componentInstance as WsUsersComponent;
    return {
      fixture, users, child, getUsersFull, app: TestBed.inject(AppService)
    };
  }

  it('renders a delayed users response', async () => {
    const { fixture, users } = await setup();
    users.next([user]);
    users.complete();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelectorAll('mat-row')).toHaveLength(1);
    expect(fixture.nativeElement.textContent).toContain(user.name);
  });

  it('renders users even when another request already stopped the global loader', async () => {
    const { fixture, users, app } = await setup();
    app.dataLoading = false;
    await fixture.whenStable();
    users.next([user]);
    users.complete();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelectorAll('mat-row')).toHaveLength(1);
    expect(fixture.nativeElement.textContent).toContain(user.name);
  });

  it('clears rows and selection after an empty response without a loader change', async () => {
    const {
      fixture, users, child, getUsersFull, app
    } = await setup();
    users.next([user]);
    users.complete();
    await fixture.whenStable();
    child.tableSelectionCheckboxes.select(user);
    child.tableSelectionRow.select(user);
    const emptyUsers = new Subject<UserFullDto[]>();
    getUsersFull.mockReturnValueOnce(emptyUsers);
    child.updateUserList();
    app.dataLoading = false;
    await fixture.whenStable();
    emptyUsers.next([]);
    emptyUsers.complete();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelectorAll('mat-row')).toHaveLength(0);
    expect(fixture.nativeElement.querySelector('coding-box-search-filter')).toBeNull();
    expect(child.tableSelectionCheckboxes.isEmpty()).toBe(true);
    expect(child.tableSelectionRow.isEmpty()).toBe(true);
  });

  it('ignores a system users response after that view was destroyed', async () => {
    const previousUsers = new Subject<UserFullDto[]>();
    const { fixture, users, app } = await setup(previousUsers);
    previousUsers.next([user]);
    previousUsers.complete();
    await fixture.whenStable();
    expect(app.dataLoading).toBe(true);
    users.next([user]);
    users.complete();
    await fixture.whenStable();
    expect(app.dataLoading).toBe(false);
    expect(fixture.nativeElement.textContent).toContain(user.name);
  });

  it('ignores a workspace users response after that view was destroyed', async () => {
    const { fixture, users, app } = await setup();
    fixture.destroy();
    app.dataLoading = true;
    users.next([user]);
    users.complete();
    expect(app.dataLoading).toBe(true);
  });

  it('releases the loader when its view is destroyed during a request', async () => {
    const { fixture, app } = await setup();
    fixture.destroy();
    expect(app.dataLoading).toBe(false);
  });
});
