import axios from 'axios';
import * as http from 'http';
import { AddressInfo } from 'net';
import {
  contentPoolRequestOptions, CONTENT_POOL_TIMEOUT_MS, CONTENT_POOL_MAX_FILE_BYTES, CONTENT_POOL_MAX_TRANSFER_BYTES
} from './content-pool-http';

describe('Content-Pool HTTP resource limits', () => {
  it('bounds every request by elapsed time and transferred bytes', () => {
    const options = contentPoolRequestOptions({ headers: { 'X-Server-Token': 'fixture' } });
    expect(options).toMatchObject({
      timeout: CONTENT_POOL_TIMEOUT_MS, maxRedirects: 0, maxContentLength: CONTENT_POOL_MAX_FILE_BYTES, maxBodyLength: CONTENT_POOL_MAX_TRANSFER_BYTES + 1024 * 1024
    });
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(options.signal?.aborted).toBe(false);
  });
  it('aborts an unresponsive upstream at the configured deadline', async () => {
    const createDeadline = AbortSignal.timeout.bind(AbortSignal);
    const deadline = jest.spyOn(AbortSignal, 'timeout').mockImplementation(delay => {
      expect(delay).toBe(CONTENT_POOL_TIMEOUT_MS);
      return createDeadline(50);
    });
    const server = http.createServer(() => undefined);
    await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); });
    try {
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      await expect(axios.get(url, contentPoolRequestOptions({ proxy: false }))).rejects.toMatchObject({ code: 'ERR_CANCELED' });
    } finally {
      deadline.mockRestore();
      server.closeAllConnections();
      await new Promise<void>(resolve => { server.close(() => resolve()); });
    }
  });
  it('rejects oversized responses and redirects on the actual HTTP transport', async () => {
    const paths: string[] = [];
    const server = http.createServer((request, response) => {
      paths.push(request.url || '');
      if (request.url === '/redirect') {
        response.writeHead(307, { Location: '/credentials-must-not-reach-here' });
        response.end();
      } else response.end('response exceeds eight bytes');
    });
    await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); });
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      await expect(axios.get(url, contentPoolRequestOptions({ proxy: false }, 8))).rejects.toMatchObject({ code: 'ERR_BAD_RESPONSE' });
      await expect(axios.get(`${url}/redirect`, contentPoolRequestOptions({ proxy: false, headers: { 'X-Server-Token': 'fixture' } }))).rejects.toMatchObject({ response: { status: 307 } });
      expect(paths).toEqual(['/', '/redirect']);
    } finally {
      await new Promise<void>(resolve => { server.close(() => resolve()); });
    }
  });
});
