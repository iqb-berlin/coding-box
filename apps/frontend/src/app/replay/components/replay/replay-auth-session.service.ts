import { DestroyRef, Injectable, inject } from '@angular/core';
import { Params } from '@angular/router';
import { firstValueFrom, Subject, takeUntil } from 'rxjs';
import { jwtDecode, JwtPayload } from 'jwt-decode';
import { AppService } from '../../../core/services/app.service';
import {
  CODING_JOB_WORKSPACE_TOKEN_SCOPES,
  REPLAY_WORKSPACE_TOKEN_SCOPES,
  WorkspaceTokenScope
} from '../../../core/services/auth-session.config';
import { validateToken } from '../../utils/token-utils';

interface TokenRefresh {
  request: Promise<string | null>;
  cancel: Subject<void>;
}

/** Owns replay credentials and scoped refresh attempts for one replay view. */
@Injectable()
export class ReplayAuthSessionService {
  private readonly app = inject(AppService);
  private readonly requests = new Map<string, TokenRefresh>();
  private destroyed = false;
  token = '';

  constructor() {
    inject(DestroyRef).onDestroy(() => this.destroy());
  }

  workspaceFromToken(token?: string): number {
    if (!token) return 0;
    try {
      return Number(jwtDecode<JwtPayload & { workspace?: string | number }>(token).workspace) || 0;
    } catch {
      return 0;
    }
  }

  scopesForRoute(params: Params): WorkspaceTokenScope[] {
    return params.codingJobId || String(params.mode || '').startsWith('coding') ?
      CODING_JOB_WORKSPACE_TOKEN_SCOPES : REPLAY_WORKSPACE_TOKEN_SCOPES;
  }

  canLoad(workspaceId: number): boolean {
    return !this.destroyed && Number.isFinite(workspaceId) && workspaceId > 0 &&
      (!!this.token || this.app.hasStoredAuthToken());
  }

  canRefresh(workspaceId: number, validation = this.validation()): boolean {
    return !this.destroyed && !!workspaceId && !!this.token && this.app.hasStoredAuthToken() &&
      (validation.isValid || validation.errorType === 'token_expired') &&
      this.workspaceFromToken(this.token) === workspaceId;
  }

  async refreshExpired(
    workspaceId: number,
    scopes: WorkspaceTokenScope[],
    canApply: () => boolean
  ): Promise<boolean> {
    const validation = this.validation();
    const shouldRefresh = !validation.isValid && validation.errorType === 'token_expired' &&
      this.canRefresh(workspaceId, validation);
    this.retainOnly(shouldRefresh ? this.key(workspaceId, scopes) : null);
    return shouldRefresh ? this.refresh(workspaceId, scopes, canApply) : false;
  }

  async refresh(
    workspaceId: number,
    scopes: WorkspaceTokenScope[],
    canApply: () => boolean
  ): Promise<boolean> {
    if (this.destroyed || !this.app.hasStoredAuthToken()) return false;
    const key = this.key(workspaceId, scopes);
    let entry = this.requests.get(key);
    if (!entry) {
      const cancel = new Subject<void>();
      entry = {
        cancel,
        request: firstValueFrom(
          this.app.createOwnToken(workspaceId, 1, scopes).pipe(takeUntil(cancel)),
          { defaultValue: null }
        ).then(token => token || null).catch(() => null)
      };
      this.requests.set(key, entry);
    }
    const token = await entry.request;
    // A newer route may share this request. An obsolete consumer must not remove it.
    if (this.destroyed || this.requests.get(key) !== entry || !canApply()) return false;
    this.requests.delete(key);
    entry.cancel.complete();
    if (!token) return false;
    this.token = token;
    return true;
  }

  removeTokenFromUrl(workspaceId: number): void {
    try {
      const url = new URL(window.location.href);
      if (!url.hash) return;
      const [path, query = ''] = url.hash.split('?');
      const params = new URLSearchParams(query);
      params.delete('auth');
      const workspace = workspaceId || this.workspaceFromToken(this.token);
      if (workspace) params.set('workspaceId', String(workspace));
      url.hash = params.size ? `${path}?${params}` : path;
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    } catch {
      // A browser URL rewrite must not discard a refreshed in-memory credential.
    }
  }

  invalidate(): void {
    this.retainOnly(null);
  }

  destroy(): void {
    this.destroyed = true;
    this.invalidate();
  }

  private validation(): ReturnType<typeof validateToken> {
    return this.token ? validateToken(this.token) : { isValid: false, errorType: 'token_invalid' };
  }

  private key(workspace: number, scopes: WorkspaceTokenScope[]): string {
    return `${workspace}:${[...new Set(scopes)].sort().join(',')}`;
  }

  private retainOnly(key: string | null): void {
    this.requests.forEach((entry, requestKey) => {
      if (requestKey !== key) {
        this.requests.delete(requestKey);
        entry.cancel.next();
        entry.cancel.complete();
      }
    });
  }
}
