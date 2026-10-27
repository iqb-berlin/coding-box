/** Stable identity for variables, including names containing separator characters. */
export function variableKey(variable: { unitName: string; variableId: string }): string {
  return JSON.stringify([variable.unitName, variable.variableId]);
}
