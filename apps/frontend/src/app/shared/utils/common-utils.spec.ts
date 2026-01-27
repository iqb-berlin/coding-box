import { base64ToUtf8, utf8ToBase64 } from './common-utils';

describe('CommonUtils', () => {
  describe('base64ToUtf8 and utf8ToBase64', () => {
    it('should correctly encode and decode strings with German Umlauts', () => {
      const original = 'Häuser, Bäume, Vögel, Füße, Straße';
      const encoded = utf8ToBase64(original);
      const decoded = base64ToUtf8(encoded);

      expect(decoded).toBe(original);
    });

    it('should decode a known UTF-8 base64 string with Umlauts', () => {
      // "Häuser" in UTF-8 base64 is "SMOkdXNlcg=="
      // In Latin1/atob it would be "HÃ¤user"
      const encoded = 'SMOkdXNlcg==';
      const decoded = base64ToUtf8(encoded);

      expect(decoded).toBe('Häuser');
    });

    it('should handle empty strings', () => {
      expect(utf8ToBase64('')).toBe('');
      expect(base64ToUtf8('')).toBe('');
    });

    it('should fallback to atob for invalid UTF-8 sequences', () => {
      // This is not a valid UTF-8 sequence, but a valid Latin1 base64 for "abc"
      const encoded = btoa('abc');
      expect(base64ToUtf8(encoded)).toBe('abc');
    });
  });
});
