import { Subscription, finalize, takeUntil } from 'rxjs';
import {
  ChangeDetectorRef,
  Component,
  inject,
  OnInit, ChangeDetectionStrategy, DestroyRef
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  MAT_DIALOG_DATA,
  MatDialogRef
} from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { injectUiTranslator } from '../../../shared/utils/ui-translator';
import { ValidationResultDto } from '../../../../../../../api-dto/coding/validation-result.dto';
import { ExpectedCombinationDto } from '../../../../../../../api-dto/coding/expected-combination.dto';
import {
  ValidateCodingCompletenessResponseDto
} from '../../../../../../../api-dto/coding/validate-coding-completeness-response.dto';
import { TestPersonCodingService } from '../../services/test-person-coding.service';
import { AppService } from '../../../core/services/app.service';
import { takeUntilWorkspaceChanged } from '../../../shared/utils/workspace-request.operator';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'coding-box-coding-validation-results-dialog',
  templateUrl: './coding-validation-results-dialog.component.html',
  styleUrls: ['./coding-validation-results-dialog.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    TranslateModule
  ]
})
export class CodingValidationResultsDialogComponent implements OnInit {
  private readonly uiTranslate = injectUiTranslator();

  private pageRequest?: Subscription;

  private readonly destroyRef = inject(DestroyRef);

  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  private testPersonCodingService = inject(TestPersonCodingService);
  private appService: AppService = inject(AppService);
  private readonly workspaceId = this.appService.selectedWorkspaceId;
  private snackBar = inject(MatSnackBar);
  private dialogRef = inject<MatDialogRef<CodingValidationResultsDialogComponent>>(MatDialogRef);

  protected validationResults: ValidateCodingCompletenessResponseDto;
  protected validationRows: { key: string; result: ValidationResultDto }[];
  validationCacheKey: string | null = null;
  protected isLoading = false;
  protected currentPage = 1;
  protected pageSize = 50;
  expectedCombinations: ExpectedCombinationDto[] = [];

  protected get totalPages(): number {
    return this.validationResults?.totalPages || 0;
  }

  protected get hasNextPage(): boolean {
    return this.validationResults?.hasNextPage || false;
  }

  protected get hasPreviousPage(): boolean {
    return this.validationResults?.hasPreviousPage || false;
  }

  constructor() {
    const data = inject<{
      validationResults: ValidateCodingCompletenessResponseDto;
      validationCacheKey: string;
      expectedCombinations: ExpectedCombinationDto[];
    }>(MAT_DIALOG_DATA);

    this.validationResults = data.validationResults;
    this.validationRows = this.buildValidationRows(data.validationResults?.results ?? []);
    this.validationCacheKey = data.validationCacheKey || null;
    this.expectedCombinations = data.expectedCombinations || [];
  }

  ngOnInit(): void {
    this.appService.selectedWorkspaceId$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(id => {
      if (id !== this.workspaceId) this.dialogRef.close();
    });
  }

  private buildValidationRows(results: ValidationResultDto[]): { key: string; result: ValidationResultDto }[] {
    const occurrences = new Map<string, number>();
    return results.map(result => {
      const combination = result.combination;
      const identity = JSON.stringify([
        combination.unit_key, combination.unit_alias ?? '', combination.login_name,
        combination.person_group ?? '', combination.login_code, combination.booklet_id,
        combination.variable_id, combination.variable_page ?? '', combination.variable_anchor ?? ''
      ]);
      // The API retains repeated input rows. Distinguish their occurrences while
      // keeping other rows stable when the response order or validation status changes.
      const occurrence = occurrences.get(identity) ?? 0;
      occurrences.set(identity, occurrence + 1);
      return { key: JSON.stringify([identity, occurrence]), result };
    });
  }

  protected nextPage(): void {
    if (this.hasNextPage) {
      this.loadValidationPage(this.currentPage + 1);
    }
  }

  protected previousPage(): void {
    if (this.hasPreviousPage) {
      this.loadValidationPage(this.currentPage - 1);
    }
  }

  changePageSize(newPageSize: number): void {
    this.pageSize = newPageSize;
    this.loadValidationPage(1); // Reset to first page when changing page size
  }

  private loadValidationPage(page: number): void {
    this.pageRequest?.unsubscribe();
    this.isLoading = true;
    this.changeDetectorRef.markForCheck();
    const workspaceId = this.workspaceId;

    if (!workspaceId) {
      this.isLoading = false;
      this.changeDetectorRef.markForCheck();
      return;
    }

    this.pageRequest = this.testPersonCodingService.validateCodingCompleteness(
      workspaceId,
      this.expectedCombinations,
      page,
      this.pageSize
    ).pipe(takeUntilWorkspaceChanged(this.appService, workspaceId), takeUntil(this.dialogRef.beforeClosed()), takeUntilDestroyed(this.destroyRef), finalize(() => { if (!this.destroyRef.destroyed) { this.isLoading = false; this.changeDetectorRef.markForCheck(); } })).subscribe({
      next: results => {
        this.validationResults = results;
        this.validationRows = this.buildValidationRows(results?.results ?? []);
        this.currentPage = page;
        if (results?.cacheKey) {
          this.validationCacheKey = results.cacheKey;
        }
        this.isLoading = false;
        this.changeDetectorRef.markForCheck();
      },
      error: () => {
        this.isLoading = false;
        this.changeDetectorRef.markForCheck();
        this.snackBar.open(this.uiTranslate('ui-text.coding-validation-results-dialog.load-failed'), this.uiTranslate('deferred-view.close'), {
          duration: 5000,
          panelClass: ['error-snackbar']
        });
      }
    });
  }

  downloadExcel(): void {
    const workspaceId = this.workspaceId;

    if (!workspaceId || !this.validationCacheKey) {
      this.snackBar.open(this.uiTranslate('ui-text.coding-validation-results-dialog.no-download-data'), this.uiTranslate('deferred-view.close'), {
        duration: 5000,
        panelClass: ['error-snackbar']
      });
      return;
    }

    this.isLoading = true;
    this.changeDetectorRef.markForCheck();

    this.testPersonCodingService.downloadValidationResultsAsExcel(
      workspaceId,
      this.validationCacheKey
    ).pipe(takeUntilWorkspaceChanged(this.appService, workspaceId), takeUntil(this.dialogRef.beforeClosed()), takeUntilDestroyed(this.destroyRef), finalize(() => { if (!this.destroyRef.destroyed) { this.isLoading = false; this.changeDetectorRef.markForCheck(); } })).subscribe({
      next: blob => {
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        const timestamp = new Date().toISOString().slice(0, 10);
        link.download = `validation-results-${timestamp}.xlsx`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);

        this.snackBar.open(this.uiTranslate('ui-text.coding-validation-results-dialog.excel-download-success'), this.uiTranslate('deferred-view.close'), {
          duration: 5000,
          panelClass: ['success-snackbar']
        });
        this.isLoading = false;
        this.changeDetectorRef.markForCheck();
      },
      error: error => {
        let errorMessage = this.uiTranslate('coding-management-manual.errors.download-failed');
        if (error.status === 404) {
          errorMessage = this.uiTranslate('coding-management-manual.errors.cache-not-found');
        } else if (error.status === 400) {
          errorMessage = this.uiTranslate('coding-management-manual.errors.invalid-cache');
        } else if (error.status === 500) {
          errorMessage = this.uiTranslate('coding-management-manual.errors.server-error');
        } else if (error.status === 0) {
          errorMessage = this.uiTranslate('coding-management-manual.errors.network-error');
        } else if (error.message && error.message.includes('cache')) {
          errorMessage = this.uiTranslate('ui-text.coding-validation-results-dialog.results-expired');
        }

        this.snackBar.open(errorMessage, this.uiTranslate('deferred-view.close'), {
          duration: 5000,
          panelClass: ['error-snackbar']
        });
        this.isLoading = false;
        this.changeDetectorRef.markForCheck();
      }
    });
  }

  protected close(): void {
    this.dialogRef.close();
  }
}
