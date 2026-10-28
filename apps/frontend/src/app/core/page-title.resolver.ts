import { inject } from '@angular/core';
import { ResolveFn } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { map, take } from 'rxjs';

export function pageTitle(key: string): ResolveFn<string> {
  return () => inject(TranslateService).get(`page-titles.${key}`).pipe(
    take(1),
    map(title => `${title} | IQB-Kodierbox`)
  );
}
