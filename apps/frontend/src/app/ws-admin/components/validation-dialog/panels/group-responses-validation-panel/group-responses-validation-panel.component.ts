import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnDestroy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTableModule, MatTableDataSource } from '@angular/material/table';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Subscription } from 'rxjs';
import {
  ValidationPanelHeaderComponent,
  ValidationStatus,
  ValidationGuidanceComponent
} from '../../shared';
import { GroupResponsesValidationService } from '../../../../services/validation';

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
  selector: 'coding-box-group-responses-validation-panel',
  standalone: true,
  imports: [
    CommonModule,
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
  @Input() disabled = false;
  @Output() validate = new EventEmitter<void>();

  isRunning = false;
  wasRun = false;
  isLoadingPage = false;
  errorMessage: string | null = null;
  result: GroupResponsesValidationResult | null = null;
  expandedPanel = false;
  paginatedGroupResponses = new MatTableDataSource<{
    group: string;
    hasResponse: boolean;
  }>([]);

  displayedColumns = ['group', 'status'];

  // Pagination state
  totalItems = 0;
  pageSize = 10;
  currentPage = 1;

  private subscription?: Subscription;
  private stateSubscription?: Subscription;

  constructor(
    private groupResponsesValidationService: GroupResponsesValidationService,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    const cachedResult =
      this.groupResponsesValidationService.observeValidationResult();

    this.stateSubscription = cachedResult.subscribe(result => {
      if (result && !this.isRunning) {
        this.wasRun = true;
        const details = result.details as Record<string, unknown>;
        if (result.status === 'failed' && details?.error) {
          this.errorMessage = details.error as string;
          this.result = null;
        } else if (result.details) {
          this.errorMessage = null;
          this.result = result.details as GroupResponsesValidationResult;
          this.totalItems = this.result.total || 0;
          this.currentPage = this.result.page || 1;
          this.pageSize = this.result.limit || 10;
          this.updatePaginatedGroupResponses();
        }
      }
    });
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
    this.stateSubscription?.unsubscribe();
  }

  get status(): ValidationStatus {
    return this.groupResponsesValidationService.getValidationStatus();
  }

  get errorCount(): number {
    return this.result?.totalGroupsWithoutResponses || 0;
  }

  onValidate(): void {
    if (this.isRunning || this.disabled) {
      return;
    }

    this.isRunning = true;
    this.subscription = this.groupResponsesValidationService
      .validate(this.currentPage, this.pageSize)
      .subscribe({
        next: result => {
          this.result = result;
          this.totalItems = result.total || 0;
          this.currentPage = result.page || 1;
          this.pageSize = result.limit || 10;
          this.wasRun = true;
          this.isRunning = false;
          this.updatePaginatedGroupResponses();
        },
        error: () => {
          this.isRunning = false;
          this.snackBar.open('Fehler bei der Validierung', 'Schließen', {
            duration: 5000
          });
        }
      });

    this.validate.emit();
  }

  onPageChange(event: PageEvent): void {
    this.currentPage = event.pageIndex + 1;
    this.pageSize = event.pageSize;
    this.isLoadingPage = true;
    this.subscription?.unsubscribe();
    this.subscription = this.groupResponsesValidationService
      .fetchPage(this.currentPage, this.pageSize)
      .subscribe({
        next: result => {
          this.result = result;
          this.totalItems = result.total || 0;
          this.currentPage = result.page || 1;
          this.pageSize = result.limit || 10;
          this.updatePaginatedGroupResponses();
          this.isLoadingPage = false;
        },
        error: () => {
          this.isLoadingPage = false;
          this.snackBar.open('Fehler beim Laden der Seite', 'Schließen', {
            duration: 5000
          });
        }
      });
  }

  toggleExpansion(): void {
    this.expandedPanel = !this.expandedPanel;
  }

  private updatePaginatedGroupResponses(): void {
    if (this.result?.groupsWithResponses) {
      this.paginatedGroupResponses.data = this.result.groupsWithResponses;
    }
  }
}
