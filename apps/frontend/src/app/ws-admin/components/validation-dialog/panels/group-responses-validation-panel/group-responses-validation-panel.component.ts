import {
  Component, OnInit, OnDestroy, signal, computed, input, output, ChangeDetectionStrategy, inject
} from '@angular/core';

import { MatExpansionModule } from '@angular/material/expansion';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTableModule, MatTableDataSource } from '@angular/material/table';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Subscription } from 'rxjs';
import { ValidationTaskDto } from '../../../../../models/validation-task.dto';
import {
  ValidationPanelHeaderComponent,
  ValidationStatus,
  ValidationGuidanceComponent
} from '../../shared';
import { GroupResponsesValidationService } from '../../../../services/validation';
import { buildCsv, downloadCsvFile } from '../../shared/validation-export.util';

interface GroupResponsesValidationResult {
  testTakersFound: boolean;
  groupsWithResponses: { group: string; hasResponse: boolean }[];
  allGroupsHaveResponses: boolean;
  total: number;
  totalGroupsWithoutResponses: number;
  page: number;
  limit: number;
}

/**
 * Panel component for group responses validation.
 * Displays validation results showing which test person groups have responses.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'coding-box-group-responses-validation-panel',
  standalone: true,
  imports: [
    MatExpansionModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    MatProgressBarModule,
    MatTableModule,
    MatPaginatorModule,
    MatIconModule,
    MatSnackBarModule,
    ValidationPanelHeaderComponent,
    ValidationGuidanceComponent
  ],
  templateUrl: './group-responses-validation-panel.component.html',
  styles: [
    `
      .validation-result {
        display: flex;
        align-items: center;
        margin: 10px 0;
        padding: 8px 16px;
        border-radius: 4px;
        font-weight: 500;
      }

      .validation-success {
        background-color: rgba(76, 175, 80, 0.1);
        color: #4caf50;
        border: 1px solid #4caf50;
      }

      .validation-error {
        background-color: rgba(244, 67, 54, 0.1);
        color: #f44336;
        border: 1px solid #f44336;
      }

      .validation-result mat-icon {
        margin-right: 8px;
      }

      .loading-container {
        display: flex;
        align-items: center;
        margin: 10px 0;
      }

      .loading-text {
        margin-left: 8px;
      }

      .actions-container {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 16px;
      }

      .validation-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
      }

      table {
        width: 100%;
      }

      .validation-panel-content {
        position: relative;
      }

      .loading-fade {
        opacity: 0.6;
        pointer-events: none;
      }

      .loading-progress {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        z-index: 10;
      }
    `
  ]
})
export class GroupResponsesValidationPanelComponent
implements OnInit, OnDestroy {
  private groupResponsesValidationService = inject(GroupResponsesValidationService);
  private snackBar = inject(MatSnackBar);

  readonly disabled = input(false);
  readonly validate = output<void>();

  protected readonly isRunning = signal(false);
  readonly wasRun = signal(false);
  protected readonly isLoadingPage = signal(false);
  protected readonly isExporting = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly result = signal<GroupResponsesValidationResult | null>(null);
  protected readonly expandedPanel = signal(false);
  protected paginatedGroupResponses = new MatTableDataSource<{
    group: string;
    hasResponse: boolean;
  }>([]);

  protected displayedColumns = ['group', 'status'];

  // Pagination state
  protected readonly totalItems = signal(0);
  protected readonly pageSize = signal(10);
  protected readonly currentPage = signal(1);
  protected readonly activeTask = signal<ValidationTaskDto | null>(null);

  private subscription?: Subscription;
  private stateSubscription?: Subscription;
  private taskSubscription?: Subscription;

  ngOnInit(): void {
    const cachedResult =
      this.groupResponsesValidationService.observeValidationResult();

    this.stateSubscription = cachedResult.subscribe(result => {
      if (result && !this.isRunning()) {
        this.wasRun.set(true);
        const details = result.details as Record<string, unknown>;
        if (result.status === 'failed' && details?.error) {
          this.errorMessage.set(details.error as string);
          this.result.set(null);
        } else if (result.details) {
          this.errorMessage.set(null);
          const groupResult = result.details as GroupResponsesValidationResult;
          this.result.set(groupResult);
          this.totalItems.set(groupResult.total || 0);
          this.currentPage.set(groupResult.page || 1);
          this.pageSize.set(groupResult.limit || 10);
          this.updatePaginatedGroupResponses();
        }
      }
    });

    // Observe active task
    this.taskSubscription = this.groupResponsesValidationService
      .observeValidationTask()
      .subscribe(task => {
        this.activeTask.set(task);
        this.isRunning.set(!!task);
      });
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
    this.stateSubscription?.unsubscribe();
    this.taskSubscription?.unsubscribe();
  }

  protected get status(): ValidationStatus {
    return this.groupResponsesValidationService.getValidationStatus();
  }

  protected readonly errorCount = computed<number>(() => this.result()?.totalGroupsWithoutResponses || 0);

  protected onValidate(): void {
    if (this.isRunning() || this.disabled()) {
      return;
    }

    this.isRunning.set(true);
    this.subscription = this.groupResponsesValidationService
      .validate(this.currentPage(), this.pageSize())
      .subscribe({
        next: result => {
          this.result.set(result);
          this.totalItems.set(result.total || 0);
          this.currentPage.set(result.page || 1);
          this.pageSize.set(result.limit || 10);
          this.wasRun.set(true);
          this.isRunning.set(false);
          this.updatePaginatedGroupResponses();
        },
        error: () => {
          this.isRunning.set(false);
          this.snackBar.open('Fehler bei der Validierung', 'Schließen', {
            duration: 5000
          });
        }
      });

    this.validate.emit();
  }

  protected onPageChange(event: PageEvent): void {
    this.currentPage.set(event.pageIndex + 1);
    this.pageSize.set(event.pageSize);
    this.isLoadingPage.set(true);
    this.subscription?.unsubscribe();
    this.subscription = this.groupResponsesValidationService
      .fetchPage(this.currentPage(), this.pageSize())
      .subscribe({
        next: result => {
          this.result.set(result);
          this.totalItems.set(result.total || 0);
          this.currentPage.set(result.page || 1);
          this.pageSize.set(result.limit || 10);
          this.updatePaginatedGroupResponses();
          this.isLoadingPage.set(false);
        },
        error: () => {
          this.isLoadingPage.set(false);

          this.snackBar.open('Fehler beim Laden der Seite', 'Schließen', {
            duration: 5000
          });
        }
      });
  }

  protected toggleExpansion(): void {
    this.expandedPanel.set(!this.expandedPanel());
  }

  private updatePaginatedGroupResponses(): void {
    const resultValue = this.result();

    if (resultValue?.groupsWithResponses) {
      this.paginatedGroupResponses.data = resultValue.groupsWithResponses;
    }
  }

  protected exportCsv(): void {
    if (this.isExporting()) {
      return;
    }

    this.isExporting.set(true);
    this.subscription?.unsubscribe();
    this.subscription = this.groupResponsesValidationService
      .fetchPage(1, Number.MAX_SAFE_INTEGER)
      .subscribe({
        next: result => {
          const groupsWithoutResponses = result.groupsWithResponses
            .filter(groupResponse => !groupResponse.hasResponse);

          const csvContent = buildCsv(groupsWithoutResponses, [
            { header: 'Gruppe', value: row => row.group },
            {
              header: 'Hat Antwort',
              value: row => (row.hasResponse ? 'Ja' : 'Nein')
            }
          ]);

          downloadCsvFile('validierung-gruppenantworten.csv', csvContent);
          this.snackBar.open('CSV-Export erfolgreich erstellt', 'OK', {
            duration: 3000
          });
          this.isExporting.set(false);
        },
        error: () => {
          this.isExporting.set(false);

          this.snackBar.open('Fehler beim CSV-Export', 'Schließen', {
            duration: 5000
          });
        }
      });
  }
}
