import { Component, inject, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatTableModule, MatTableDataSource } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSortModule } from '@angular/material/sort';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { CommonModule, NgIf } from '@angular/common';
import { UnitsReplay, UnitsReplayUnit } from '../../../services/units-replay.service';
import { ReplayCodingService } from '../../../services/replay-coding.service';

interface NavigationUnit {
  position: number;
  caseNumberVariable: string;
  testPerson: string;
  givenCode: string;
  comments: string;
  codingIssue: string;
  unit: UnitsReplayUnit;
}

export interface NavigateCodingCasesDialogData {
  unitsData: UnitsReplay;
  codingService: ReplayCodingService;
  testPerson: string;
}

@Component({
  selector: 'coding-box-navigate-coding-cases-dialog',
  templateUrl: './navigate-coding-cases-dialog.component.html',
  styleUrls: ['./navigate-coding-cases-dialog.component.scss'],
  imports: [
    MatDialogModule,
    MatTableModule,
    MatButtonModule,
    MatIconModule,
    MatSortModule,
    MatTooltipModule,
    TranslateModule,
    CommonModule,
    NgIf
  ],
  standalone: true
})
export class NavigateCodingCasesDialogComponent implements OnInit {
  dialogRef = inject<MatDialogRef<NavigateCodingCasesDialogComponent>>(MatDialogRef);
  data = inject<NavigateCodingCasesDialogData>(MAT_DIALOG_DATA);
  private translateService = inject(TranslateService);

  displayedColumns: string[] = ['position', 'caseNumberVariable', 'testPerson', 'givenCode', 'codingIssue', 'comments'];
  dataSource = new MatTableDataSource<NavigationUnit>([]);

  ngOnInit(): void {
    this.loadNavigationUnits();
  }

  private loadNavigationUnits(): void {
    const navigationUnits: NavigationUnit[] = [];

    for (let i = 0; i < this.data.unitsData.units.length; i++) {
      const unit = this.data.unitsData.units[i];
      if (unit.variableId && this.data.codingService.isUnitCoded(unit)) {
        const givenCode = this.getGivenCode(unit);
        const comments = this.data.codingService.getNotes(
          unit.testPerson || this.data.testPerson,
          unit.name,
          unit.variableId
        );
        const codingIssue = this.getCodingIssue(unit);
        const testPerson = unit.testPerson || this.data.testPerson;

        navigationUnits.push({
          position: i + 1, // 1-based position in the complete sequence
          caseNumberVariable: `${unit.name}_${unit.variableId}`,
          testPerson,
          givenCode,
          comments,
          codingIssue,
          unit
        });
      }
    }

    this.dataSource.data = navigationUnits;
  }

  private getGivenCode(unit: UnitsReplayUnit): string {
    if (!unit.variableId) return '';

    const compositeKey = this.data.codingService.generateCompositeKey(
      unit.testPerson || this.data.testPerson,
      unit.name,
      unit.variableId
    );

    const selectedCode = this.data.codingService.selectedCodes.get(compositeKey);
    if (selectedCode) {
      // Only hide the code for pure coding issues (negative IDs)
      if (selectedCode.id < 0) {
        return '';
      }
      // Show the code for positive codes, even if there's a coding issue option
      return selectedCode.code || String(selectedCode.id);
    }

    return '';
  }

  private getCodingIssue(unit: UnitsReplayUnit): string {
    if (!unit.variableId) return '';

    const compositeKey = this.data.codingService.generateCompositeKey(
      unit.testPerson || this.data.testPerson,
      unit.name,
      unit.variableId
    );

    const selectedCode = this.data.codingService.selectedCodes.get(compositeKey);
    if (selectedCode) {
      if (selectedCode.codingIssueOption) {
        return this.getCodingIssueOption(selectedCode.codingIssueOption);
      }
      if (selectedCode.id < 0) {
        return this.getCodingIssueOption(selectedCode.id);
      }
    }

    return '';
  }

  private getCodingIssueOption(codeId: number): string {
    const keyMapping: { [key: number]: string } = {
      [-1]: 'code-selector.coding-issue-options.code-assignment-uncertain',
      [-2]: 'code-selector.coding-issue-options.new-code-needed',
      [-3]: 'code-selector.coding-issue-options.invalid-joke-answer',
      [-4]: 'code-selector.coding-issue-options.technical-problems'
    };

    const translationKey = keyMapping[codeId];
    if (translationKey) {
      return this.translateService.instant(translationKey);
    }
    return '';
  }

  onRowClicked(selectedUnit: NavigationUnit): void {
    this.dialogRef.close(selectedUnit.unit);
  }

  closeDialog(): void {
    this.dialogRef.close();
  }
}
