import {
  Component, ChangeDetectionStrategy, OnDestroy, input, output, linkedSignal
} from '@angular/core';

import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatButton } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIcon } from '@angular/material/icon';
import { TranslateModule } from '@ngx-translate/core';
import { FilterParams } from '../../../../services/coding-management.service';
import { getResponseStatusLabel } from '../../../../../shared/utils/response-status-metadata.util';
import { hasInvalidRegexFilter } from '../../../../../shared/utils/regex-filter.util';

type RegexFilterField = 'unitName' | 'code' | 'personLogin' | 'group' | 'bookletName' | 'variableId';

function createDefaultFilterParams(): FilterParams {
  return {
    value: '',
    unitName: '',
    codedStatus: '',
    version: 'v1',
    code: '',
    codingCode: '',
    score: '',
    group: '',
    bookletName: '',
    variableId: '',
    geogebra: false,
    responseSource: 'all',
    personLogin: ''
  };
}

@Component({
  selector: 'app-response-filters',
  templateUrl: './response-filters.component.html',
  styleUrls: ['./response-filters.component.scss'],
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatFormFieldModule,
    MatSelectModule,
    MatInputModule,
    MatButton,
    MatCheckboxModule,
    MatIcon,
    TranslateModule
  ]
})
export class ResponseFiltersComponent implements OnDestroy {
  readonly filterParams = input<FilterParams>(createDefaultFilterParams());
  readonly draftFilterParams = linkedSignal(() => ({
    ...createDefaultFilterParams(),
    ...this.filterParams()
  }));

  setFilterValue<K extends keyof FilterParams>(field: K, value: FilterParams[K]): void {
    this.draftFilterParams.update(filters => ({ ...filters, [field]: value }));
  }

  readonly availableStatuses = input<string[]>([]);
  readonly isLoading = input(false);
  readonly isGeogebraAvailable = input(false);
  readonly enableRegexSearch = input(false);

  readonly filterChange = output<FilterParams>();
  readonly clearFilters = output<void>();

  private filterTimer?: ReturnType<typeof setTimeout>;

  readonly responseSourceOptions = [
    { value: 'all' as const, label: 'coding-management.filters.response-source-all' },
    { value: 'base' as const, label: 'coding-management.filters.response-source-base' },
    { value: 'derived' as const, label: 'coding-management.filters.response-source-derived' }
  ];

  ngOnDestroy(): void {
    this.clearFilterTimer();
  }

  onTextFilterChange(): void {
    this.clearFilterTimer();

    if (this.hasInvalidRegexFilters()) {
      return;
    }

    this.filterTimer = setTimeout(() => {
      this.emitFilterChange();
    }, 500);
  }

  onInstantFilterChange(): void {
    this.clearFilterTimer();
    if (this.hasInvalidRegexFilters()) {
      return;
    }
    this.emitFilterChange();
  }

  onGeoGebraFilterChange(): void {
    if (this.draftFilterParams().geogebra && this.draftFilterParams().responseSource === 'all') {
      this.setFilterValue('responseSource', 'base');
    }
    this.onInstantFilterChange();
  }

  onClearFilters(): void {
    this.clearFilters.emit();
  }

  private clearFilterTimer(): void {
    if (this.filterTimer) {
      clearTimeout(this.filterTimer);
      this.filterTimer = undefined;
    }
  }

  private emitFilterChange(): void {
    this.filterChange.emit({ ...this.draftFilterParams() });
  }

  mapStatusToString(status: string): string {
    return getResponseStatusLabel(status) || status;
  }

  isRegexFilterInvalid(field: RegexFilterField): boolean {
    return hasInvalidRegexFilter(this.draftFilterParams()[field], this.enableRegexSearch());
  }

  private hasInvalidRegexFilters(): boolean {
    const fields: RegexFilterField[] = [
      'unitName',
      'code',
      'personLogin',
      'group',
      'bookletName',
      'variableId'
    ];

    return fields.some(field => this.isRegexFilterInvalid(field));
  }
}
