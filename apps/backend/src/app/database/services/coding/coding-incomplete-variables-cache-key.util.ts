export function getCodingIncompleteVariablesCacheKey(workspaceId: number): string {
  return `coding_incomplete_variables_v8:${workspaceId}`;
}

export function getCodingIncompleteVariablesScopeCacheKey(workspaceId: number): string {
  return `coding_incomplete_variables_scope_v1:${workspaceId}`;
}

export function getCodingIncompleteVariablesCacheVersionKey(workspaceId: number): string {
  return `coding_incomplete_variables_version:${workspaceId}`;
}

export function getCodingIncompleteVariablesCacheKeys(workspaceId: number): string[] {
  return [
    getCodingIncompleteVariablesCacheKey(workspaceId),
    getCodingIncompleteVariablesScopeCacheKey(workspaceId)
  ];
}
