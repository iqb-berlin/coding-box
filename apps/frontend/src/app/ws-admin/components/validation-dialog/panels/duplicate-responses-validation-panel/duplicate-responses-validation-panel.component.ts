import {
  Component, Input, Output, EventEmitter, OnInit, OnDestroy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Subscription } from 'rxjs';
import { ValidationPanelHeaderComponent, ValidationStatus, ValidationGuidanceComponent } from '../../shared';
import { DuplicateResponseSelectionDto } from '../../../../models/duplicate-response-selection.dto';
import { DuplicateResponsesValidationService } from '../../../../services/validation';

/**
 * Panel component for duplicate responses validation.
 * Displays duplicate responses and allows users to select which ones to keep.
 */
@Component({
  selector: 'coding-box-duplicate-responses-validation-panel',
  standalone: true,
  imports: [
    CommonModule,
    MatExpansionModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    MatIconModule,
    MatSnackBarModule,
    ValidationPanelHeaderComponent,
    ValidationGuidanceComponent
  ],
  templateUrl: './duplicate-responses-validation-panel.component.html',
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

    .duplicate-response-item {
      margin-bottom: 24px;
      padding: 16px;
      border: 1px solid #e0e0e0;
      border-radius: 4px;
      background-color: #fafafa;
    }

    .duplicate-response-header {
      margin-bottom: 12px;
      font-weight: 500;
    }

    .duplicate-response-table {
      width: 100%;
      border-collapse: collapse;
      background-color: white;
    }

    .duplicate-response-table th,
    .duplicate-response-table td {
      padding: 8px;
      border: 1px solid #e0e0e0;
      text-align: left;
    }

    .duplicate-response-table th {
      background-color: #f5f5f5;
      font-weight: 500;
    }

    .duplicate-row-selected {
      background-color: rgba(33, 150, 243, 0.08);
    }

    .duplicate-cell-conflict {
      background-color: rgba(244, 67, 54, 0.10);
    }

    .duplicate-cell-selected {
      outline: 2px solid rgba(33, 150, 243, 0.35);
    }
  `]
})
export class DuplicateResponsesValidationPanelComponent implements OnInit, OnDestroy {
  @Input() disabled = false;
  @Output() validate = new EventEmitter<void>();

  isRunning = false;
  wasRun = false;
  duplicateResponses: DuplicateResponseSelectionDto[] = [];
  totalDuplicates = 0;
  duplicateResponseSelections: Map<string, number> = new Map();
  duplicateResponseTouchedKeys: Set<string> = new Set();
  expandedPanel = false;
  isResolvingDuplicates = false;

  private subscription?: Subscription;

  constructor(
    private duplicateResponsesValidationService: DuplicateResponsesValidationService,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    const cachedResult = this.duplicateResponsesValidationService.getCachedResult();
    if (cachedResult && cachedResult.data) {
      this.duplicateResponses = (cachedResult.data as DuplicateResponseSelectionDto[]).map(d => ({
        ...d,
        key: this.buildDuplicateKey(d)
      }));
      this.totalDuplicates = cachedResult.total;
      this.wasRun = true;
    }
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }

  get status(): ValidationStatus {
    return this.duplicateResponsesValidationService.getValidationStatus();
  }

  get errorCount(): number {
    return this.totalDuplicates;
  }

  onValidate(): void {
    if (this.isRunning || this.disabled) {
      return;
    }

    this.isRunning = true;
    this.subscription = this.duplicateResponsesValidationService.validate().subscribe({
      next: result => {
        this.duplicateResponses = result.data.map(d => ({
          ...d,
          key: this.buildDuplicateKey(d)
        }));
        this.totalDuplicates = result.total;
        this.wasRun = true;
        this.isRunning = false;
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

  private buildDuplicateKey(duplicate: { unitId: number; variableId: string; subform: string; testTakerLogin: string }): string {
    return `${duplicate.unitId}|${duplicate.variableId}|${duplicate.subform}|${duplicate.testTakerLogin}`;
  }

  selectDuplicateResponse(duplicate: DuplicateResponseSelectionDto, responseId: number): void {
    this.duplicateResponseSelections.set(duplicate.key, responseId);
    this.duplicateResponseTouchedKeys.add(duplicate.key);
  }

  isSelectedDuplicateResponse(duplicate: DuplicateResponseSelectionDto, responseId: number): boolean {
    return this.duplicateResponseSelections.get(duplicate.key) === responseId;
  }

  isDuplicateRowSelected(duplicate: DuplicateResponseSelectionDto, responseId: number): boolean {
    return this.isSelectedDuplicateResponse(duplicate, responseId);
  }

  isDuplicateValueConflicting(duplicate: DuplicateResponseSelectionDto, responseId: number): boolean {
    const values = new Set((duplicate.duplicates || []).map(d => String(d.value ?? '')));
    if (values.size <= 1) return false;

    const selectedId = this.duplicateResponseSelections.get(duplicate.key);
    if (!selectedId) return true;

    const selected = (duplicate.duplicates || []).find(d => d.responseId === selectedId);
    const current = (duplicate.duplicates || []).find(d => d.responseId === responseId);
    return String(current?.value ?? '') !== String(selected?.value ?? '');
  }

  isDuplicateStatusConflicting(duplicate: DuplicateResponseSelectionDto, responseId: number): boolean {
    const statuses = new Set((duplicate.duplicates || []).map(d => String(d.status ?? '')));
    if (statuses.size <= 1) return false;

    const selectedId = this.duplicateResponseSelections.get(duplicate.key);
    if (!selectedId) return true;

    const selected = (duplicate.duplicates || []).find(d => d.responseId === selectedId);
    const current = (duplicate.duplicates || []).find(d => d.responseId === responseId);
    return String(current?.status ?? '') !== String(selected?.status ?? '');
  }

  getDuplicateConflictLabel(duplicate: DuplicateResponseSelectionDto): string {
    const parts: string[] = [];
    const values = new Set((duplicate.duplicates || []).map(d => String(d.value ?? '')));
    const statuses = new Set((duplicate.duplicates || []).map(d => String(d.status ?? '')));

    if (values.size > 1) parts.push('Wert');
    if (statuses.size > 1) parts.push('Status');

    return parts.length === 0 ? 'Duplikate sind identisch' : `Unterschiede: ${parts.join(', ')}`;
  }

  isDuplicateGroupTouched(duplicate: DuplicateResponseSelectionDto): boolean {
    return this.duplicateResponseTouchedKeys.has(duplicate.key);
  }

  hasSelectedDuplicateResponses(): boolean {
    return this.duplicateResponseSelections.size > 0;
  }

  getSelectedDuplicateResponsesCount(): number {
    return this.duplicateResponseSelections.size;
  }

  selectSuggestedDuplicateResponse(duplicate: DuplicateResponseSelectionDto): void {
    // Smart selection: prefer non-empty values, then by status priority
    const rankStatus = (s: string): number => {
      if (s === 'DISPLAYED') return 4;
      if (s === 'VALUE_CHANGED') return 3;
      if (s === 'FOCUS_CHANGED') return 2;
      return 1;
    };

    const best = (duplicate.duplicates || [])
      .sort((a, b) => {
        if (a.value && !b.value) return -1;
        if (!a.value && b.value) return 1;
        return rankStatus(b.status || '') - rankStatus(a.status || '');
      })[0];

    if (best) {
      this.selectDuplicateResponse(duplicate, best.responseId);
    }
  }

  resolveDuplicateGroup(duplicate: DuplicateResponseSelectionDto): void {
    const selectedId = this.duplicateResponseSelections.get(duplicate.key);
    if (!selectedId) return;

    const responseIdsToDelete = (duplicate.duplicates || [])
      .filter(d => d.responseId !== selectedId)
      .map(d => d.responseId);

    if (responseIdsToDelete.length === 0) return;

    this.isResolvingDuplicates = true;
    this.duplicateResponsesValidationService.resolveDuplicateGroup(responseIdsToDelete).subscribe({
      next: () => {
        this.isResolvingDuplicates = false;
        this.duplicateResponseSelections.delete(duplicate.key);
        this.duplicateResponseTouchedKeys.delete(duplicate.key);
        this.snackBar.open('Duplikate wurden aufgelöst', 'OK', { duration: 3000 });
        this.onValidate();
      },
      error: () => {
        this.isResolvingDuplicates = false;
        this.snackBar.open('Fehler beim Auflösen', 'Schließen', { duration: 5000 });
      }
    });
  }

  resolveAllDuplicates(): void {
    if (this.duplicateResponses.length === 0 || this.isResolvingDuplicates) {
      return;
    }

    this.isResolvingDuplicates = true;
    this.duplicateResponsesValidationService.resolveAllDuplicates().subscribe({
      next: () => {
        this.isResolvingDuplicates = false;
        this.duplicateResponseSelections.clear();
        this.duplicateResponseTouchedKeys.clear();
        this.snackBar.open('Alle Duplikate wurden automatisch aufgelöst', 'OK', { duration: 3000 });
        this.onValidate();
      },
      error: () => {
        this.isResolvingDuplicates = false;
        this.snackBar.open('Fehler beim Auflösen', 'Schließen', { duration: 5000 });
      }
    });
  }

  resolveSelectedDuplicates(): void {
    // Resolve all duplicates that have a selection
    const duplicatesToResolve = this.duplicateResponses.filter(d => this.duplicateResponseTouchedKeys.has(d.key)
    );

    if (duplicatesToResolve.length === 0) return;

    this.isResolvingDuplicates = true;
    let resolved = 0;

    duplicatesToResolve.forEach((duplicate, index) => {
      const selectedId = this.duplicateResponseSelections.get(duplicate.key);
      if (!selectedId) return;

      const responseIdsToDelete = (duplicate.duplicates || [])
        .filter(d => d.responseId !== selectedId)
        .map(d => d.responseId);

      if (responseIdsToDelete.length === 0) return;

      this.duplicateResponsesValidationService.resolveDuplicateGroup(responseIdsToDelete).subscribe({
        next: () => {
          resolved += 1;
          this.duplicateResponseSelections.delete(duplicate.key);
          this.duplicateResponseTouchedKeys.delete(duplicate.key);

          if (index === duplicatesToResolve.length - 1) {
            this.isResolvingDuplicates = false;
            this.snackBar.open(`${resolved} Duplikatgruppen wurden aufgelöst`, 'OK', { duration: 3000 });
            this.onValidate();
          }
        },
        error: () => {
          this.isResolvingDuplicates = false;
          this.snackBar.open('Fehler beim Auflösen', 'Schließen', { duration: 5000 });
        }
      });
    });
  }
}
