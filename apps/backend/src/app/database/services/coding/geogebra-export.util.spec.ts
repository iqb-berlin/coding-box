import {
  buildGeoGebraFileName,
  decodeGeoGebraValue,
  extractGeoGebraBase64,
  sanitizeGeoGebraFileNamePart
} from './geogebra-export.util';

describe('geogebra-export.util', () => {
  const minimalZipBase64 = 'UEsDBA==';

  it('extracts raw and data URI GeoGebra base64 values', () => {
    expect(extractGeoGebraBase64(` ${minimalZipBase64} `)).toBe(minimalZipBase64);
    expect(extractGeoGebraBase64(`data:application/zip;base64,${minimalZipBase64}`)).toBe(minimalZipBase64);
    expect(extractGeoGebraBase64('plain-answer')).toBeNull();
  });

  it('decodes only valid ZIP-looking GeoGebra values', () => {
    expect(decodeGeoGebraValue(minimalZipBase64)?.subarray(0, 4).toString('utf8')).toBe('PK\u0003\u0004');
    expect(decodeGeoGebraValue('UEsDnot-valid-base64')).toBeNull();
  });

  it('sanitizes deterministic file name parts', () => {
    expect(sanitizeGeoGebraFileNamePart(' A/B:C* ')).toBe('A_B_C');
    expect(sanitizeGeoGebraFileNamePart('...')).toBe('unknown');
    expect(sanitizeGeoGebraFileNamePart('a'.repeat(100))).toHaveLength(40);
  });

  it('builds deterministic collision-resistant GeoGebra file names', () => {
    expect(buildGeoGebraFileName({
      personLogin: 'login/user',
      personCode: 'code:1',
      bookletName: 'booklet',
      unitKey: 'unit',
      variableId: 'var',
      responseId: 17
    })).toBe('login_user__code_1__booklet__unit__var__response-17.ggb');
  });
});
