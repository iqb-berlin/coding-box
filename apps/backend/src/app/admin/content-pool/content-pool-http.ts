import { AxiosRequestConfig } from 'axios';

export const CONTENT_POOL_TIMEOUT_MS = 60_000;
export const CONTENT_POOL_MAX_FILE_BYTES = 50 * 1024 * 1024;
export const CONTENT_POOL_MAX_TRANSFER_BYTES = 200 * 1024 * 1024;
export const CONTENT_POOL_MAX_FILES = 1000;

export function contentPoolRequestOptions(
  options: AxiosRequestConfig = {},
  maxResponseBytes = CONTENT_POOL_MAX_FILE_BYTES
): AxiosRequestConfig {
  return {
    ...options,
    timeout: CONTENT_POOL_TIMEOUT_MS,
    signal: AbortSignal.timeout(CONTENT_POOL_TIMEOUT_MS),
    maxRedirects: 0,
    maxContentLength: maxResponseBytes,
    maxBodyLength: CONTENT_POOL_MAX_TRANSFER_BYTES + 1024 * 1024
  };
}

export function maxEncodedContentPoolBytes(bytes: number): number {
  return Math.ceil(bytes / 3) * 4;
}
