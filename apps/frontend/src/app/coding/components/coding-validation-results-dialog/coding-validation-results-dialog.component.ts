import {
  Component,
  inject,
  OnInit
} from '@angular/core';
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
import { AppService } from '../../../services/app.service';

@Component({
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
  private testPersonCodingService = inject(TestPersonCodingService);
  private appService = inject(AppService);
  private snackBar = inject(MatSnackBar);
  private dialogRef = inject<MatDialogRef<CodingValidationResultsDialogComponent>>(MatDialogRef);

  validationResults: ValidateCodingCompletenessResponseDto;
  validationCacheKey: string | null = null;
  isLoading = false;
  currentPage = 1;
  pageSize = 50;
  expectedCombinations: ExpectedCombinationDto[] = [];

  get totalPages(): number {
    return this.validationResults?.totalPages || 0;
  }

  get hasNextPage(): boolean {
    return this.validationResults?.hasNextPage || false;
  }

  get hasPreviousPage(): boolean {
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
    // Component initialized with data passed via dialog
  }

  nextPage(): void {
    if (this.hasNextPage) {
      this.loadValidationPage(this.currentPage + 1);
    }
  }

  previousPage(): void {
    if (this.hasPreviousPage) {
      this.loadValidationPage(this.currentPage - 1);
    }
  }

  changePageSize(newPageSize: number): void {
    this.pageSize = newPageSize;
    this.loadValidationPage(1); // Reset to first page when changing page size
  }

  private loadValidationPage(page: number): void {
    this.isLoading = true;
    const workspaceId = this.appService.selectedWorkspaceId;

    if (!workspaceId) {
      this.isLoading = false;
      return;
    }

    this.testPersonCodingService.validateCodingCompleteness(
      workspaceId,
      this.expectedCombinations,
      page,
      this.pageSize
    ).subscribe({
      next: results => {
        this.validationResults = results;
        this.currentPage = page;
        if (results?.cacheKey) {
          this.validationCacheKey = results.cacheKey;
        }
        this.isLoading = false;
      },
      error: () => {
        this.isLoading = false;
        this.snackBar.open('Fehler beim Laden der Validierungsergebnisse', 'Schließen', {
          duration: 5000,
          panelClass: ['error-snackbar']
        });
      }
    });
  }

  downloadExcel(): void {
    const workspaceId = this.appService.selectedWorkspaceId;

    if (!workspaceId || !this.validationCacheKey) {
      this.snackBar.open('Keine Daten zum Herunterladen verfügbar', 'Schließen', {
        duration: 5000,
        panelClass: ['error-snackbar']
      });
      return;
    }

    this.isLoading = true;

    this.testPersonCodingService.downloadValidationResultsAsExcel(
      workspaceId,
      this.validationCacheKey
    ).subscribe({
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
      }
    });
  }

  close(): void {
    this.dialogRef.close();
  }
}
