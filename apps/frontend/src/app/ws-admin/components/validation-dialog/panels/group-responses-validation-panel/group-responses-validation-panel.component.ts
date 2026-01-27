import {
  Component, Input, Output, EventEmitter, OnInit, OnDestroy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTableModule, MatTableDataSource } from '@angular/material/table';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Subscription } from 'rxjs';
import { ValidationPanelHeaderComponent, ValidationStatus, ValidationGuidanceComponent } from '../../shared';
import { GroupResponsesValidationService } from '../../../../services/validation';

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
    MatTableModule,
    MatIconModule,
    MatSnackBarModule,
    ValidationPanelHeaderComponent,
    ValidationGuidanceComponent
  ],
  templateUrl: './group-responses-validation-panel.component.html',
  styles: [`
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
      color: #4CAF50;
      border: 1px solid #4CAF50;
    }

    .validation-error {
      background-color: rgba(244, 67, 54, 0.1);
      color: #F44336;
      border: 1px solid #F44336;
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
  `]
})
export class GroupResponsesValidationPanelComponent implements OnInit, OnDestroy {
  @Input() disabled = false;
  @Output() validate = new EventEmitter<void>();

  isRunning = false;
  wasRun = false;
  result: {
    testTakersFound: boolean;
    groupsWithResponses: { group: string; hasResponse: boolean }[];
    allGroupsHaveResponses: boolean;
  } | null = null;

  expandedPanel = false;
  paginatedGroupResponses = new MatTableDataSource<{ group: string; hasResponse: boolean }>([]);
  displayedColumns = ['group', 'hasResponse'];

  private subscription?: Subscription;

  constructor(
    private groupResponsesValidationService: GroupResponsesValidationService,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    const cachedResult = this.groupResponsesValidationService.getCachedResult();
    if (cachedResult) {
      this.result = {
        testTakersFound: cachedResult.testTakersFound,
        groupsWithResponses: cachedResult.groupsWithResponses,
        allGroupsHaveResponses: cachedResult.allGroupsHaveResponses
      };
      this.wasRun = true;
      this.updatePaginatedGroupResponses();
    }
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }

  get status(): ValidationStatus {
    return this.groupResponsesValidationService.getValidationStatus();
  }

  onValidate(): void {
    if (this.isRunning || this.disabled) {
      return;
    }

    this.isRunning = true;
    this.subscription = this.groupResponsesValidationService.validate().subscribe({
      next: result => {
        this.result = {
          testTakersFound: result.testTakersFound,
          groupsWithResponses: result.groupsWithResponses,
          allGroupsHaveResponses: result.allGroupsHaveResponses
        };
        this.wasRun = true;
        this.isRunning = false;
        this.updatePaginatedGroupResponses();
      },
      error: () => {
        this.isRunning = false;
        this.snackBar.open('Fehler bei der Validierung', 'Schließen', { duration: 5000 });
      }
    });

    this.validate.emit();
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
