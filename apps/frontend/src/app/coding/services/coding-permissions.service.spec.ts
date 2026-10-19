import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { AppService } from '../../core/services/app.service';
import { UserService } from '../../shared/services/user/user.service';
import { CodingPermissionsService } from './coding-permissions.service';

describe('CodingPermissionsService', () => {
  const app = { selectedWorkspaceId: 1, authData: { userId: 7, isAdmin: false } };
  const users = { getUsers: jest.fn() };
  let service: CodingPermissionsService;

  beforeEach(() => {
    app.selectedWorkspaceId = 1;
    app.authData = { userId: 7, isAdmin: false };
    users.getUsers.mockReturnValue(of([{ id: 7, accessLevel: 2 }]));
    TestBed.configureTestingModule({
      providers: [
        { provide: AppService, useValue: app }, { provide: UserService, useValue: users }
      ]
    });
    service = TestBed.inject(CodingPermissionsService);
  });

  it('allows level 2 creation and only owned edits, never result application', () => {
    service.load(1);
    expect(service.canCreate).toBe(true);
    expect(service.canEdit({ creatorUserId: 7 })).toBe(true);
    expect(service.canEdit({ creatorUserId: 8 })).toBe(false);
    expect(service.canEdit({ creatorUserId: null })).toBe(false);
    expect(service.canEdit({})).toBe(false);
    expect(service.canApply).toBe(false);
  });

  it('allows study managers to edit foreign and legacy resources', () => {
    users.getUsers.mockReturnValue(of([{ id: 7, accessLevel: 3 }]));
    service.load(1);
    expect(service.canEdit({ creatorUserId: null })).toBe(true);
    expect(service.canApply).toBe(true);
  });

  it('fails closed before loading and after changing workspace or actor', () => {
    expect(service.canEdit({ creatorUserId: 7 })).toBe(false);
    service.load(1);
    app.selectedWorkspaceId = 2;
    expect(service.canCreate).toBe(false);
    app.selectedWorkspaceId = 1;
    app.authData.userId = 8;
    expect(service.canEdit({ creatorUserId: 8 })).toBe(false);
  });

  it('retains the administrator bypass', () => {
    app.authData.isAdmin = true;
    expect(service.canEdit({ creatorUserId: null })).toBe(true);
    expect(service.canApply).toBe(true);
  });

  it('ignores an older response arriving after the current access request', () => {
    const oldRequest = new Subject<{ id: number; accessLevel: number }[]>();
    const newRequest = new Subject<{ id: number; accessLevel: number }[]>();
    users.getUsers.mockReturnValueOnce(oldRequest).mockReturnValueOnce(newRequest);
    service.load(1);
    service.load(1);
    newRequest.next([{ id: 7, accessLevel: 2 }]);
    oldRequest.next([{ id: 7, accessLevel: 3 }]);
    expect(service.canApply).toBe(false);
    expect(service.canEdit({ creatorUserId: 7 })).toBe(true);
  });

  it('fails closed on a failed role request', () => {
    users.getUsers.mockReturnValue(throwError(() => new Error('offline')));
    service.load(1);
    expect(service.canCreate).toBe(false);
    expect(service.canApply).toBe(false);
  });
});
