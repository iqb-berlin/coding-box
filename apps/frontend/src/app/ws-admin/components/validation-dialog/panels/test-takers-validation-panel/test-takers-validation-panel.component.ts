import {
  Component, Input, Output, EventEmitter, OnInit, OnDestroy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTableModule, MatTableDataSource } from '@angular/material/table';
import { MatIconModule } from '@angular/material/icon';
import { Subscription } from 'rxjs';
import { ValidationPanelHeaderComponent, ValidationStatus, ValidationGuidanceComponent } from '../../shared';
import { TestTakersValidationDto, MissingPersonDto } from '../../../../../../../../../api-dto/files/testtakers-validation.dto';
import { TestTakersValidationService } from '../../../../services/validation';

/**
 * Panel component for test takers validation.
 * Displays validation results and allows users to check if all test persons
 * exist in TestTakers XML files.
 */
@Component({
  selector: 'coding-box-test-takers-validation-panel',
  standalone: true,
  imports: [
    CommonModule,
    MatExpansionModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    MatTableModule,
    MatIconModule,
    ValidationPanelHeaderComponent,
    ValidationGuidanceComponent
  ],
  templateUrl: './test-takers-validation-panel.component.html',
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
export class TestTakersValidationPanelComponent implements OnInit, OnDestroy {
  @Input() disabled = false;
  @Output() validate = new EventEmitter<void>();

  isRunning = false;
  wasRun = false;
  result: TestTakersValidationDto | null = null;
  expandedPanel = false;
  paginatedMissingPersons = new MatTableDataSource<MissingPersonDto>([]);
  displayedColumns = ['group', 'login', 'code', 'reason'];

  private subscription?: Subscription;

  constructor(private testTakersValidationService: TestTakersValidationService) {}

  ngOnInit(): void {
    // Load cached result if available
    this.result = this.testTakersValidationService.getCachedResult();
    if (this.result) {
      this.wasRun = true;
      this.updatePaginatedMissingPersons();
    }
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }

  get status(): ValidationStatus {
    return this.testTakersValidationService.getValidationStatus();
  }

  get errorCount(): number {
    return this.result?.missingPersons.length || 0;
  }

  onValidate(): void {
    if (this.isRunning || this.disabled) {
      return;
    }

    this.isRunning = true;
    this.subscription = this.testTakersValidationService.validate().subscribe({
      next: result => {
        this.result = result;
        this.wasRun = true;
        this.isRunning = false;
        this.updatePaginatedMissingPersons();
      },
      error: () => {
        this.isRunning = false;
      }
    });

    this.validate.emit();
  }

  toggleExpansion(): void {
    this.expandedPanel = !this.expandedPanel;
  }

  private updatePaginatedMissingPersons(): void {
    if (this.result?.missingPersons) {
      this.paginatedMissingPersons.data = this.result.missingPersons;
    }
  }
}
