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
import { responseStatesNumericMap } from '@iqbspecs/response/response.interface';
import { FilterParams } from '../../../../services/coding-management.service';

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
  @Input() filterParams: FilterParams = {
    unitName: '',
    codedStatus: '',
    version: 'v1',
    code: '',
    group: '',
    bookletName: '',
    variableId: '',
    geogebra: false,
    personLogin: ''
  };

  @Input() availableStatuses: string[] = [];
  @Input() isLoading = false;
  @Input() isGeogebraAvailable = false;

  @Output() filterChange = new EventEmitter<FilterParams>();
  @Output() clearFilters = new EventEmitter<void>();

  private filterTimer?: NodeJS.Timeout;

  readonly codingRunOptions = [
    { value: 'v1' as const, label: 'coding-management.statistics.first-autocode-run' },
    { value: 'v2' as const, label: 'coding-management.statistics.manual-coding-run' },
    { value: 'v3' as const, label: 'coding-management.statistics.second-autocode-run' }
  ];

  private responseStatusMap = new Map(
    responseStatesNumericMap.map(entry => [entry.key, entry.value])
  );

  ngOnDestroy(): void {
    this.clearFilterTimer();
  }

  onFilterChange(): void {
    this.clearFilterTimer();

    if (!this.filterParams.codedStatus) {
      this.filterChange.emit(this.filterParams);
      return;
    }

    this.filterTimer = setTimeout(() => {
      this.filterChange.emit(this.filterParams);
    }, 500);
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

  mapStatusToString(status: string): string {
    const statusNumber = parseInt(status, 10);
    if (Number.isNaN(statusNumber)) {
      return status;
    }
    return this.responseStatusMap.get(statusNumber) || status;
  }
}
