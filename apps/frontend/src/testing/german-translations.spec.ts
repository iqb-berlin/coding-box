import de from '../assets/i18n/de.json';
import { translateGerman } from './german-translations';

describe('German UI catalog', () => {
  it('keeps interpolated labels as messages rather than executable template expressions', () => {
    const inspect = (value: unknown): void => {
      if (typeof value === 'string') {
        expect(value).not.toMatch(/\|\s*translate|\bui-text\./);
      } else if (value && typeof value === 'object') {
        Object.values(value).forEach(inspect);
      }
    };
    inspect(de);
    expect(translateGerman('ui-text.booklet-info-dialog.konfiguration', { length: 2 })).toBe('Konfiguration (2)');
    expect(translateGerman('ui-text.coding-freshness-text.util.auto-coding-1')).toBe('Auto-Coding 1');
  });
});
