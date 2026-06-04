export function getCodingIncompleteVariablesCacheKey(workspaceId: number): string {
  return `coding_incomplete_variables_v7:${workspaceId}`;
}
