import { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, Observable, of } from 'rxjs';
import { CodingStatusRevisionInterceptor } from './coding-status-revision.interceptor';

describe('CodingStatusRevisionInterceptor', () => {
  const createContext = (
    method: string,
    originalUrl: string,
    workspaceId: string | undefined = '7'
  ) => ({
    switchToHttp: () => ({
      getRequest: () => ({
        method,
        originalUrl,
        params: { workspace_id: workspaceId }
      })
    })
  }) as unknown as ExecutionContext;

  it.each([
    '/api/admin/workspace/7/coding/job-definitions',
    '/api/admin/workspace/7/missings-profiles/IQB-Standard',
    '/api/admin/workspace/7/variable-bundle',
    '/api/admin/workspace/7/coding/external-coding-import/apply',
    '/api/admin/workspace/7/coding/double-coded-review/12/draft',
    '/api/admin/workspace/7/coding/jobs/12/apply-results',
    '/api/admin/workspace/7/coding/reset-version'
  ])('increments around a successful coding mutation at %s', async originalUrl => {
    const query = jest.fn().mockResolvedValue([]);
    const interceptor = new CodingStatusRevisionInterceptor({
      manager: { query }
    } as never);
    const next = { handle: jest.fn().mockReturnValue(of('ok')) } as CallHandler;

    await expect(
      lastValueFrom(
        interceptor.intercept(
          createContext('POST', originalUrl),
          next
        )
      )
    ).resolves.toBe('ok');

    expect(query).toHaveBeenCalledTimes(2);
    expect(next.handle).toHaveBeenCalledTimes(1);
  });

  it('invalidates once before a failed coding mutation', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const interceptor = new CodingStatusRevisionInterceptor({
      manager: { query }
    } as never);
    const next = {
      handle: jest.fn().mockReturnValue(new Observable(subscriber => {
        subscriber.error(new Error('failed'));
      }))
    } as CallHandler;

    await expect(
      lastValueFrom(
        interceptor.intercept(
          createContext(
            'POST',
            '/api/admin/workspace/7/coding/job-definitions'
          ),
          next
        )
      )
    ).rejects.toThrow('failed');

    expect(query).toHaveBeenCalledTimes(1);
  });

  it('does not increment for reads or unrelated coding exports', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const interceptor = new CodingStatusRevisionInterceptor({
      manager: { query }
    } as never);
    const next = { handle: jest.fn().mockReturnValue(of('ok')) } as CallHandler;

    await lastValueFrom(
      interceptor.intercept(
        createContext('GET', '/api/admin/workspace/7/coding/job-definitions'),
        next
      )
    );
    await lastValueFrom(
      interceptor.intercept(
        createContext('POST', '/api/admin/workspace/7/coding/export/start'),
        next
      )
    );

    expect(query).not.toHaveBeenCalled();
  });

  it.each([
    '/api/admin/workspace/7/coding/external-coding-import',
    '/api/admin/workspace/7/coding/external-coding-import/stream',
    '/api/admin/workspace/7/coding/job-definitions/12/refresh-preview',
    '/api/admin/workspace/7/coding/job-definitions/12/update-refresh-preview',
    '/api/admin/workspace/7/coding/coder-trainings/12/apply-discussion-results-preview'
  ])('does not increment for the read-only POST endpoint %s', async originalUrl => {
    const query = jest.fn().mockResolvedValue([]);
    const interceptor = new CodingStatusRevisionInterceptor({
      manager: { query }
    } as never);
    const next = { handle: jest.fn().mockReturnValue(of('ok')) } as CallHandler;

    await lastValueFrom(
      interceptor.intercept(createContext('POST', originalUrl), next)
    );

    expect(next.handle).toHaveBeenCalledTimes(1);
    expect(query).not.toHaveBeenCalled();
  });
});
