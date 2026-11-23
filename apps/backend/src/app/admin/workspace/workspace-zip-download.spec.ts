import type { Response } from 'express';
import { WorkspaceZipDownload } from './workspace-zip-download';

describe('Segmented workspace ZIP downloads', () => {
  const mockResponse = () => ({
    setHeader: jest.fn(),
    cookie: jest.fn(),
    download: jest.fn()
  }) as unknown as jest.Mocked<Response>;

  it('restricts prepared downloads to the archive cookie and workspace until expiry', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    try {
      const service = new WorkspaceZipDownload();
      const response = mockResponse();
      const route = '/api/admin/workspace/1/files/download-zip';
      const { id } = await service.prepare(1, Buffer.from('zip'), route, true, response);
      const [name, secret] = response.cookie.mock.calls[0];
      expect(response.cookie).toHaveBeenCalledWith('workspace_zip', secret, {
        path: `${route}/${id}/download`, httpOnly: true, sameSite: 'strict', secure: true, maxAge: 900000
      });
      const cookie = `${name}=${secret}`;
      expect(() => service.download(1, id, undefined, response)).toThrow('ZIP archive unavailable');
      expect(() => service.download(2, id, cookie, response)).toThrow('ZIP archive unavailable');
      expect(() => service.segment(1, id, 0, response)).toThrow('ZIP archive unavailable');
      service.download(1, id, cookie, response);
      expect(response.download).toHaveBeenCalledWith(expect.stringMatching(/workspace\.zip$/), 'workspace-1-files.zip', {
        headers: { 'Cache-Control': 'no-store, no-transform' }
      });
      await jest.runOnlyPendingTimersAsync();
      expect(() => service.download(1, id, cookie, response)).toThrow('ZIP archive unavailable');
    } finally {
      jest.useRealTimers();
    }
  });

  it('streams a small ZIP directly, even when the caller supports segments', async () => {
    const response = mockResponse();
    const file = await new WorkspaceZipDownload().start(1, Buffer.from('zip'), true, response);
    expect(file.getHeaders().length).toBe(3);
    expect(response.setHeader).not.toHaveBeenCalled();
  });

  it('preserves the archive bytes and restricts subsequent segments to its workspace', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    try {
      const service = new WorkspaceZipDownload();
      const data = Buffer.alloc(8 * 1024 * 1024 + 3, 42);
      const response = mockResponse();
      const first = await service.start(1, data, true, response);
      const id = String(response.setHeader.mock.calls.find(([name]) => name === 'X-Archive-Id')?.[1]);
      const offset = first.getHeaders().length!;
      expect(response.setHeader).toHaveBeenCalledWith('X-Archive-Range', `bytes 0-${offset - 1}/${data.length}`);
      expect(() => service.segment(2, id, offset, mockResponse())).toThrow('ZIP archive unavailable');
      expect(() => service.segment(1, id, offset - 1, mockResponse())).toThrow('Invalid ZIP segment offset');
      const second = service.segment(1, id, offset, mockResponse());
      const chunks: Buffer[] = [];
      for await (const chunk of first.getStream()) chunks.push(chunk);
      for await (const chunk of second.getStream()) chunks.push(chunk);
      expect(Buffer.concat(chunks).equals(data)).toBe(true);
      await jest.runOnlyPendingTimersAsync();
      expect(() => service.segment(1, id, offset, mockResponse())).toThrow('ZIP archive unavailable');
    } finally {
      jest.useRealTimers();
    }
  });
});
