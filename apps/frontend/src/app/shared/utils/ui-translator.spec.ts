import { computed } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { Subject } from 'rxjs';
import { injectUiTranslator } from './ui-translator';

describe('UI translator', () => {
  it('resolves translations lazily, invalidates computed labels and releases listeners', () => {
    const languageChanged = new Subject<void>();
    let language = 'de';
    const service = { onLangChange: languageChanged, instant: jest.fn((key: string, params?: Record<string, unknown>) => `${language}:${key}:${params?.count}`) };
    const factory = jest.fn(() => service);
    TestBed.configureTestingModule({ providers: [{ provide: TranslateService, useFactory: factory }] });
    const translate = TestBed.runInInjectionContext(injectUiTranslator);
    expect(factory).not.toHaveBeenCalled();
    expect(translate('')).toBe('');
    const label = computed(() => translate('items', { count: 2 }));
    expect(label()).toBe('de:items:2');
    expect(factory).toHaveBeenCalledTimes(1);
    expect(label()).toBe('de:items:2');
    expect(service.instant).toHaveBeenCalledTimes(1);
    language = 'en';
    languageChanged.next();
    expect(label()).toBe('en:items:2');
    expect(languageChanged.observed).toBe(true);
    TestBed.resetTestingModule();
    expect(languageChanged.observed).toBe(false);
  });
});
