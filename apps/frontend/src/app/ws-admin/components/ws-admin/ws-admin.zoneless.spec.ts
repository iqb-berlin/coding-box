import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { BehaviorSubject, of, Subject } from 'rxjs';
import { WsAdminComponent } from './ws-admin.component';
import { AppService } from '../../../core/services/app.service';
import { UserBackendService } from '../../../shared/services/user/user-backend.service';
import { CodingJobBackendService } from '../../../coding/services/coding-job-backend.service';

describe('Workspace navigation without Zone', () => {
  let users: Map<number, Subject<{ id: number; accessLevel: number; canCode: boolean }[]>>;
  let authData: BehaviorSubject<typeof AppService.defaultAuthData>;
  let getUsers: jest.Mock;
  let getCodingJobs: jest.Mock;

  beforeEach(async () => {
    users = new Map([[5, new Subject()], [6, new Subject()]]);
    authData = new BehaviorSubject({ ...AppService.defaultAuthData, userId: 2, isAdmin: false });
    getUsers = jest.fn((workspaceId: number) => users.get(workspaceId)!);
    getCodingJobs = jest.fn().mockReturnValue(of({ data: [], total: 0 }));
    await TestBed.configureTestingModule({
      imports: [WsAdminComponent, TranslateModule.forRoot()],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        provideRouter([{ path: 'workspace-admin/:ws/test-results', component: WsAdminComponent }]),
        { provide: AppService, useValue: { authData: authData.value, authData$: authData, selectedWorkspaceId: 5 } },
        { provide: UserBackendService, useValue: { getUsers } },
        { provide: CodingJobBackendService, useValue: { getCodingJobs } }
      ]
    }).compileComponents();
  });

  it.each([3, 4])('renders delayed access level %s in the real route template', async accessLevel => {
    const harness = await RouterTestingHarness.create('/workspace-admin/5/test-results');
    expect(harness.routeNativeElement?.querySelector('.no-access-message')).not.toBeNull();
    users.get(5)!.next([{ id: 2, accessLevel, canCode: false }]);
    await harness.fixture.whenStable();
    expect(harness.routeNativeElement?.querySelector('.no-access-message')).toBeNull();
    expect(harness.routeNativeElement?.textContent).toContain('ws-admin.test-results');
  });

  it('does not apply old rights after switching workspace', async () => {
    const harness = await RouterTestingHarness.create('/workspace-admin/5/test-results');
    await harness.navigateByUrl('/workspace-admin/6/test-results');
    users.get(6)!.next([{ id: 2, accessLevel: 3, canCode: false }]);
    await harness.fixture.whenStable();
    expect(harness.routeNativeElement?.textContent).toContain('ws-admin.test-results');
    users.get(5)!.next([{ id: 2, accessLevel: 1, canCode: true }]);
    await harness.fixture.whenStable();
    expect(harness.routeNativeElement?.textContent).toContain('ws-admin.test-results');
    expect(getCodingJobs).toHaveBeenCalledTimes(1);
  });

  it('does not request jobs after its route has been destroyed', async () => {
    const harness = await RouterTestingHarness.create('/workspace-admin/5/test-results');
    harness.fixture.destroy();
    users.get(5)!.next([{ id: 2, accessLevel: 3, canCode: false }]);
    expect(getCodingJobs).not.toHaveBeenCalled();
  });

  it('keeps one auth subscription across workspace switches', async () => {
    const harness = await RouterTestingHarness.create('/workspace-admin/5/test-results');
    await harness.navigateByUrl('/workspace-admin/6/test-results');
    getUsers.mockClear();
    authData.next({ ...authData.value, userName: 'updated' });
    expect(getUsers).toHaveBeenCalledTimes(1);
    expect(getUsers).toHaveBeenCalledWith(6);
  });

  it.each(['success', 'empty', 'error'])('renders delayed assigned-job %s without another interaction', async outcome => {
    const jobs = new Subject<{ data: never[]; total: number }>();
    getCodingJobs.mockReturnValue(jobs);
    const harness = await RouterTestingHarness.create('/workspace-admin/5/test-results');
    users.get(5)!.next([{ id: 2, accessLevel: 3, canCode: false }]);
    await harness.fixture.whenStable();
    expect(harness.routeNativeElement?.textContent).not.toContain('ws-admin.my-coding-jobs');
    if (outcome === 'error') jobs.error(new Error('Synthetic failure'));
    else jobs.next({ data: [], total: outcome === 'success' ? 1 : 0 });
    await harness.fixture.whenStable();
    expect(harness.routeNativeElement?.textContent).toContain('ws-admin.test-results');
    if (outcome === 'success') expect(harness.routeNativeElement?.textContent).toContain('ws-admin.my-coding-jobs');
    else expect(harness.routeNativeElement?.textContent).not.toContain('ws-admin.my-coding-jobs');
  });

  it('discards assigned jobs from the previous workspace', async () => {
    const oldJobs = new Subject<{ data: never[]; total: number }>();
    getCodingJobs.mockReturnValueOnce(oldJobs);
    const harness = await RouterTestingHarness.create('/workspace-admin/5/test-results');
    users.get(5)!.next([{ id: 2, accessLevel: 3, canCode: false }]);
    await harness.fixture.whenStable();
    await harness.navigateByUrl('/workspace-admin/6/test-results');
    users.get(6)!.next([{ id: 2, accessLevel: 3, canCode: false }]);
    oldJobs.next({ data: [], total: 1 });
    await harness.fixture.whenStable();
    expect(harness.routeNativeElement?.textContent).not.toContain('ws-admin.my-coding-jobs');
    expect(harness.routeNativeElement?.textContent).toContain('ws-admin.test-results');
  });

  it('keeps the current view while refreshing rights for the same user and workspace', async () => {
    const harness = await RouterTestingHarness.create('/workspace-admin/5/test-results');
    users.get(5)!.next([{ id: 2, accessLevel: 3, canCode: false }]);
    await harness.fixture.whenStable();
    authData.next({ ...authData.value, userName: 'updated' });
    await harness.fixture.whenStable();
    expect(harness.routeNativeElement?.querySelector('.no-access-message')).toBeNull();
    expect(harness.routeNativeElement?.textContent).toContain('ws-admin.test-results');
  });
  it('removes access when refreshed rights no longer contain the current user', async () => {
    const harness = await RouterTestingHarness.create('/workspace-admin/5/test-results');
    users.get(5)!.next([{ id: 2, accessLevel: 3, canCode: false }]);
    await harness.fixture.whenStable();
    authData.next({ ...authData.value, userName: 'updated' });
    users.get(5)!.next([]);
    await harness.fixture.whenStable();
    expect(harness.routeNativeElement?.querySelector('.no-access-message')).not.toBeNull();
    expect(harness.routeNativeElement?.textContent).not.toContain('ws-admin.test-results');
  });
});
