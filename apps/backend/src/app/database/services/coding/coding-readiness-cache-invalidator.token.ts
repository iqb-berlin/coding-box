export const CODING_READINESS_CACHE_INVALIDATOR =
  'CODING_READINESS_CACHE_INVALIDATOR';

export interface CodingReadinessCacheInvalidator {
  invalidateWorkspaceReadinessCache(workspaceId: number): Promise<void>;
}
