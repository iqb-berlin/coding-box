import { CommonModule } from '@angular/common';
import { Component, Inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { TranslateModule } from '@ngx-translate/core';
import type {
  JobDefinitionDistributionSnapshot
} from '../../services/coding-job-backend.service';

interface DialogCoder {
  id: number;
  name: string;
}

interface DistributionSummaryRow {
  itemKey: string;
  label: string;
  coderCases: Record<string, number>;
  totalCases: number;
  doubleCodedCases: number;
  singleCodedCasesAssigned: number;
}

export interface JobDefinitionDistributionSummaryDialogData {
  definitionId: number;
  snapshot?: JobDefinitionDistributionSnapshot;
  coders: DialogCoder[];
  createdJobsCount?: number;
}

@Component({
  selector: 'coding-box-job-definition-distribution-summary-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatDialogModule,
    MatDividerModule,
    MatIconModule,
    TranslateModule
  ],
  templateUrl: './job-definition-distribution-summary-dialog.component.html',
  styleUrls: ['./job-definition-distribution-summary-dialog.component.scss']
})
export class JobDefinitionDistributionSummaryDialogComponent {
  readonly snapshot = this.data.snapshot;
  readonly coderColumns = this.getCoderColumns();
  readonly rows = this.getRows();

  constructor(
    public dialogRef: MatDialogRef<JobDefinitionDistributionSummaryDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: JobDefinitionDistributionSummaryDialogData
  ) {}

  getSnapshotDate(): string {
    if (!this.snapshot?.createdAt) {
      return '';
    }

    return new Date(this.snapshot.createdAt).toLocaleString('de-DE');
  }

  getSourceLabelKey(): string {
    return this.snapshot?.source === 'refresh' ?
      'coding-job-definitions.distribution-summary.source.refresh' :
      'coding-job-definitions.distribution-summary.source.initial';
  }

  getCoderTotal(coderId: number): number {
    return this.rows.reduce(
      (total, row) => total + (row.coderCases[String(coderId)] || 0),
      0
    );
  }

  getGrandTotal(): number {
    return this.rows.reduce((total, row) => total + row.totalCases, 0);
  }

  getGridTemplate(): string {
    const coderColumns = 'minmax(88px, 1fr) '.repeat(this.coderColumns.length);
    return `minmax(180px, 1.7fr) ${coderColumns}minmax(80px, .8fr) minmax(110px, .9fr)`.trim();
  }

  private getCoderColumns(): DialogCoder[] {
    const snapshotCoders = this.snapshot?.selectedCoders || [];
    const coderNameById = new Map(this.data.coders.map(coder => [coder.id, coder.name]));

    return snapshotCoders.map(coder => ({
      id: coder.coderId,
      name: coderNameById.get(coder.coderId) || `Coder ${coder.coderId}`
    }));
  }

  private getRows(): DistributionSummaryRow[] {
    if (!this.snapshot) {
      return [];
    }

    return Object.entries(this.snapshot.distributionByCoderId || {})
      .map(([itemKey, coderCases]) => {
        const doubleCodingInfo = this.snapshot?.doubleCodingInfo?.[itemKey];
        return {
          itemKey,
          label: this.getItemLabel(itemKey),
          coderCases,
          totalCases: Object.values(coderCases).reduce((sum, count) => sum + count, 0),
          doubleCodedCases: doubleCodingInfo?.doubleCodedCases || 0,
          singleCodedCasesAssigned: doubleCodingInfo?.singleCodedCasesAssigned || 0
        };
      })
      .filter(row => row.totalCases > 0 || row.doubleCodedCases > 0);
  }

  private getItemLabel(itemKey: string): string {
    if (itemKey.startsWith('bundle:')) {
      const bundleId = Number(itemKey.slice('bundle:'.length));
      const bundle = this.snapshot?.selectedVariableBundles.find(selectedBundle => selectedBundle.id === bundleId);
      return bundle?.name || itemKey;
    }

    const parts = itemKey.split('::');
    if (parts.length === 2) {
      return `${parts[0]} -> ${parts[1]}`;
    }

    return itemKey;
  }
}
