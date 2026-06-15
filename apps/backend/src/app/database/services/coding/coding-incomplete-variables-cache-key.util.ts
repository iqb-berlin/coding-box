export function getCodingIncompleteVariablesCacheKey(workspaceId: number): string {
  return `coding_incomplete_variables_v8:${workspaceId}`;
}
