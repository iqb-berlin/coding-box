import { Injectable } from '@nestjs/common';
import * as fastCsv from 'fast-csv';
import * as ExcelJS from 'exceljs';
import { sanitizeCsvText } from '../../../utils/csv.util';
import { CodingReplayService } from './coding-replay.service';
import {
  KappaPairMetadata,
  KappaReplayContext,
  KappaSourceItem,
  KappaStatisticsOptions,
  KappaStatisticsResponse
} from './cohens-kappa.types';

type KappaDetailsExportOptions = Pick<
  KappaStatisticsOptions,
  'weightedMean' | 'excludeTrainings' | 'unitName' | 'variableId'
>;

const COHENS_KAPPA_EXPORT_HEADERS = [
  'Variable',
  'Unit',
  'Variablen-ID',
  'Job-Definition / Schulungsbezug',
  'Job-Namen',
  'Job-Definition-IDs',
  'Training-IDs',
  'Trainingslabels',
  'Kodierer 1 ID',
  'Kodierer 1',
  'Kodierer 2 ID',
  'Kodierer 2',
  'Anzahl doppelt kodierter Antworten',
  'Gueltige Paare',
  'Kappa-Wert',
  'Uebereinstimmung in Prozent',
  'Interpretation',
  'Trainings ausgeschlossen',
  'Mittelwert-Methode',
  'Berechnungsebene',
  'Unit-Filter',
  'Variablen-Filter',
  'Exportiert am'
] as const;

const COHENS_KAPPA_SUMMARY_EXPORT_HEADERS = [
  'subunit',
  'nCases',
  'nDop',
  'percDop',
  'meankappa',
  'meanagree'
] as const;

const COHENS_KAPPA_PAIRWISE_EXPORT_HEADERS = [
  'subunit',
  'nCases',
  'nDop',
  'percDop',
  'Coder1',
  'Coder2',
  'N',
  'kappa',
  'Coder1.1',
  'Coder2.1',
  'N.1',
  'agree'
] as const;

@Injectable()
export class CohensKappaExportService {
  constructor(private readonly codingReplayService: CodingReplayService) { }

  async createDetailsCsv(
    statistics: KappaStatisticsResponse,
    options: KappaDetailsExportOptions
  ): Promise<string> {
    const csvContent = await fastCsv.writeToString(this.createCohensKappaExportRows(statistics, options), {
      headers: [...COHENS_KAPPA_EXPORT_HEADERS],
      alwaysWriteHeaders: true,
      delimiter: ';',
      quote: '"'
    });
    return `\uFEFF${csvContent}`;
  }

  async createSummaryCsv(statistics: KappaStatisticsResponse): Promise<string> {
    const csvContent = await fastCsv.writeToString(this.createCohensKappaSummaryExportRows(statistics), {
      headers: [...COHENS_KAPPA_SUMMARY_EXPORT_HEADERS],
      alwaysWriteHeaders: true,
      delimiter: ';',
      quote: '"'
    });
    return `\uFEFF${csvContent}`;
  }

  private getSubunit(unitName: string, variableId: string): string {
    return `${unitName}_${variableId}`;
  }

  private toPercent(value: number | null): number | '' {
    return value === null ? '' : Math.round(value * 10000) / 100;
  }

  private roundDecimal(value: number | null | undefined, digits = 3): number | '' {
    if (value === null || value === undefined || Number.isNaN(value)) {
      return '';
    }
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  }

  private getKappaInterpretationLabel(interpretation: string): string {
    const labels: Record<string, string> = {
      'kappa.poor': 'Schlechte Uebereinstimmung',
      'kappa.slight': 'Schwache Uebereinstimmung',
      'kappa.fair': 'Maessige Uebereinstimmung',
      'kappa.moderate': 'Akzeptable Uebereinstimmung',
      'kappa.substantial': 'Substantielle Uebereinstimmung',
      'kappa.good': 'Gute Uebereinstimmung',
      'kappa.almost_perfect': 'Nahezu perfekte Uebereinstimmung',
      'No valid coding pairs': 'Keine gueltigen Kodierpaare'
    };

    return labels[interpretation] ?? interpretation;
  }

  private formatKappaScope(pair: KappaPairMetadata): string {
    const parts: string[] = [];

    if (pair.jobDefinitionIds.length > 0) {
      parts.push(`Job-Definitionen: ${pair.jobDefinitionIds.join(', ')}`);
    }

    if (pair.trainingLabels.length > 0) {
      parts.push(`Trainings: ${pair.trainingLabels.join(', ')}`);
    } else if (pair.trainingIds.length > 0) {
      parts.push(`Trainings: ${pair.trainingIds.join(', ')}`);
    }

    return parts.length > 0 ? parts.join('; ') : 'Direkte Kodierung';
  }

  private createCohensKappaExportRows(
    statistics: KappaStatisticsResponse,
    options: KappaDetailsExportOptions
  ): Record<string, string | number>[] {
    const exportedAt = new Date().toISOString();
    const weightingMethod = options.weightedMean ?
      'gewichteter Mittelwert' :
      'ungewichteter Mittelwert';

    return statistics.variables.flatMap(variable => variable.coderPairs.map(pair => ({
      Variable: sanitizeCsvText(`${variable.unitName} - ${variable.variableId}`),
      Unit: sanitizeCsvText(variable.unitName),
      'Variablen-ID': sanitizeCsvText(variable.variableId),
      'Job-Definition / Schulungsbezug': sanitizeCsvText(this.formatKappaScope(pair)),
      'Job-Namen': sanitizeCsvText(pair.jobNames.join(', ')),
      'Job-Definition-IDs': pair.jobDefinitionIds.join(', '),
      'Training-IDs': pair.trainingIds.join(', '),
      Trainingslabels: sanitizeCsvText(pair.trainingLabels.join(', ')),
      'Kodierer 1 ID': pair.coder1Id,
      'Kodierer 1': sanitizeCsvText(pair.coder1Name),
      'Kodierer 2 ID': pair.coder2Id,
      'Kodierer 2': sanitizeCsvText(pair.coder2Name),
      'Anzahl doppelt kodierter Antworten': pair.totalItems,
      'Gueltige Paare': pair.validPairs,
      'Kappa-Wert': pair.kappa ?? '',
      'Uebereinstimmung in Prozent': Math.round(pair.agreement * 1000) / 10,
      Interpretation: sanitizeCsvText(this.getKappaInterpretationLabel(pair.interpretation)),
      'Trainings ausgeschlossen': options.excludeTrainings ? 'ja' : 'nein',
      'Mittelwert-Methode': sanitizeCsvText(weightingMethod),
      Berechnungsebene: sanitizeCsvText(statistics.workspaceSummary.calculationLevel === 'score' ? 'Scores' : 'Codes'),
      'Unit-Filter': sanitizeCsvText(options.unitName),
      'Variablen-Filter': sanitizeCsvText(options.variableId),
      'Exportiert am': exportedAt
    })));
  }

  private createCohensKappaSummaryExportRows(
    statistics: KappaStatisticsResponse
  ): Record<string, string | number>[] {
    return statistics.variables.map(variable => ({
      subunit: sanitizeCsvText(this.getSubunit(variable.unitName, variable.variableId)),
      nCases: variable.caseCount,
      nDop: variable.doubleCodedCount,
      percDop: this.toPercent(variable.doubleCodedRate),
      meankappa: this.roundDecimal(variable.meanKappa),
      meanagree: this.roundDecimal(variable.meanAgreement)
    }));
  }

  private createCohensKappaPairwiseExportRows(
    statistics: KappaStatisticsResponse
  ): Record<string, string | number>[] {
    return statistics.variables.flatMap(variable => variable.coderPairs.map(pair => ({
      subunit: sanitizeCsvText(this.getSubunit(variable.unitName, variable.variableId)),
      nCases: variable.caseCount,
      nDop: variable.doubleCodedCount,
      percDop: this.toPercent(variable.doubleCodedRate),
      Coder1: sanitizeCsvText(pair.coder1Name),
      Coder2: sanitizeCsvText(pair.coder2Name),
      N: pair.validPairs,
      kappa: this.roundDecimal(pair.kappa),
      'Coder1.1': sanitizeCsvText(pair.coder1Name),
      'Coder2.1': sanitizeCsvText(pair.coder2Name),
      'N.1': pair.validPairs,
      agree: this.roundDecimal(pair.agreement)
    })));
  }

  private createCohensKappaCodingResultRows(
    sourceItems: KappaSourceItem[],
    replayUrlByItemKey: Map<string, string>
  ): {
    headers: string[];
    rows: Record<string, string | number>[];
  } {
    const coderNamesById = new Map<number, string>();
    sourceItems.forEach(item => {
      item.coderResults.forEach(result => {
        if (!coderNamesById.has(result.coderId)) {
          coderNamesById.set(result.coderId, result.coderName);
        }
      });
    });

    const coderNameCounts = new Map<string, number>();
    coderNamesById.forEach(coderName => {
      coderNameCounts.set(coderName, (coderNameCounts.get(coderName) ?? 0) + 1);
    });

    const coderColumnCandidates = Array.from(coderNamesById.entries())
      .map(([coderId, coderName]) => ({
        coderId,
        baseLabel: (coderNameCounts.get(coderName) ?? 0) > 1 ?
          `${coderName} (${coderId})` :
          coderName
      }))
      .sort((a, b) => a.baseLabel.localeCompare(b.baseLabel) || a.coderId - b.coderId);
    const usedCoderColumnLabels = new Set<string>();
    const coderColumns = coderColumnCandidates.map(column => {
      let label = column.baseLabel;
      let suffix = 2;
      while (usedCoderColumnLabels.has(label)) {
        label = `${column.baseLabel} [${column.coderId}${suffix > 2 ? `-${suffix}` : ''}]`;
        suffix += 1;
      }
      usedCoderColumnLabels.add(label);
      return {
        coderId: column.coderId,
        label
      };
    });
    const coderColumnLabelById = new Map(coderColumns.map(column => [column.coderId, column.label]));
    const headers = [
      'Test.Person.Login',
      'Test.Person.Group',
      'Unit',
      'Variable',
      'subunit',
      'Replay URL',
      ...coderColumns.flatMap(column => [`${column.label}.Code`, `${column.label}.Score`]),
      'Kommentare',
      'Häuf.W',
      'Abw'
    ];
    const rows = sourceItems.map(item => {
      const row: Record<string, string | number> = {
        'Test.Person.Login': sanitizeCsvText(item.personLogin),
        'Test.Person.Group': sanitizeCsvText(item.personGroup),
        Unit: sanitizeCsvText(item.unitName),
        Variable: sanitizeCsvText(item.variableId),
        subunit: sanitizeCsvText(this.getSubunit(item.unitName, item.variableId)),
        'Replay URL': replayUrlByItemKey.get(this.getKappaSourceItemKey(item)) ?? ''
      };
      const codeCounts = new Map<number, number>();
      const comments: string[] = [];

      coderColumns.forEach(column => {
        row[`${column.label}.Code`] = '';
        row[`${column.label}.Score`] = '';
      });

      item.coderResults.forEach(result => {
        const columnLabel = coderColumnLabelById.get(result.coderId) ?? result.coderName;
        row[`${columnLabel}.Code`] = result.code ?? '';
        row[`${columnLabel}.Score`] = result.score ?? '';
        if (result.code !== null) {
          codeCounts.set(result.code, (codeCounts.get(result.code) ?? 0) + 1);
        }
        if (result.notes?.trim()) {
          comments.push(`${columnLabel}: ${result.notes.trim()}`);
        }
      });

      let modalCode: number | '' = '';
      let modalCount = 0;
      codeCounts.forEach((count, code) => {
        if (count > modalCount) {
          modalCount = count;
          modalCode = code;
        }
      });
      const codedCount = Array.from(codeCounts.values()).reduce((sum, count) => sum + count, 0);

      row.Kommentare = sanitizeCsvText(comments.join(' | '));
      row['Häuf.W'] = modalCode;
      row.Abw = codedCount > 0 ? codedCount - modalCount : '';

      return row;
    });

    return { headers, rows };
  }

  private applyWorksheetHeaderStyle(worksheet: ExcelJS.Worksheet): void {
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };
    worksheet.views = [{ state: 'frozen', ySplit: 1 }];
    worksheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: worksheet.columnCount }
    };
  }

  private addRowsWorksheet(
    workbook: ExcelJS.Workbook,
    sheetName: string,
    headers: readonly string[],
    rows: Record<string, string | number>[]
  ): void {
    const worksheet = workbook.addWorksheet(sheetName);
    worksheet.columns = headers.map(header => ({
      header,
      key: header,
      width: Math.max(12, Math.min(28, header.length + 4))
    }));
    rows.forEach(row => worksheet.addRow(row));
    this.applyWorksheetHeaderStyle(worksheet);
  }

  private getKappaSourceItemKey(
    item: Pick<KappaSourceItem, 'responseId' | 'unitName' | 'variableId'>
  ): string {
    return JSON.stringify([item.responseId, item.unitName, item.variableId]);
  }

  private async createCohensKappaReplayUrlMap(
    workspaceId: number,
    sourceItems: KappaSourceItem[],
    context: KappaReplayContext
  ): Promise<Map<string, string>> {
    const { serverUrl, authToken } = context;
    if (!serverUrl || sourceItems.length === 0) {
      return new Map();
    }

    const replayItems = sourceItems.map(item => ({
      responseId: item.responseId,
      unitName: item.unitName,
      unitAlias: null,
      variableId: item.variableId,
      variableAnchor: item.variableAnchor || item.variableId,
      bookletName: item.bookletName,
      personLogin: item.personLogin,
      personCode: item.personCode,
      personGroup: item.personGroup
    }));
    const replayRows = await this.codingReplayService.generateReplayUrlsForItemsBulk(
      workspaceId,
      replayItems,
      serverUrl,
      authToken
    );

    return new Map(replayRows.map(row => [
      this.getKappaSourceItemKey(row),
      row.replayUrl
    ]));
  }

  async createWorkbook(
    workspaceId: number,
    statistics: KappaStatisticsResponse,
    sourceItems: KappaSourceItem[],
    context: KappaReplayContext
  ): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Kodierbox';
    workbook.created = new Date();
    const replayUrlByItemKey = await this.createCohensKappaReplayUrlMap(
      workspaceId,
      sourceItems,
      context
    );

    this.addRowsWorksheet(
      workbook,
      'Übereinstimmung_gesamt',
      COHENS_KAPPA_SUMMARY_EXPORT_HEADERS,
      this.createCohensKappaSummaryExportRows(statistics)
    );
    this.addRowsWorksheet(
      workbook,
      'Übereinstimmung_paarweise',
      COHENS_KAPPA_PAIRWISE_EXPORT_HEADERS,
      this.createCohensKappaPairwiseExportRows(statistics)
    );

    const codingResults = this.createCohensKappaCodingResultRows(sourceItems, replayUrlByItemKey);
    this.addRowsWorksheet(
      workbook,
      'Kodierergebnisse',
      codingResults.headers,
      codingResults.rows
    );

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }
}
