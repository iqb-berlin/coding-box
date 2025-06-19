import { Component, Inject, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatTableModule } from '@angular/material/table';

import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { TestResultValidationDto } from '../../../../../../../api-dto/test-groups/test-result-validation.dto';
import { BackendService } from '../../../services/backend.service';
import { AppService } from '../../../services/app.service';

@Component({
  selector: 'coding-box-test-results-validation',
  templateUrl: './test-results-validation.component.html',
  styleUrls: ['./test-results-validation.component.scss'],
  standalone: true,
  imports: [
    MatDialogModule,
    MatTableModule,
    MatButtonModule,
    MatSnackBarModule
]
})
export class TestResultsValidationComponent implements OnInit {
  validationResults: TestResultValidationDto[] = [];
  displayedColumns = ['unitName', 'variableId', 'value', 'error'];

  constructor(
    public dialogRef: MatDialogRef<TestResultsValidationComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { validationResults: TestResultValidationDto[] },
    private backendService: BackendService,
    private appService: AppService,
    private snackBar: MatSnackBar
  ) { }

  ngOnInit(): void {
    this.validationResults = this.data.validationResults;
  }

  close(): void {
    this.dialogRef.close();
  }

  deleteInvalidResponses(): void {
    const idsToDelete = this.validationResults.map(r => r.testResultId);
    if (idsToDelete.length === 0) {
      this.snackBar.open('Keine fehlerhaften Antworten zum Löschen vorhanden.', 'Info', { duration: 3000 });
      return;
    }

    this.backendService.deleteTestResults(this.appService.selectedWorkspaceId, idsToDelete)
      .subscribe(success => {
        if (success) {
          this.snackBar.open('Fehlerhafte Antworten wurden gelöscht.', 'Erfolg', { duration: 3000 });
          this.dialogRef.close(true); // Close dialog and indicate success
        } else {
          this.snackBar.open('Fehler beim Löschen der Antworten.', 'Fehler', { duration: 3000 });
        }
      });
  }
}
