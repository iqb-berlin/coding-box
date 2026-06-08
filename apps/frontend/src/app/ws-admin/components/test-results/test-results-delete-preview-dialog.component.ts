import { CommonModule } from '@angular/common';
import { Component, Inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxChange, MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { TestResultsDeletePreviewDto } from '../../../../../../../api-dto/test-results/test-results-deletion.dto';

export interface TestResultsDeletePreviewDialogData {
  preview: TestResultsDeletePreviewDto;
}

interface DeleteMetric {
  label: string;
  value: number;
  hint?: string;
}

@Component({
  selector: 'coding-box-test-results-delete-preview-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatCheckboxModule,
    MatDialogModule,
    MatIconModule
  ],
  templateUrl: './test-results-delete-preview-dialog.component.html',
  styleUrls: ['./test-results-delete-preview-dialog.component.scss']
})
export class TestResultsDeletePreviewDialogComponent {
  acknowledged = false;

  constructor(
    private dialogRef: MatDialogRef<TestResultsDeletePreviewDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: TestResultsDeletePreviewDialogData
  ) {}

  get preview(): TestResultsDeletePreviewDto {
    return this.data.preview;
  }

  get isLogDelete(): boolean {
    return this.preview.targetType === 'logs';
  }

  get isResponseCleanup(): boolean {
    return this.preview.targetType === 'responses';
  }

  get dialogTitle(): string {
    if (this.isLogDelete) {
      return 'Logs unwiderruflich entfernen';
    }

    if (this.isResponseCleanup) {
      return 'Antworten unwiderruflich löschen';
    }

    return 'Testergebnisse unwiderruflich löschen';
  }

  get warningText(): string {
    if (this.isLogDelete) {
      return 'Diese Aktion entfernt nur Logs und Sitzungsdaten dauerhaft. Testergebnisse, Antworten, Testhefte und Aufgaben bleiben erhalten.';
    }

    if (this.isResponseCleanup) {
      return 'Diese Aktion entfernt nur die ausgewählten Antwortwerte dauerhaft. Testpersonen, Testhefte, Aufgaben und Logs bleiben erhalten.';
    }

    return 'Diese Aktion entfernt die Daten dauerhaft. Eine Wiederherstellung ist danach nicht möglich.';
  }

  get metricAriaLabel(): string {
    if (this.isLogDelete) {
      return 'Betroffene Logs';
    }

    if (this.isResponseCleanup) {
      return 'Betroffene Antworten';
    }

    return 'Betroffene Testergebnisse';
  }

  get countNote(): string {
    if (this.isLogDelete) {
      return 'Gezählt werden vorhandene Log- und Sitzungsdatensätze. Ergebnisdaten und Antworten werden nicht gelöscht.';
    }

    if (this.isResponseCleanup) {
      return 'Gezählt werden Antworten mit passendem Chunk-Zeitstempel. Antworten ohne auswertbaren Zeitstempel werden nicht gelöscht.';
    }

    return 'Die Zählweise entspricht der Arbeitsbereich-Übersicht: Testhefte, Aufgaben und Antworten werden eindeutig gezählt.';
  }

  get hasCodingImpact(): boolean {
    const impact = this.preview.codingImpact;
    return !this.isLogDelete &&
      !!impact &&
      (
        (impact.affectedUnits || 0) > 0 ||
        (impact.autoCodingV1 || 0) > 0 ||
        (impact.manualCodingV2 || 0) > 0 ||
        (impact.autoCodingV3 || 0) > 0
      );
  }

  get codingImpactText(): string {
    if (this.isResponseCleanup) {
      return 'Mit diesen Antworten werden auch vorhandene Antwort-Kodierungen entfernt. Die betroffenen Aufgabenbearbeitungen werden danach als veraltet markiert.';
    }

    return 'Mit diesen Testergebnissen werden auch vorhandene Kodierergebnisse entfernt. ' +
      'Danach erscheinen diese gelöschten Fälle nicht als veralteter Kodierstand.';
  }

  get codingImpactMetrics(): DeleteMetric[] {
    const impact = this.preview.codingImpact || {
      affectedUnits: 0,
      autoCodingV1: 0,
      manualCodingV2: 0,
      autoCodingV3: 0
    };

    return [
      {
        label: 'Aufgabenbearbeitungen',
        value: impact.affectedUnits || 0,
        hint: 'mit Kodierung'
      },
      {
        label: 'Auto-Coding 1',
        value: impact.autoCodingV1 || 0,
        hint: 'Antwort-Kodierungen'
      },
      {
        label: 'Manuelle Kodierung',
        value: impact.manualCodingV2 || 0,
        hint: 'Antwort-Kodierungen'
      },
      {
        label: 'Auto-Coding 2',
        value: impact.autoCodingV3 || 0,
        hint: 'Antwort-Kodierungen'
      }
    ];
  }

  get acknowledgementLabel(): string {
    if (this.isLogDelete) {
      return 'Ich verstehe, dass diese Logs endgültig entfernt werden.';
    }

    if (this.isResponseCleanup) {
      return 'Ich verstehe, dass diese Antworten endgültig gelöscht werden.';
    }

    return 'Ich verstehe, dass diese Testergebnisse endgültig gelöscht werden.';
  }

  get confirmButtonIcon(): string {
    return this.isLogDelete || this.isResponseCleanup ?
      'delete_sweep' :
      'delete_forever';
  }

  get confirmButtonLabel(): string {
    if (this.isLogDelete) {
      return 'Logs entfernen';
    }

    if (this.isResponseCleanup) {
      return 'Antworten löschen';
    }

    return 'Löschung starten';
  }

  get metrics(): DeleteMetric[] {
    if (this.isLogDelete) {
      return [
        {
          label: 'Booklet-Logs',
          value: this.preview.bookletLogs || 0
        },
        {
          label: 'Aufgaben-Logs',
          value: this.preview.unitLogs || 0
        },
        {
          label: 'Sitzungen',
          value: this.preview.sessions || 0
        },
        {
          label: 'Testpersonen',
          value: this.preview.persons,
          hint: 'betroffen'
        }
      ];
    }

    if (this.isResponseCleanup) {
      return [
        {
          label: 'Antworten',
          value: this.preview.responses,
          hint: 'mit Chunk-Zeitstempel'
        },
        {
          label: 'Aufgaben',
          value: this.preview.units,
          hint: 'betroffen'
        },
        {
          label: 'Testhefte',
          value: this.preview.booklets,
          hint: 'betroffen'
        },
        {
          label: 'Testpersonen',
          value: this.preview.persons,
          hint: 'betroffen'
        }
      ];
    }

    return [
      { label: 'Testpersonen', value: this.preview.persons },
      {
        label: 'Testhefte',
        value: this.preview.booklets,
        hint: 'einzigartig'
      },
      {
        label: 'Aufgaben',
        value: this.preview.units,
        hint: 'einzigartig'
      },
      {
        label: 'Antworten',
        value: this.preview.responses,
        hint: 'einzigartig'
      }
    ];
  }

  get hasTargets(): boolean {
    if (this.isLogDelete) {
      return this.totalLogRows > 0;
    }

    if (this.isResponseCleanup) {
      return this.preview.responses > 0;
    }

    return this.preview.persons > 0 ||
      this.preview.booklets > 0 ||
      this.preview.units > 0 ||
      this.preview.responses > 0;
  }

  get requiresAcknowledgement(): boolean {
    if (this.isLogDelete) {
      return this.preview.scope === 'filteredPersons' ||
        this.preview.scope === 'groups' ||
        this.totalLogRows >= 100;
    }

    if (this.isResponseCleanup) {
      return this.preview.responses > 0;
    }

    return this.preview.scope === 'filteredPersons' ||
      this.preview.scope === 'groups' ||
      this.preview.persons > 1 ||
      this.preview.responses >= 100;
  }

  private get totalLogRows(): number {
    return (this.preview.bookletLogs || 0) +
      (this.preview.unitLogs || 0) +
      (this.preview.sessions || 0);
  }

  get canConfirm(): boolean {
    return this.hasTargets &&
      (!this.requiresAcknowledgement || this.acknowledged);
  }

  get visibleGroups(): string[] {
    return this.preview.groups.slice(0, 6);
  }

  get visibleBooklets(): string[] {
    return this.preview.bookletNames.slice(0, 6);
  }

  get visibleUnits(): string[] {
    return this.preview.unitNames.slice(0, 6);
  }

  get hasDetails(): boolean {
    return this.preview.groups.length > 0 ||
      this.preview.bookletNames.length > 0 ||
      this.preview.unitNames.length > 0;
  }

  get hasResponseCleanupDetails(): boolean {
    return this.isResponseCleanup && !!this.preview.responseCleanup;
  }

  get responseCleanupTimeText(): string {
    const cleanup = this.preview.responseCleanup;
    if (!cleanup) {
      return '';
    }

    const before = this.formatTimestamp(cleanup.answeredBefore);
    if (!cleanup.answeredFrom) {
      return `vor ${before}`;
    }

    return `${this.formatTimestamp(cleanup.answeredFrom)} bis vor ${before}`;
  }

  get responseCleanupVariableText(): string {
    const variableIds = this.preview.responseCleanup?.variableIds || [];
    return variableIds.length > 0 ?
      variableIds.join(', ') :
      'Alle Variablen der ausgewählten Aufgaben';
  }

  get responseCleanupSubformText(): string {
    const subforms = this.preview.responseCleanup?.subforms || [];
    return subforms.length > 0 ? subforms.join(', ') : 'Alle Subforms';
  }

  get responseCleanupUnknownTimestampResponses(): number {
    return this.preview.responseCleanup?.unknownTimestampResponses || 0;
  }

  get responseCleanupSamples() {
    return this.preview.responseCleanup?.samples || [];
  }

  onAcknowledgementChange(event: MatCheckboxChange): void {
    this.acknowledged = event.checked;
  }

  confirm(): void {
    if (this.canConfirm) {
      this.dialogRef.close(true);
    }
  }

  cancel(): void {
    this.dialogRef.close(false);
  }

  formatTimestamp(value: string | number | null | undefined): string {
    if (value === null || value === undefined) {
      return '-';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '-';
    }

    return date.toLocaleString('de-DE', {
      dateStyle: 'short',
      timeStyle: 'short'
    });
  }
}
