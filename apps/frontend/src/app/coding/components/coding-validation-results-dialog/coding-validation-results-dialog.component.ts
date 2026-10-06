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
  private pageRequest?: Subscription;

  private readonly destroyRef = inject(DestroyRef);

  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  private testPersonCodingService = inject(TestPersonCodingService);
  private appService: AppService = inject(AppService);
  private readonly workspaceId = this.appService.selectedWorkspaceId;
  private snackBar = inject(MatSnackBar);
  private dialogRef = inject<MatDialogRef<CodingValidationResultsDialogComponent>>(MatDialogRef);

  protected validationResults: ValidateCodingCompletenessResponseDto;
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
    this.validationCacheKey = data.validationCacheKey || null;
    this.expectedCombinations = data.expectedCombinations || [];
  }

  ngOnInit(): void {
    this.appService.selectedWorkspaceId$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(id => {
      if (id !== this.workspaceId) this.dialogRef.close();
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
        this.snackBar.open('Fehler beim Laden der Validierungsergebnisse', 'Schließen', {
          duration: 5000,
          panelClass: ['error-snackbar']
        });
      }
    });
  }

  downloadExcel(): void {
    const workspaceId = this.workspaceId;

    if (!workspaceId || !this.validationCacheKey) {
      this.snackBar.open('Keine Daten zum Herunterladen verfügbar', 'Schließen', {
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

        this.snackBar.open('Excel-Datei wurde erfolgreich heruntergeladen.', 'Schließen', {
          duration: 5000,
          panelClass: ['success-snackbar']
        });
        this.isLoading = false;
        this.changeDetectorRef.markForCheck();
      },
      error: error => {
        let errorMessage = 'Fehler beim Herunterladen der Excel-Datei';
        if (error.status === 404) {
          errorMessage = 'Validierungsdaten nicht gefunden. Bitte führen Sie zuerst eine neue Validierung durch.';
        } else if (error.status === 400) {
          errorMessage = 'Ungültiger Cache-Schlüssel. Bitte führen Sie eine neue Validierung durch.';
        } else if (error.status === 500) {
          errorMessage = 'Server-Fehler beim Generieren der Excel-Datei. Bitte versuchen Sie es später erneut.';
        } else if (error.status === 0) {
          errorMessage = 'Netzwerk-Fehler. Bitte überprüfen Sie Ihre Internetverbindung.';
        } else if (error.message && error.message.includes('cache')) {
          errorMessage = 'Die Validierungsdaten sind nicht mehr verfügbar. Bitte führen Sie eine neue Validierung durch.';
        }

        this.snackBar.open(errorMessage, 'Schließen', {
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
