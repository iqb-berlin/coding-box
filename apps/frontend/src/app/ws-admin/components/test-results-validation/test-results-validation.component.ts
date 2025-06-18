import { Component, Inject, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatTableModule } from '@angular/material/table';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { TestResultValidationDto } from '../../../../../../../api-dto/test-groups/test-result-validation.dto';

@Component({
  selector: 'coding-box-test-results-validation',
  templateUrl: './test-results-validation.component.html',
  styleUrls: ['./test-results-validation.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatTableModule,
    MatButtonModule
  ]
})
export class TestResultsValidationComponent implements OnInit {
  validationResults: TestResultValidationDto[] = [];
  displayedColumns = ['unitName', 'variableId', 'value', 'error'];

  constructor(
    public dialogRef: MatDialogRef<TestResultsValidationComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { validationResults: TestResultValidationDto[] }
  ) { }

  ngOnInit(): void {
    this.validationResults = this.data.validationResults;
  }

  close(): void {
    this.dialogRef.close();
  }
}
