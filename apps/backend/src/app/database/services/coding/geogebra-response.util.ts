import AdmZip from 'adm-zip';
import { statusStringToNumber } from '../../utils/response-status-converter';
import { decodeGeoGebraValue } from './geogebra-export.util';

export const displayedResponseStatus = statusStringToNumber('DISPLAYED');

export function isDisplayedGeoGebraResponse(
  { status, value }: { status?: number | null; value: string | null }
): boolean {
  return status === displayedResponseStatus && hasGeoGebraConstruction(value);
}

export function hasGeoGebraConstruction(value: string | null): boolean {
  if (!value || !/^\s*(?:UEsD|data:)/i.test(value)) return false;
  const archive = decodeGeoGebraValue(value);
  if (!archive) return false;
  try {
    // Checking the ZIP entry keeps the stored drawing intact and avoids inflating it.
    const construction = new AdmZip(archive).getEntry('geogebra.xml');
    return !!construction && !construction.isDirectory;
  } catch {
    return false;
  }
}
