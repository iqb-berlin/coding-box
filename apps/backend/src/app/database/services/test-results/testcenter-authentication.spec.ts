import { ForbiddenException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import { createHash } from 'crypto';
import { authenticateTestcenter } from './testcenter-authentication';

describe('Testcenter authentication across API generations', () => {
  const base = 'https://testcenter.example/tci';
  const credentials = { username: 'fixture', password: 'synthetic' };
  const session = { token: 'fixture-token', claims: { workspaceAdmin: [] } };
  let http: { put: jest.Mock; post: jest.Mock };
  const authenticate = () => authenticateTestcenter(http as unknown as HttpService, base, credentials, { timeout: 120000 });
  const failure = (status: number, data: unknown) => ({ isAxiosError: true, response: { status, data } });

  beforeEach(() => { http = { put: jest.fn(), post: jest.fn() }; });

  it('keeps direct authentication for Testcenter 17 and installations without admin challenge protection', async () => {
    http.put.mockReturnValue(of({ data: session }));
    await expect(authenticate()).resolves.toEqual(session);
    expect(http.put).toHaveBeenCalledWith(`${base}/api/session/admin`, { name: 'fixture', password: 'synthetic' }, expect.objectContaining({ maxRedirects: 0 }));
    expect(http.post).not.toHaveBeenCalled();
  });

  it('completes the Testcenter 18.2/19 challenge flow against the same base path', async () => {
    const challenge = {
      algorithm: 'SHA-256',
      salt: 'salt',
      signature: 'signature',
      maxNumber: 5,
      challenge: createHash('sha256').update('salt5').digest('hex')
    };
    http.put.mockReturnValueOnce(throwError(() => failure(400, 'Brute Force protection active. Challenge for this password must be solved to create a session')))
      .mockReturnValueOnce(of({ data: session }));
    http.post.mockReturnValueOnce(of({ data: challenge }));
    await expect(authenticate()).resolves.toEqual(session);
    expect(http.post).toHaveBeenCalledWith(`${base}/api/session/challenge`, { loginType: 'admin', name: 'fixture', password: 'synthetic' }, expect.objectContaining({ maxRedirects: 0 }));
    const { maxNumber, ...proof } = challenge;
    expect(http.put).toHaveBeenLastCalledWith(`${base}/api/session`, { ...proof, number: maxNumber }, expect.objectContaining({ maxRedirects: 0 }));
  });

  it.each([1, 2])('stops when approval is revoked before challenge step %s', async revokedStep => {
    http.put.mockReturnValueOnce(throwError(() => failure(400, 'Brute Force protection active. Challenge')));
    http.post.mockReturnValue(of({
      data: {
        algorithm: 'SHA-256',
        salt: 'salt',
        signature: 'fixture',
        maxNumber: 0,
        challenge: createHash('sha256').update('salt0').digest('hex')
      }
    }));
    const recheck = jest.fn(async () => undefined);
    if (revokedStep === 2) recheck.mockResolvedValueOnce(undefined);
    recheck.mockRejectedValueOnce(new ForbiddenException('Testcenter target is not allowed'));
    await expect(authenticateTestcenter(http as unknown as HttpService, base, credentials, { timeout: 120000 }, recheck))
      .rejects.toMatchObject({ status: 403 });
    expect(http.post).toHaveBeenCalledTimes(revokedStep - 1);
    expect(http.put).toHaveBeenCalledTimes(1);
  });

  it.each([400, 401, 403, 429, 500, 307])('does not retry ordinary upstream HTTP %s failures with credentials', async status => {
    http.put.mockReturnValue(throwError(() => failure(status, 'provider detail')));
    await expect(authenticate()).rejects.toThrow();
    expect(http.post).not.toHaveBeenCalled();
    expect(http.put).toHaveBeenCalledTimes(1);
  });

  it('maps actual Testcenter invalid-password HTTP 400 to a credential failure without expiring the app session', async () => {
    http.put.mockReturnValue(throwError(() => failure(400, 'No login with this password.')));
    await expect(authenticate()).rejects.toMatchObject({ status: 422, message: 'Invalid Testcenter credentials' });
  });

  it.each([202, 204])('explains valid credentials without workspace access (HTTP %s) as a permission failure', async status => {
    http.put.mockReturnValue(of({ status, data: '' }));
    await expect(authenticate()).rejects.toMatchObject({ status: 403, message: 'Testcenter access denied' });
    expect(http.post).not.toHaveBeenCalled();
  });
});
