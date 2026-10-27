import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { firstValueFrom, Observable } from 'rxjs';
import { pageTitle } from './page-title.resolver';

it('resolves the translated page title in the current language', async () => {
  TestBed.configureTestingModule({ imports: [TranslateModule.forRoot()] });
  const translations = TestBed.inject(TranslateService);
  translations.setTranslation('de', { 'page-titles': { manual: 'Manuelle Kodierung' } });
  translations.use('de');
  const result = TestBed.runInInjectionContext(() => pageTitle('manual')(
    {} as ActivatedRouteSnapshot, {} as RouterStateSnapshot
  )) as Observable<string>;
  expect(await firstValueFrom(result)).toBe('Manuelle Kodierung | IQB-Kodierbox');
});
