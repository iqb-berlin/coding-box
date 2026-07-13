import {
  Component,
  Input,
  Output,
  EventEmitter,
  ChangeDetectionStrategy,
  OnDestroy
} from '@angular/core';
import { CommonModule } from '@angular/common';
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
import { hasInvalidPostgresRegexFilter } from '../../../../../shared/utils/regex-filter.util';

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
    CommonModule,
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
  private localFilterParams: FilterParams = createDefaultFilterParams();

  @Input()
  set filterParams(value: FilterParams) {
    this.localFilterParams = {
      ...createDefaultFilterParams(),
      ...value
    };
  }

  get filterParams(): FilterParams {
    return this.localFilterParams;
  }

  @Input() availableStatuses: string[] = [];
  @Input() isLoading = false;
  @Input() isGeogebraAvailable = false;
  @Input() enableRegexSearch = false;

  @Output() filterChange = new EventEmitter<FilterParams>();
  @Output() clearFilters = new EventEmitter<void>();

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
    if (this.filterParams.geogebra && this.filterParams.responseSource === 'all') {
      this.filterParams.responseSource = 'base';
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
    this.filterChange.emit({ ...this.filterParams });
  }

  mapStatusToString(status: string): string {
    return getResponseStatusLabel(status) || status;
  }

  isRegexFilterInvalid(field: RegexFilterField): boolean {
    return hasInvalidPostgresRegexFilter(
      this.filterParams[field],
      this.enableRegexSearch
    );
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
