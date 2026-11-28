import type { Request, Response } from 'express';
import type { ExportArtifactService } from '../../database/services/coding';
import { WorkspaceResultsDownloadController } from './workspace-results-download.controller';

describe('WorkspaceResultsDownloadController', () => {
  const route = '/api/admin/workspace/1/coding/export/job/test/download';
  const request = (path: string, cookie?: string) => ({
    originalUrl: path,
    get: jest.fn(() => cookie)
  }) as unknown as Request;

  const setup = () => {
    const getArtifact = jest.fn().mockResolvedValue({
      workspaceId: 1,
      fileName: 'results.csv',
      filePath: '/private/results.csv',
      exportType: 'results-by-version'
    });
    const response = {
      cookie: jest.fn(), json: jest.fn(), setHeader: jest.fn(), download: jest.fn()
    } as unknown as jest.Mocked<Response>;
    const controller = new WorkspaceResultsDownloadController({ getArtifact } as unknown as ExportArtifactService);
    return { controller, getArtifact, response };
  };

  it('uses a secure path-scoped ticket and serves the complete CSV with the normal filename', async () => {
    const { controller, response } = setup();
    await controller.prepare(1, 'test', request(`${route}/prepare`), response);
    const [name, token] = response.cookie.mock.calls[0];
    expect(response.cookie).toHaveBeenCalledWith(name, token, expect.objectContaining({
      path: `${route}/file`, secure: true, httpOnly: true, sameSite: 'strict'
    }));
    await controller.download(1, 'test', request(`${route}/file`, `${name}=${token}`), response);
    expect(response.download).toHaveBeenCalledWith('/private/results.csv',
      expect.stringMatching(/^export-results-by-version-\d{4}-\d{2}-\d{2}\.csv$/),
      { headers: { 'Cache-Control': 'no-store, no-transform' } });
  });

  it('preserves the coding overview filename for a selected version', async () => {
    const { controller, response } = setup();
    await controller.prepare(1, 'test', request(`${route}/prepare`), response);
    const [name, token] = response.cookie.mock.calls[0];
    const req = request(`${route}/file?version=v2`, `${name}=${token}`);
    Object.assign(req, { query: { version: 'v2' } });
    await controller.download(1, 'test', req, response);
    expect(response.download).toHaveBeenCalledWith('/private/results.csv',
      expect.stringMatching(/^coding-results-v2-/),
      expect.anything());
  });

  it('checks artifact scope before issuing a ticket and rejects unsigned downloads', async () => {
    const { controller, getArtifact, response } = setup();
    await expect(controller.download(1, 'test', request(`${route}/file`), response)).rejects.toThrow('Export download unavailable');
    expect(getArtifact).not.toHaveBeenCalled();
    await expect(controller.prepare(2, 'test', request(`${route}/prepare`), response)).rejects.toThrow('Export download unavailable');
    expect(response.cookie).not.toHaveBeenCalled();
  });
});
