import { HttpClient } from '@angular/common/http';
import { TranslateLoader } from '@ngx-translate/core';
import { Observable, map } from 'rxjs';
import {
  NGX_CODING_COMPONENTS_DE_TRANSLATIONS,
  mergeTranslations,
  selectTranslationsForLanguage,
  TranslationMap
} from '@iqb/ngx-coding-components/translations';

const translationCacheBust = Date.now().toString();
const componentTranslations = { de: NGX_CODING_COMPONENTS_DE_TRANSLATIONS };

export class CacheBustingTranslateLoader implements TranslateLoader {
  constructor(private http: HttpClient) {}

  getTranslation(lang: string): Observable<TranslationMap> {
    return this.http.get<TranslationMap>(`./assets/i18n/${lang}.json?v=${translationCacheBust}`)
      .pipe(map(applicationTranslations => mergeTranslations(
        selectTranslationsForLanguage(lang, componentTranslations),
        applicationTranslations
      )));
  }
}
