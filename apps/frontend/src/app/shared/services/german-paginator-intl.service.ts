import { Injectable, OnDestroy, inject } from '@angular/core';
import { Subscription } from 'rxjs';
import { MatPaginatorIntl } from '@angular/material/paginator';
import { TranslateService } from '@ngx-translate/core';

@Injectable()
export class GermanPaginatorIntl extends MatPaginatorIntl implements OnDestroy {
  private translateService = inject(TranslateService);

  private readonly languageSubscription: Subscription;
  constructor() {
    super();

    this.itemsPerPageLabel = this.translateService.instant('paginator.itemsPerPageLabel');
    this.nextPageLabel = this.translateService.instant('paginator.nextPageLabel');
    this.previousPageLabel = this.translateService.instant('paginator.previousPageLabel');
    this.firstPageLabel = this.translateService.instant('paginator.firstPageLabel');
    this.lastPageLabel = this.translateService.instant('paginator.lastPageLabel');

    this.languageSubscription = this.translateService.onLangChange.subscribe(() => {
      this.itemsPerPageLabel = this.translateService.instant('paginator.itemsPerPageLabel');
      this.nextPageLabel = this.translateService.instant('paginator.nextPageLabel');
      this.previousPageLabel = this.translateService.instant('paginator.previousPageLabel');
      this.firstPageLabel = this.translateService.instant('paginator.firstPageLabel');
      this.lastPageLabel = this.translateService.instant('paginator.lastPageLabel');
      this.changes.next();
    });
  }

  ngOnDestroy(): void {
    this.languageSubscription.unsubscribe();
  }

  override getRangeLabel = (page: number, pageSize: number, length: number): string => {
    if (length === 0 || pageSize === 0) {
      return this.translateService.instant('paginator.getRangeLabel', {
        startIndex: 0,
        endIndex: 0,
        length: length
      });
    }

    const startIndex = page * pageSize + 1;
    const endIndex = Math.min((page + 1) * pageSize, length);

    return this.translateService.instant('paginator.getRangeLabel', {
      startIndex: startIndex,
      endIndex: endIndex,
      length: length
    });
  };
}
