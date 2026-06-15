export const CODING_PROCESS_CACHE_INVALIDATOR =
  'CODING_PROCESS_CACHE_INVALIDATOR';

export interface CodingProcessCacheInvalidator {
  invalidateWorkspaceCaches(workspaceId: number): void;
}
