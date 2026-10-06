import { Response } from 'express';

/** Keep errors before streaming in Nest's exception pipeline. */
export function rethrowDownloadError(error: unknown, response: Response): void {
  if (response.headersSent || response.destroyed || response.writableEnded) {
    if (!response.destroyed) {
      response.destroy(error instanceof Error ? error : new Error('Download failed'));
    }
    return;
  }
  response.removeHeader('Content-Disposition');
  response.removeHeader('Content-Length');
  response.removeHeader('Content-Type');
  throw error;
}
