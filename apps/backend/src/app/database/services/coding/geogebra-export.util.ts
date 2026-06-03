export interface GeoGebraExportReference {
  responseId: number;
  relativePath: string;
  buffer: Buffer;
}

const geogebraDataUriPattern = /^data:[^,]*;base64,(UEsD[\s\S]*)$/i;
const unsafeFileNameChars = /[<>:"/\\|?*]/g;
const whitespacePattern = /\s/g;
const maxFileNamePartLength = 40;

export function extractGeoGebraBase64(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmedValue = value.trim();
  const dataUriMatch = trimmedValue.match(geogebraDataUriPattern);
  const base64Value = (dataUriMatch ? dataUriMatch[1] : trimmedValue).replace(whitespacePattern, '');
  return base64Value.startsWith('UEsD') ? base64Value : null;
}

export function decodeGeoGebraValue(value: unknown): Buffer | null {
  const base64Value = extractGeoGebraBase64(value);
  if (!base64Value) {
    return null;
  }

  const buffer = Buffer.from(base64Value, 'base64');
  return buffer.length >= 4 && buffer.subarray(0, 4).toString('utf8') === 'PK\u0003\u0004' ?
    buffer :
    null;
}

export function sanitizeGeoGebraFileNamePart(value: unknown): string {
  const sanitized = String(value ?? '')
    .trim()
    .split('')
    .map(char => (char.charCodeAt(0) < 32 ? '_' : char))
    .join('')
    .replace(unsafeFileNameChars, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^\.+/, '')
    .replace(/[._-]+$/, '');

  return (sanitized || 'unknown').slice(0, maxFileNamePartLength);
}

export function buildGeoGebraFileName(parts: {
  personLogin?: string;
  personCode?: string;
  bookletName?: string;
  unitKey?: string;
  variableId?: string;
  responseId: number;
}): string {
  const fileName = [
    parts.personLogin,
    parts.personCode,
    parts.bookletName,
    parts.unitKey,
    parts.variableId,
    `response-${parts.responseId}`
  ]
    .map(sanitizeGeoGebraFileNamePart)
    .join('__');

  return `${fileName}.ggb`;
}
