import {
  DestroyRef, Injector, inject, signal
} from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { EMPTY, Subscription, merge } from 'rxjs';

export type UiTranslator = (key: string, parameters?: Record<string, unknown>) => string;

/** Keeps computed labels reactive and resolves HTTP-backed translations only when needed. */
export function injectUiTranslator(): UiTranslator {
  const injector = inject(Injector);
  const destroyRef = inject(DestroyRef);
  const revision = signal(0);
  let service: TranslateService | undefined;
  let subscription: Subscription | undefined;
  destroyRef.onDestroy(() => subscription?.unsubscribe());
  return (key, parameters) => {
    if (!key) return '';
    revision();
    if (!service) {
      service = injector.get(TranslateService);
      subscription = merge(
        service.onLangChange ?? EMPTY,
        service.onTranslationChange ?? EMPTY,
        service.onDefaultLangChange ?? EMPTY
      ).subscribe(() => revision.update(value => value + 1));
    }
    return service.instant(key, parameters);
  };
}
