import { Injectable } from '@angular/core';
import { MatPaginatorIntl } from '@angular/material/paginator';
import { TranslateService } from '@ngx-translate/core';

@Injectable()
export class GermanPaginatorIntl extends MatPaginatorIntl {
  constructor(private translateService: TranslateService) {
    super();

    this.itemsPerPageLabel = this.translateService.instant('paginator.itemsPerPageLabel');
    this.nextPageLabel = this.translateService.instant('paginator.nextPageLabel');
    this.previousPageLabel = this.translateService.instant('paginator.previousPageLabel');
    this.firstPageLabel = this.translateService.instant('paginator.firstPageLabel');
    this.lastPageLabel = this.translateService.instant('paginator.lastPageLabel');

    this.translateService.onLangChange.subscribe(() => {
      this.itemsPerPageLabel = this.translateService.instant('paginator.itemsPerPageLabel');
      this.nextPageLabel = this.translateService.instant('paginator.nextPageLabel');
      this.previousPageLabel = this.translateService.instant('paginator.previousPageLabel');
      this.firstPageLabel = this.translateService.instant('paginator.firstPageLabel');
      this.lastPageLabel = this.translateService.instant('paginator.lastPageLabel');
      this.changes.next();
    });
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
