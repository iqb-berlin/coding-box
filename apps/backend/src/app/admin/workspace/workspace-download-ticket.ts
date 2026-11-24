import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';

const cookieName = 'workspace_download';
export const workspaceDownloadLifetimeMs = 15 * 60 * 1000;

export function workspaceDownloadPath(request: Request): string {
  return request.originalUrl.split('?')[0].replace(/\/{2,}/g, '/').replace(/\/$/, '');
}

export class WorkspaceDownloadTicket {
  private readonly signingKey = randomBytes(32);

  issue(path: string, response: Response): void {
    const expiry = Date.now() + workspaceDownloadLifetimeMs;
    response.cookie(cookieName, `${expiry}.${this.sign(path, expiry)}`, {
      path,
      httpOnly: true,
      sameSite: 'strict',
      secure: true,
      maxAge: workspaceDownloadLifetimeMs
    });
    response.setHeader('Cache-Control', 'no-store');
  }

  matches(path: string, cookieHeader?: string): boolean {
    const value = cookieHeader?.split(';').map(cookie => cookie.trim())
      .find(cookie => cookie.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
    const match = /^(\d{1,16})\.([0-9a-f]{64})$/.exec(value || '');
    if (!match) return false;

    const expiry = Number(match[1]);
    if (!Number.isSafeInteger(expiry) || expiry <= Date.now()) return false;

    return timingSafeEqual(Buffer.from(match[2], 'hex'), Buffer.from(this.sign(path, expiry), 'hex'));
  }

  private sign(path: string, expiry: number): string {
    return createHmac('sha256', this.signingKey).update(`${expiry}:${path}`).digest('hex');
  }
}
