import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxChange, MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { injectUiTranslator } from '../../../shared/utils/ui-translator';
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
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'coding-box-test-results-delete-preview-dialog',
  standalone: true,
  imports: [
    TranslateModule,
    MatButtonModule,
    MatCheckboxModule,
    MatDialogModule,
    MatIconModule
  ],
  templateUrl: './test-results-delete-preview-dialog.component.html',
  styleUrls: ['./test-results-delete-preview-dialog.component.scss']
})
export class TestResultsDeletePreviewDialogComponent {
  private readonly uiTranslate = injectUiTranslator();

  private dialogRef = inject<MatDialogRef<TestResultsDeletePreviewDialogComponent>>(MatDialogRef);
  data = inject<TestResultsDeletePreviewDialogData>(MAT_DIALOG_DATA);

  protected acknowledged = false;

  protected get preview(): TestResultsDeletePreviewDto {
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
      return this.uiTranslate('ui-text.test-results-delete-preview-dialog.logs-unwiderruflich-entfernen');
    }

    if (this.isResponseCleanup) {
      return this.uiTranslate('ui-text.test-results-delete-preview-dialog.antworten-unwiderruflich-loeschen');
    }

    return this.uiTranslate('ui-text.test-results-delete-preview-dialog.testergebnisse-unwiderruflich-loeschen');
  }

  protected get warningText(): string {
    if (this.isLogDelete) {
      return this.uiTranslate('ui-text.test-results-delete-preview-dialog.diese-aktion-entfernt-nur-logs-und-sitzungsdaten-dauerhaft-testergebnisse-antworten-testhe');
    }

    if (this.isResponseCleanup) {
      return this.uiTranslate('ui-text.test-results-delete-preview-dialog.diese-aktion-entfernt-nur-die-ausgewaehlten-antwortwerte-dauerhaft-testpersonen-testhefte');
    }

    return this.uiTranslate('ui-text.test-results-delete-preview-dialog.diese-aktion-entfernt-die-daten-dauerhaft-eine-wiederherstellung-ist-danach-nicht-moeglich');
  }

  protected get metricAriaLabel(): string {
    if (this.isLogDelete) {
      return this.uiTranslate('ui-text.test-results-delete-preview-dialog.betroffene-logs');
    }

    if (this.isResponseCleanup) {
      return this.uiTranslate('ui-text.test-results-delete-preview-dialog.betroffene-antworten');
    }

    return this.uiTranslate('ui-text.test-results-delete-preview-dialog.betroffene-testergebnisse');
  }

  protected get countNote(): string {
    if (this.isLogDelete) {
      return this.uiTranslate('ui-text.test-results-delete-preview-dialog.gezaehlt-werden-vorhandene-log-und-sitzungsdatensaetze-ergebnisdaten-und-antworten-werden');
    }

    if (this.isResponseCleanup) {
      return this.uiTranslate('ui-text.test-results-delete-preview-dialog.gezaehlt-werden-antworten-mit-passendem-chunk-zeitstempel-antworten-ohne-auswertbaren-zeit');
    }

    return this.uiTranslate('ui-text.test-results-delete-preview-dialog.die-zaehlweise-entspricht-der-arbeitsbereich-uebersicht-testhefte-aufgaben-und-antworten-w');
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
      return this.uiTranslate('ui-text.test-results-delete-preview-dialog.mit-diesen-antworten-werden-auch-vorhandene-antwort-kodierungen-entfernt-die-betroffenen-a');
    }

    return this.uiTranslate('ui-text.test-results-delete-preview-dialog.mit-diesen-testergebnissen-werden-auch-vorhandene-kodierergebnisse-entfernt', { value1: this.uiTranslate('ui-text.test-results-delete-preview-dialog.danach-erscheinen-diese-geloeschten-faelle-nicht-als-veralteter-kodierstand') });
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
        label: this.uiTranslate('ui-text.coding-management.aufgabenbearbeitungen'),
        value: impact.affectedUnits || 0,
        hint: this.uiTranslate('ui-text.test-results-delete-preview-dialog.mit-kodierung')
      },
      {
        label: this.uiTranslate('ui-text.coding-freshness-text.util.auto-coding-1'),
        value: impact.autoCodingV1 || 0,
        hint: 'Antwort-Kodierungen'
      },
      {
        label: this.uiTranslate('ws-admin.manual-coding'),
        value: impact.manualCodingV2 || 0,
        hint: 'Antwort-Kodierungen'
      },
      {
        label: this.uiTranslate('ui-text.coding-freshness-text.util.auto-coding-2'),
        value: impact.autoCodingV3 || 0,
        hint: 'Antwort-Kodierungen'
      }
    ];
  }

  protected get acknowledgementLabel(): string {
    if (this.isLogDelete) {
      return this.uiTranslate('ui-text.test-results-delete-preview-dialog.ich-verstehe-dass-diese-logs-endgueltig-entfernt-werden');
    }

    if (this.isResponseCleanup) {
      return this.uiTranslate('ui-text.test-results-delete-preview-dialog.ich-verstehe-dass-diese-antworten-endgueltig-geloescht-werden');
    }

    return this.uiTranslate('ui-text.test-results-delete-preview-dialog.ich-verstehe-dass-diese-testergebnisse-endgueltig-geloescht-werden');
  }

  protected get confirmButtonIcon(): string {
    return this.isLogDelete || this.isResponseCleanup ?
      'delete_sweep' :
      'delete_forever';
  }

  get confirmButtonLabel(): string {
    if (this.isLogDelete) {
      return this.uiTranslate('ui-text.test-results-delete-preview-dialog.logs-entfernen');
    }

    if (this.isResponseCleanup) {
      return this.uiTranslate('ui-text.test-results-delete-preview-dialog.antworten-loeschen');
    }

    return this.uiTranslate('ui-text.test-results-delete-preview-dialog.loeschung-starten');
  }

  get metrics(): DeleteMetric[] {
    if (this.isLogDelete) {
      return [
        {
          label: 'Booklet-Logs',
          value: this.preview.bookletLogs || 0
        },
        {
          label: this.uiTranslate('ui-text.test-results-delete-preview-dialog.aufgaben-logs'),
          value: this.preview.unitLogs || 0
        },
        {
          label: this.uiTranslate('ui-text.test-results-delete-preview-dialog.sitzungen'),
          value: this.preview.sessions || 0
        },
        {
          label: this.uiTranslate('ws-admin.test-persons'),
          value: this.preview.persons,
          hint: 'betroffen'
        }
      ];
    }

    if (this.isResponseCleanup) {
      return [
        {
          label: this.uiTranslate('variable-analysis.total-cases'),
          value: this.preview.responses,
          hint: this.uiTranslate('ui-text.test-results-delete-preview-dialog.mit-chunk-zeitstempel')
        },
        {
          label: this.uiTranslate('coding.jobs.table.units'),
          value: this.preview.units,
          hint: 'betroffen'
        },
        {
          label: this.uiTranslate('ui-text.files-validation.testhefte'),
          value: this.preview.booklets,
          hint: 'betroffen'
        },
        {
          label: this.uiTranslate('ws-admin.test-persons'),
          value: this.preview.persons,
          hint: 'betroffen'
        }
      ];
    }

    return [
      { label: this.uiTranslate('ws-admin.test-persons'), value: this.preview.persons },
      {
        label: this.uiTranslate('ui-text.files-validation.testhefte'),
        value: this.preview.booklets,
        hint: 'einzigartig'
      },
      {
        label: this.uiTranslate('coding.jobs.table.units'),
        value: this.preview.units,
        hint: 'einzigartig'
      },
      {
        label: this.uiTranslate('variable-analysis.total-cases'),
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
        this.preview.scope === 'filteredGroups' ||
        this.preview.scope === 'groups' ||
        this.totalLogRows >= 100;
    }

    if (this.isResponseCleanup) {
      return this.preview.responses > 0;
    }

    return this.preview.scope === 'filteredPersons' ||
      this.preview.scope === 'filteredGroups' ||
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

  protected get visibleGroups(): string[] {
    return this.preview.groups.slice(0, 6);
  }

  protected get visibleBooklets(): string[] {
    return this.preview.bookletNames.slice(0, 6);
  }

  protected get visibleUnits(): string[] {
    return this.preview.unitNames.slice(0, 6);
  }

  protected get hasDetails(): boolean {
    return this.preview.groups.length > 0 ||
      this.preview.bookletNames.length > 0 ||
      this.preview.unitNames.length > 0;
  }

  protected get hasResponseCleanupDetails(): boolean {
    return this.isResponseCleanup && !!this.preview.responseCleanup;
  }

  protected get responseCleanupTimeText(): string {
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
      this.uiTranslate('ui-text.test-results-delete-preview-dialog.alle-variablen-der-ausgewaehlten-aufgaben');
  }

  get responseCleanupSubformText(): string {
    const subforms = this.preview.responseCleanup?.subforms || [];
    return subforms.length > 0 ? subforms.join(', ') : this.uiTranslate('ui-text.test-results-delete-preview-dialog.alle-subforms');
  }

  get responseCleanupUnknownTimestampResponses(): number {
    return this.preview.responseCleanup?.unknownTimestampResponses || 0;
  }

  protected get responseCleanupSamples() {
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

  protected cancel(): void {
    this.dialogRef.close(false);
  }

  protected formatTimestamp(value: string | number | null | undefined): string {
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
