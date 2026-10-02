export const normalizePsychometricUnitKey = (value: unknown): string => String(value || '')
  .trim()
  .replace(/^.*[\\/]/, '')
  .replace(/\.(VOMD|VOCS|XML)$/i, '')
  .trim()
  .toUpperCase();

export const normalizePsychometricVariableKey = (value: unknown): string => String(value || '')
  .trim()
  .toUpperCase();

export const getPsychometricLogicalKey = (
  unitName: unknown,
  variableId: unknown
): string => `${normalizePsychometricUnitKey(
  unitName
)}\u001F${normalizePsychometricVariableKey(variableId)}`;
