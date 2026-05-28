export function hasManualInstruction(code: { manualInstruction?: string | null }): boolean {
  return !!code.manualInstruction?.trim();
}
