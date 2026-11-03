import { NgModule, inject } from '@angular/core';
import { TranslateModule, TranslateService, TranslateDefaultParser } from '@ngx-translate/core';
import de from '../assets/i18n/de.json';
import { UiTranslator } from '../app/shared/utils/ui-translator';

const parser = new TranslateDefaultParser();

/** Actual German catalog for message assertions and framework-free formatter tests. */
export const translateGerman: UiTranslator = (key, parameters) => {
  const value: unknown = parser.getValue(de, key);
  return typeof value === 'string' ? String(parser.interpolate(value, parameters)) : key;
};

@NgModule({ imports: [TranslateModule.forRoot()] })
export class GermanTranslationsTestingModule {
  constructor() {
    const translate = inject(TranslateService);
    // Some isolated contract tests provide a structural service double.
    if (typeof translate.setTranslation === 'function') {
      translate.setTranslation('de', de, true);
      translate.use('de');
    }
  }
}
