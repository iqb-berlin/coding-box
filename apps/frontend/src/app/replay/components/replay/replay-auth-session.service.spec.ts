import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { jwtDecode } from 'jwt-decode';
import { AppService } from '../../../core/services/app.service';
import { CODING_JOB_WORKSPACE_TOKEN_SCOPES, REPLAY_WORKSPACE_TOKEN_SCOPES } from '../../../core/services/auth-session.config';
import { ReplayAuthSessionService } from './replay-auth-session.service';

function expiredToken(workspace: number): string {
  return `${btoa('{"alg":"none"}')}.${btoa(JSON.stringify({ workspace, exp: 1 }))}.`;
}

describe('Replay credentials', () => {
  let service: ReplayAuthSessionService;
  let response: Subject<string>;
  let app: { createOwnToken: jest.Mock; hasStoredAuthToken: jest.Mock };

  beforeEach(() => {
    jest.mocked(jwtDecode).mockImplementation(jest.requireActual('jwt-decode').jwtDecode);
    response = new Subject<string>();
    app = { createOwnToken: jest.fn(() => response), hasStoredAuthToken: jest.fn(() => true) };
    TestBed.configureTestingModule({ providers: [ReplayAuthSessionService, { provide: AppService, useValue: app }] });
    service = TestBed.inject(ReplayAuthSessionService);
    service.token = expiredToken(5);
  });

  afterEach(() => window.history.replaceState({}, '', '/'));

  it('shares equivalent scopes and leaves a shared refresh to the current consumer', async () => {
    const stale = service.refreshExpired(5, [...REPLAY_WORKSPACE_TOKEN_SCOPES].reverse(), () => false);
    const latest = service.refreshExpired(5, [...REPLAY_WORKSPACE_TOKEN_SCOPES, ...REPLAY_WORKSPACE_TOKEN_SCOPES], () => true);
    response.next('latest');
    expect(await stale).toBe(false);
    expect(await latest).toBe(true);
    expect(app.createOwnToken).toHaveBeenCalledTimes(1);
    expect(service.token).toBe('latest');
  });

  it('cancels replay-only refresh when a coding route needs broader scopes', async () => {
    const oldResponse = response;
    const first = service.refreshExpired(5, REPLAY_WORKSPACE_TOKEN_SCOPES, () => true);
    response = new Subject<string>();
    const latest = service.refreshExpired(5, CODING_JOB_WORKSPACE_TOKEN_SCOPES, () => true);
    expect(oldResponse.observed).toBe(false);
    oldResponse.next('obsolete');
    response.next('coding');
    expect(await first).toBe(false);
    expect(await latest).toBe(true);
    expect(service.token).toBe('coding');
  });

  it('never reuses the first A request after A → B → A', async () => {
    const firstA = response;
    const first = service.refreshExpired(5, REPLAY_WORKSPACE_TOKEN_SCOPES, () => true);
    service.invalidate();
    service.token = expiredToken(6);
    response = new Subject<string>();
    const second = service.refreshExpired(6, REPLAY_WORKSPACE_TOKEN_SCOPES, () => true);
    service.invalidate();
    service.token = expiredToken(5);
    response = new Subject<string>();
    const last = service.refreshExpired(5, REPLAY_WORKSPACE_TOKEN_SCOPES, () => true);
    firstA.next('obsolete A');
    response.next('new A');
    expect(await first).toBe(false);
    expect(await second).toBe(false);
    expect(await last).toBe(true);
    expect(service.token).toBe('new A');
    expect(app.createOwnToken).toHaveBeenCalledTimes(3);
  });

  it('settles a pending refresh on destruction and cannot start another', async () => {
    const pending = service.refreshExpired(5, REPLAY_WORKSPACE_TOKEN_SCOPES, () => true);
    TestBed.resetTestingModule();
    expect(response.observed).toBe(false);
    expect(await pending).toBe(false);
    expect(await service.refresh(5, REPLAY_WORKSPACE_TOKEN_SCOPES, () => true)).toBe(false);
    expect(app.createOwnToken).toHaveBeenCalledTimes(1);
  });

  it.each(['invalid', 'other-workspace', 'no-local-session'])('does not renew %s credentials', async reason => {
    if (reason === 'invalid') service.token = 'invalid';
    if (reason === 'no-local-session') app.hasStoredAuthToken.mockReturnValue(false);
    expect(await service.refreshExpired(reason === 'other-workspace' ? 6 : 5, REPLAY_WORKSPACE_TOKEN_SCOPES, () => true)).toBe(false);
    expect(app.createOwnToken).not.toHaveBeenCalled();
  });

  it('removes only the replay credential while preserving navigation parameters', () => {
    window.history.replaceState({}, '', '/?keep=yes#/replay/person/UNIT/2?auth=secret&mode=coding&anchor=VAR');
    service.removeTokenFromUrl(5);
    expect(window.location.search).toBe('?keep=yes');
    expect(window.location.hash).toBe('#/replay/person/UNIT/2?mode=coding&anchor=VAR&workspaceId=5');
  });
});
