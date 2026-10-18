import { Response } from 'express';
import { rethrowDownloadError } from './download-error';

describe('download error propagation', () => {
  it('clears file headers and rethrows before the response starts', () => {
    const error = new Error('synthetic private detail');
    const response = { removeHeader: jest.fn(), destroy: jest.fn() };
    expect(() => rethrowDownloadError(error, response as unknown as Response)).toThrow(error);
    expect(response.removeHeader.mock.calls).toEqual([
      ['Content-Disposition'], ['Content-Length'], ['Content-Type']
    ]);
    expect(response.destroy).not.toHaveBeenCalled();
  });

  it('terminates an already started stream without writing another response', () => {
    const response = { headersSent: true, removeHeader: jest.fn(), destroy: jest.fn() };
    const error = new Error('stream failed');
    expect(() => rethrowDownloadError(error, response as unknown as Response)).not.toThrow();
    expect(response.destroy).toHaveBeenCalledWith(error);
    expect(response.removeHeader).not.toHaveBeenCalled();
  });
});
