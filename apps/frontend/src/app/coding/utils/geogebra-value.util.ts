export function extractGeoGebraBase64(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmedValue = value.trim();
  const dataUriMatch = trimmedValue.match(/^data:[^,]*;base64,(UEsD[\s\S]*)$/i);
  const base64Value = (dataUriMatch ? dataUriMatch[1] : trimmedValue).replace(/\s/g, '');
  return base64Value.startsWith('UEsD') ? base64Value : null;
}
