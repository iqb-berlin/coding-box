import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
  Body,
  Logger,
  BadRequestException,
  Res
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiBody
} from '@nestjs/swagger';
import { Response } from 'express';
import * as fastCsv from 'fast-csv';
import * as ExcelJS from 'exceljs';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { WorkspaceGuard } from './workspace.guard';
import { WorkspaceId } from './workspace.decorator';
import {
  CodingStatisticsService,
  CodingJobService,
  CodingProgressService,
  CodingReviewService,
  CodingFreshnessService,
  CodingProcessService,
  CodingReadinessService
} from '../../database/services/coding';
import { PersonService } from '../../database/services/test-results';
import { CodingStatistics } from '../../database/services/shared';
import {
  CodingFreshnessJobResultDto,
  CodingFreshnessScopeDto,
  CodingFreshnessState,
  CodingFreshnessSummaryDto,
  CodingFreshnessVersion,
  StartCodingFreshnessJobDto
} from '../../../../../../api-dto/coding/coding-freshness.dto';
import { AutocodingReadinessDto } from '../../../../../../api-dto/coding/autocoding-readiness.dto';
import { JobQueueService } from '../../job-queue/job-queue.service';
import { sanitizeCsvText } from '../../utils/csv.util';

type CodingStatisticsJobStatusResponse = {
  status: string;
  progress: number;
  result?: CodingStatistics;
  error?: string;
};

type DistributionDoubleCodingInfoResponse = {
  totalCases: number;
  distinctCases?: number;
  codingTasksTotal?: number;
  doubleCodedCases: number;
  singleCodedCasesAssigned: number;
  doubleCodedCasesPerCoder: Record<string, number>;
  doubleCodedCasesPerCoderId?: Record<string, number>;
};

type DistributionCalculationResponse = {
  distribution: Record<string, Record<string, number>>;
  distributionByCoderId: Record<string, Record<string, number>>;
  doubleCodingInfo: Record<string, DistributionDoubleCodingInfoResponse>;
  aggregationInfo: Record<string, { uniqueCases: number; totalResponses: number }>;
  matchingFlags: string[];
  warnings: Array<{
    unitName: string;
    variableId: string;
    message: string;
    casesInJobs: number;
    availableCases: number;
  }>;
  pairDistribution: Record<string, number>;
  tasksPerCoder: Record<string, number>;
  coderWeights: Record<string, number>;
};

type DistributedCodingJobsResponse = DistributionCalculationResponse & {
  success: boolean;
  jobsCreated: number;
  message: string;
  jobs: Array<{
    itemKey: string;
    coderId: number;
    coderName: string;
    variable: { unitName: string; variableId: string };
    jobId: number;
    jobName: string;
    caseCount: number;
  }>;
};

type KappaMeanInput = {
  kappa: number | null;
  validPairs: number;
};

type KappaAgreementInput = {
  agreement: number;
  validPairs: number;
};

type KappaPairMetadata = {
  jobNames: string[];
  jobDefinitionIds: number[];
  trainingIds: number[];
  trainingLabels: string[];
};

type KappaCoderPairStatistics = KappaMeanInput & KappaPairMetadata & {
  coder1Id: number;
  coder1Name: string;
  coder2Id: number;
  coder2Name: string;
  agreement: number;
  totalItems: number;
  interpretation: string;
};

type KappaStatisticsResponse = {
  variables: Array<{
    unitName: string;
    variableId: string;
    meanKappa: number | null;
    meanAgreement: number | null;
    caseCount: number;
    doubleCodedCount: number;
    doubleCodedRate: number | null;
    validPairCount: number;
    coderPairCount: number;
    coderPairs: KappaCoderPairStatistics[];
  }>;
  workspaceSummary: {
    totalCodedResponses: number;
    totalDoubleCodedResponses: number;
    totalCoderPairs: number;
    averageKappa: number | null;
    meanAgreement: number | null;
    variablesIncluded: number;
    codersIncluded: number;
    weightingMethod: 'weighted' | 'unweighted';
  };
};

type KappaStatisticsBuildResult = KappaStatisticsResponse & {
  sourceItems: KappaSourceItem[];
};

type KappaStatisticsOptions = {
  weightedMean: boolean;
  excludeTrainings: boolean;
  unitName?: string;
  variableId?: string;
  jobDefinitionIds: number[];
  coderTrainingIds: number[];
  coderIds: number[];
};

type KappaSourceItem = {
  unitName: string;
  variableId: string;
  personLogin: string;
  personCode: string;
  personGroup: string;
  coderResults: Array<{
    coderId: number;
    coderName: string;
    jobId: number;
    jobName: string;
    jobDefinitionId?: number | null;
    trainingId?: number | null;
    trainingLabel?: string | null;
    code: number | null;
    score: number | null;
    notes: string | null;
    codedAt: Date;
  }>;
};

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

@ApiTags('Admin Workspace Coding')
@Controller('admin/workspace')
export class WorkspaceCodingStatisticsController {
  private readonly logger = new Logger(WorkspaceCodingStatisticsController.name);
  constructor(
    private codingStatisticsService: CodingStatisticsService,
    private codingJobService: CodingJobService,
    private personService: PersonService,
    private codingProgressService: CodingProgressService,
    private codingReviewService: CodingReviewService,
    private codingFreshnessService: CodingFreshnessService,
    private codingProcessService: CodingProcessService,
    private codingReadinessService: CodingReadinessService,
    private jobQueueService: JobQueueService
  ) { }

  private calculateMeanKappa(
    kappaResults: KappaMeanInput[],
    weightedMean: boolean
  ): number | null {
    if (weightedMean) {
      let totalWeightedKappa = 0;
      let totalWeight = 0;

      for (const result of kappaResults) {
        if (result.kappa !== null && !Number.isNaN(result.kappa)) {
          totalWeightedKappa += result.kappa * result.validPairs;
          totalWeight += result.validPairs;
        }
      }

      return totalWeight > 0 ?
        Math.round((totalWeightedKappa / totalWeight) * 1000) / 1000 :
        null;
    }

    let totalKappa = 0;
    let validKappaCount = 0;

    for (const result of kappaResults) {
      if (result.kappa !== null && !Number.isNaN(result.kappa)) {
        totalKappa += result.kappa;
        validKappaCount += 1;
      }
    }

    return validKappaCount > 0 ?
      Math.round((totalKappa / validKappaCount) * 1000) / 1000 :
      null;
  }

  private calculateMeanAgreement(
    kappaResults: KappaAgreementInput[],
    weightedMean: boolean
  ): number | null {
    if (weightedMean) {
      let weightedAgreement = 0;
      let totalWeight = 0;

      for (const result of kappaResults) {
        if (result.validPairs > 0) {
          weightedAgreement += result.agreement * result.validPairs;
          totalWeight += result.validPairs;
        }
      }

      return totalWeight > 0 ?
        Math.round((weightedAgreement / totalWeight) * 1000) / 1000 :
        null;
    }

    let agreementSum = 0;
    let agreementCount = 0;

    for (const result of kappaResults) {
      if (result.validPairs > 0) {
        agreementSum += result.agreement;
        agreementCount += 1;
      }
    }

    return agreementCount > 0 ?
      Math.round((agreementSum / agreementCount) * 1000) / 1000 :
      null;
  }

  private getSubunit(unitName: string, variableId: string): string {
    return `${unitName}_${variableId}`;
  }

  private getVariableKey(unitName: string, variableId: string): string {
    return JSON.stringify([unitName, variableId]);
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

  private toPublicCohensKappaStatistics(
    statistics: KappaStatisticsBuildResult
  ): KappaStatisticsResponse {
    return {
      variables: statistics.variables,
      workspaceSummary: statistics.workspaceSummary
    };
  }

  private getCompletedCodeCount(item: KappaSourceItem): number {
    return item.coderResults.filter(result => result.code !== null).length;
  }

  private getCoderPairKey(coder1Id: number, coder2Id: number): string {
    return coder1Id < coder2Id ?
      `${coder1Id}-${coder2Id}` :
      `${coder2Id}-${coder1Id}`;
  }

  private emptyKappaPairMetadata(): KappaPairMetadata {
    return {
      jobNames: [],
      jobDefinitionIds: [],
      trainingIds: [],
      trainingLabels: []
    };
  }

  private addCoderResultMetadata(
    metadata: {
      jobNames: Set<string>;
      jobDefinitionIds: Set<number>;
      trainingIds: Set<number>;
      trainingLabels: Set<string>;
    },
    result: KappaSourceItem['coderResults'][number]
  ): void {
    if (result.jobName) {
      metadata.jobNames.add(result.jobName);
    }
    if (result.jobDefinitionId !== null && result.jobDefinitionId !== undefined) {
      metadata.jobDefinitionIds.add(result.jobDefinitionId);
    }
    if (result.trainingId !== null && result.trainingId !== undefined) {
      metadata.trainingIds.add(result.trainingId);
    }
    if (result.trainingLabel) {
      metadata.trainingLabels.add(result.trainingLabel);
    }
  }

  private toKappaPairMetadata(metadata: {
    jobNames: Set<string>;
    jobDefinitionIds: Set<number>;
    trainingIds: Set<number>;
    trainingLabels: Set<string>;
  }): KappaPairMetadata {
    return {
      jobNames: Array.from(metadata.jobNames).sort((a, b) => a.localeCompare(b)),
      jobDefinitionIds: Array.from(metadata.jobDefinitionIds).sort((a, b) => a - b),
      trainingIds: Array.from(metadata.trainingIds).sort((a, b) => a - b),
      trainingLabels: Array.from(metadata.trainingLabels).sort((a, b) => a.localeCompare(b))
    };
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
    options: Pick<KappaStatisticsOptions, 'weightedMean' | 'excludeTrainings' | 'unitName' | 'variableId'>
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
    sourceItems: KappaSourceItem[]
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
        subunit: sanitizeCsvText(this.getSubunit(item.unitName, item.variableId))
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

  private async createCohensKappaWorkbookBuffer(
    statistics: KappaStatisticsResponse,
    sourceItems: KappaSourceItem[]
  ): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Kodierbox';
    workbook.created = new Date();

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

    const codingResults = this.createCohensKappaCodingResultRows(sourceItems);
    this.addRowsWorksheet(
      workbook,
      'Kodierergebnisse',
      codingResults.headers,
      codingResults.rows
    );

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  private async buildCohensKappaStatistics(
    workspaceId: number,
    options: KappaStatisticsOptions
  ): Promise<KappaStatisticsBuildResult> {
    this.logger.log(
      `Calculating Cohen's Kappa for workspace ${workspaceId}${options.unitName ? `, unit: ${options.unitName}` : ''
      }${options.variableId ? `, variable: ${options.variableId}` : ''}`
    );

    const allCodedItems = (await this.codingReviewService.getCodedVariablesForKappa(
      workspaceId,
      options.excludeTrainings,
      options.jobDefinitionIds,
      options.coderTrainingIds,
      options.coderIds
    )).map(item => ({
      unitName: item.unitName,
      variableId: item.variableId,
      personLogin: item.personLogin,
      personCode: item.personCode,
      personGroup: item.personGroup,
      coderResults: item.coderResults.map(result => ({
        coderId: result.coderId,
        coderName: result.coderName,
        jobId: result.jobId,
        jobName: result.jobName,
        jobDefinitionId: result.jobDefinitionId ?? null,
        trainingId: result.trainingId ?? null,
        trainingLabel: result.trainingLabel ?? null,
        code: result.code,
        score: result.score,
        notes: result.notes,
        codedAt: result.codedAt
      }))
    }));

    const groupedData = new Map<string, {
      unitName: string;
      variableId: string;
      items: KappaSourceItem[];
    }>();
    const filteredCodedItems: KappaSourceItem[] = [];

    allCodedItems.forEach(item => {
      if (options.unitName && item.unitName !== options.unitName) return;
      if (options.variableId && item.variableId !== options.variableId) return;

      filteredCodedItems.push(item);
      const key = this.getVariableKey(item.unitName, item.variableId);
      if (!groupedData.has(key)) {
        groupedData.set(key, {
          unitName: item.unitName,
          variableId: item.variableId,
          items: []
        });
      }
      groupedData.get(key)!.items.push(item);
    });

    const variables: KappaStatisticsResponse['variables'] = [];
    const allKappaResults: KappaCoderPairStatistics[] = [];
    const uniqueVariables = new Set<string>();
    const uniqueCoders = new Set<number>();

    for (const [key, group] of groupedData.entries()) {
      const { unitName: unitNameKey, variableId: variableIdKey, items } = group;
      const doubleCodedItems = items.filter(item => this.getCompletedCodeCount(item) >= 2);

      uniqueVariables.add(key);

      const allCoders = new Set<number>();
      doubleCodedItems.forEach(item => {
        item.coderResults.forEach(cr => {
          allCoders.add(cr.coderId);
          uniqueCoders.add(cr.coderId);
        });
      });

      const coderArray = Array.from(allCoders);
      const coderPairs: Array<{
        coder1Id: number;
        coder1Name: string;
        coder2Id: number;
        coder2Name: string;
        unitName: string;
        variableId: string;
        codes: Array<{ code1: number | null; code2: number | null }>;
      }> = [];
      const pairMetadataByKey = new Map<string, KappaPairMetadata>();

      for (let i = 0; i < coderArray.length; i++) {
        for (let j = i + 1; j < coderArray.length; j++) {
          const coder1Id = coderArray[i];
          const coder2Id = coderArray[j];

          let coder1Name = '';
          let coder2Name = '';
          items.forEach(item => {
            item.coderResults.forEach(cr => {
              if (cr.coderId === coder1Id) coder1Name = cr.coderName;
              if (cr.coderId === coder2Id) coder2Name = cr.coderName;
            });
          });

          const codes: Array<{ code1: number | null; code2: number | null }> = [];
          const metadata = {
            jobNames: new Set<string>(),
            jobDefinitionIds: new Set<number>(),
            trainingIds: new Set<number>(),
            trainingLabels: new Set<string>()
          };

          doubleCodedItems.forEach(item => {
            const coder1Result = item.coderResults.find(
              cr => cr.coderId === coder1Id
            );
            const coder2Result = item.coderResults.find(
              cr => cr.coderId === coder2Id
            );

            if (coder1Result && coder2Result) {
              codes.push({
                code1: coder1Result.code,
                code2: coder2Result.code
              });
              this.addCoderResultMetadata(metadata, coder1Result);
              this.addCoderResultMetadata(metadata, coder2Result);
            }
          });

          if (codes.length > 0) {
            const pairKey = this.getCoderPairKey(coder1Id, coder2Id);
            pairMetadataByKey.set(pairKey, this.toKappaPairMetadata(metadata));
            coderPairs.push({
              coder1Id,
              coder1Name,
              coder2Id,
              coder2Name,
              unitName: unitNameKey,
              variableId: variableIdKey,
              codes
            });
          }
        }
      }

      const kappaResults = coderPairs.length > 0 ?
        this.codingStatisticsService
          .calculateCohensKappa(coderPairs)
          .map(result => ({
            ...result,
            ...(pairMetadataByKey.get(
              this.getCoderPairKey(result.coder1Id, result.coder2Id)
            ) ?? this.emptyKappaPairMetadata())
          })) as KappaCoderPairStatistics[] :
        [];

      allKappaResults.push(...kappaResults);
      const validPairCount = kappaResults.reduce(
        (sum, result) => sum + (result.validPairs > 0 ? result.validPairs : 0),
        0
      );
      const coderPairCount = kappaResults.filter(result => result.validPairs > 0).length;
      const caseCount = items.length;
      const doubleCodedCount = doubleCodedItems.length;

      variables.push({
        unitName: unitNameKey,
        variableId: variableIdKey,
        meanKappa: this.calculateMeanKappa(kappaResults, options.weightedMean),
        meanAgreement: this.calculateMeanAgreement(kappaResults, options.weightedMean),
        caseCount,
        doubleCodedCount,
        doubleCodedRate: caseCount > 0 ? doubleCodedCount / caseCount : null,
        validPairCount,
        coderPairCount,
        coderPairs: kappaResults
      });
    }

    let validKappaCount = 0;
    allKappaResults.forEach(result => {
      if (result.kappa !== null && !Number.isNaN(result.kappa)) {
        validKappaCount += 1;
      }
    });

    const averageKappa = this.calculateMeanKappa(allKappaResults, options.weightedMean);
    const totalCodedResponses = variables.reduce((sum, variable) => sum + variable.caseCount, 0);
    const totalDoubleCodedResponses = variables.reduce((sum, variable) => sum + variable.doubleCodedCount, 0);
    const workspaceSummary = {
      totalCodedResponses,
      totalDoubleCodedResponses,
      totalCoderPairs: validKappaCount,
      averageKappa,
      meanAgreement: this.calculateMeanAgreement(allKappaResults, options.weightedMean),
      variablesIncluded: uniqueVariables.size,
      codersIncluded: uniqueCoders.size,
      weightingMethod: (options.weightedMean ? 'weighted' : 'unweighted') as 'weighted' | 'unweighted'
    };

    this.logger.log(
      `Calculated Cohen's Kappa for ${variables.length} unit/variable combinations in workspace ${workspaceId}, average kappa: ${averageKappa}`
    );

    return {
      variables,
      workspaceSummary,
      sourceItems: filteredCodedItems
    };
  }

  @Get(':workspace_id/coding/statistics')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiQuery({
    name: 'version',
    required: false,
    description: 'Coding version to get statistics for: v1, v2, or v3',
    enum: ['v1', 'v2', 'v3'],
    example: 'v1'
  })
  @ApiOkResponse({
    description: 'Coding statistics retrieved successfully.'
  })
  async getCodingStatistics(
    @WorkspaceId() workspace_id: number,
                   @Query('version') version: 'v1' | 'v2' | 'v3' = 'v1'
  ): Promise<CodingStatistics> {
    return this.codingStatisticsService.getCodingStatistics(
      workspace_id,
      version
    );
  }

  @Get(':workspace_id/coding/freshness')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiOkResponse({
    description: 'Coding freshness summary retrieved successfully.'
  })
  async getCodingFreshnessSummary(
    @WorkspaceId() workspace_id: number
  ): Promise<CodingFreshnessSummaryDto> {
    return this.codingFreshnessService.getSummary(workspace_id);
  }

  @Get(':workspace_id/coding/freshness/scope')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiQuery({
    name: 'version',
    required: false,
    description: 'Coding version(s) to include. Supports comma-separated values.',
    enum: ['v1', 'v2', 'v3']
  })
  @ApiQuery({
    name: 'state',
    required: false,
    description: 'Freshness state(s) to include. Supports comma-separated values.',
    enum: ['PENDING', 'STALE', 'MANUAL_REVIEW_REQUIRED']
  })
  @ApiOkResponse({
    description: 'Coding freshness scope retrieved successfully.'
  })
  async getCodingFreshnessScope(
    @WorkspaceId() workspace_id: number,
      @Query('version') version?: string | string[],
      @Query('state') state?: string | string[]
  ): Promise<CodingFreshnessScopeDto> {
    return this.codingFreshnessService.getScope(
      workspace_id,
      this.parseVersions(version),
      this.parseStates(state)
    );
  }

  @Get(':workspace_id/coding/readiness')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiQuery({
    name: 'autoCoderRun',
    required: false,
    description: 'Autocoder run to validate.',
    enum: [1, 2]
  })
  @ApiQuery({
    name: 'forceRefresh',
    required: false,
    description: 'Ignore the short-lived readiness cache and recalculate.'
  })
  @ApiOkResponse({
    description: 'Auto-coding readiness diagnostics retrieved successfully.'
  })
  async getAutocodingReadiness(
    @WorkspaceId() workspace_id: number,
      @Query('autoCoderRun') autoCoderRun?: string | string[],
      @Query('forceRefresh') forceRefresh?: string | string[]
  ): Promise<AutocodingReadinessDto> {
    return this.codingReadinessService.getReadiness(workspace_id, {
      autoCoderRun: this.parseAutoCoderRun(autoCoderRun),
      forceRefresh: this.parseBooleanQuery(forceRefresh)
    });
  }

  @Post(':workspace_id/coding/freshness/code')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['version'],
      properties: {
        version: { type: 'string', enum: ['v1', 'v3'] },
        states: {
          type: 'array',
          items: { type: 'string', enum: ['PENDING', 'STALE'] }
        }
      }
    }
  })
  @ApiOkResponse({
    description: 'Coding freshness auto-coding job created successfully.'
  })
  async codeFreshnessScope(
    @WorkspaceId() workspace_id: number,
      @Body() body: StartCodingFreshnessJobDto
  ): Promise<CodingFreshnessJobResultDto> {
    await this.jobQueueService.assertNoDependencyConflicts('test-person-coding', workspace_id);

    const version = body.version === 'v3' ? 'v3' : 'v1';
    const states = this.parseCodingStates(body.states);
    const scope = await this.codingFreshnessService.getScope(
      workspace_id,
      [version],
      states
    );

    if (scope.unitIds.length === 0 || scope.personIds.length === 0) {
      return {
        totalResponses: 0,
        statusCounts: {},
        message: 'No coding freshness units need auto-coding.',
        unitCount: 0,
        personCount: 0,
        groupNames: []
      };
    }

    await this.codingFreshnessService.assertAutoCodingRunCanStart(
      workspace_id,
      version === 'v3' ? 2 : 1
    );

    const result = await this.codingProcessService.codeUnitIds(
      workspace_id,
      scope.unitIds,
      version === 'v3' ? 2 : 1,
      {
        source: 'coding-freshness',
        freshnessVersion: version,
        freshnessStates: states,
        freshnessSourceRevision: scope.currentRevision,
        groupNames: scope.groupNames.join(',')
      }
    );

    return {
      ...result,
      unitCount: scope.unitCount,
      personCount: scope.personCount,
      groupNames: scope.groupNames
    };
  }

  @Post(':workspace_id/coding/statistics/job')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiOkResponse({
    description: 'Coding statistics job created successfully.',
    schema: {
      type: 'object',
      properties: {
        jobId: { type: 'string' },
        message: { type: 'string' }
      }
    }
  })
  @ApiQuery({
    name: 'version',
    required: false,
    description: 'Coding version to calculate statistics for: v1, v2, or v3',
    enum: ['v1', 'v2', 'v3'],
    example: 'v1'
  })
  async createCodingStatisticsJob(
    @WorkspaceId() workspace_id: number,
                   @Query('version') version: 'v1' | 'v2' | 'v3' = 'v1'
  ): Promise<{ jobId: string; message: string }> {
    return this.codingStatisticsService.createCodingStatisticsJob(workspace_id, version);
  }

  @Get(':workspace_id/coding/statistics/job/:jobId')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({ name: 'jobId', type: String, description: 'ID of the coding statistics job' })
  @ApiOkResponse({
    description: 'Coding statistics job status retrieved successfully.'
  })
  async getCodingStatisticsJobStatus(
    @Param('jobId') jobId: string
  ): Promise<CodingStatisticsJobStatusResponse | { error: string }> {
    const status = await this.codingStatisticsService.getCodingStatisticsJobStatus(jobId);
    if (!status) {
      return { error: `Coding statistics job with ID ${jobId} not found` };
    }
    return status;
  }

  private parseVersions(value?: string | string[]): CodingFreshnessVersion[] {
    const allowed = new Set<CodingFreshnessVersion>(['v1', 'v2', 'v3']);
    const values = this.parseArrayQuery(value);
    const versions = values.filter((item): item is CodingFreshnessVersion => (
      allowed.has(item as CodingFreshnessVersion)
    ));
    return versions.length > 0 ? versions : ['v1', 'v2', 'v3'];
  }

  private parseStates(value?: string | string[]): CodingFreshnessState[] {
    const allowed = new Set<CodingFreshnessState>([
      'PENDING',
      'STALE',
      'MANUAL_REVIEW_REQUIRED'
    ]);
    const values = this.parseArrayQuery(value);
    const states = values.filter((item): item is CodingFreshnessState => (
      allowed.has(item as CodingFreshnessState)
    ));
    return states.length > 0 ? states : ['PENDING', 'STALE', 'MANUAL_REVIEW_REQUIRED'];
  }

  private parseCodingStates(
    states?: Extract<CodingFreshnessState, 'PENDING' | 'STALE'>[]
  ): Extract<CodingFreshnessState, 'PENDING' | 'STALE'>[] {
    const allowed = new Set<Extract<CodingFreshnessState, 'PENDING' | 'STALE'>>([
      'PENDING',
      'STALE'
    ]);
    const values = (states || []).filter(state => allowed.has(state));
    return values.length > 0 ? values : ['PENDING', 'STALE'];
  }

  private parseAutoCoderRun(value?: string | string[]): 1 | 2 {
    const values = this.parseArrayQuery(value);
    if (values.length === 0) {
      return 1;
    }
    if (values.length > 1) {
      throw new BadRequestException('autoCoderRun must be provided only once');
    }
    const numericValue = Number(values[0]);
    if (numericValue === 1 || numericValue === 2) {
      return numericValue;
    }
    throw new BadRequestException('autoCoderRun must be 1 or 2');
  }

  private parseBooleanQuery(value?: string | string[]): boolean {
    const values = this.parseArrayQuery(value);
    if (values.length === 0) {
      return false;
    }
    if (values.length > 1) {
      throw new BadRequestException('Boolean query value must be provided only once');
    }

    const normalized = values[0].toLowerCase();
    if (['true', '1', 'yes'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'no', ''].includes(normalized)) {
      return false;
    }
    throw new BadRequestException('Boolean query value must be true or false');
  }

  private parseArrayQuery(value?: string | string[]): string[] {
    const rawValues = Array.isArray(value) ? value : [value || ''];
    return rawValues
      .flatMap(item => String(item).split(','))
      .map(item => item.trim())
      .filter(item => item !== '');
  }

  private parseIdArrayQuery(value?: string | string[]): number[] {
    return this.parseArrayQuery(value).map(item => {
      const parsed = Number(item);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new BadRequestException('ID query values must be positive integers');
      }
      return parsed;
    });
  }

  private buildKappaOptionsFromQuery(query: {
    weightedMean?: string;
    excludeTrainings?: string;
    unitName?: string;
    variableId?: string;
    jobDefinitionIds?: string | string[];
    coderTrainingIds?: string | string[];
    coderIds?: string | string[];
  }): KappaStatisticsOptions {
    const coderTrainingIds = this.parseIdArrayQuery(query.coderTrainingIds);

    return {
      weightedMean: query.weightedMean !== 'false',
      excludeTrainings: coderTrainingIds.length > 0 ? false : query.excludeTrainings !== 'false',
      unitName: query.unitName,
      variableId: query.variableId,
      jobDefinitionIds: this.parseIdArrayQuery(query.jobDefinitionIds),
      coderTrainingIds,
      coderIds: this.parseIdArrayQuery(query.coderIds)
    };
  }

  @Get(':workspace_id/coding/groups')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiOkResponse({
    description:
      'List of all test person groups in the workspace retrieved successfully.',
    schema: {
      type: 'array',
      items: {
        type: 'string',
        description: 'Group name'
      }
    }
  })
  async getWorkspaceGroups(
    @WorkspaceId() workspace_id: number
  ): Promise<string[]> {
    return this.personService.getWorkspaceGroups(workspace_id);
  }

  @Get(':workspace_id/coding/groups/stats')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiOkResponse({
    description:
      'List of all test person groups in the workspace with coding statistics.',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          groupName: { type: 'string', description: 'Group name' },
          testPersonCount: {
            type: 'number',
            description: 'Number of test persons in this group'
          },
          responsesToCode: {
            type: 'number',
            description:
              'Number of responses that still need to be coded for this group'
          }
        }
      }
    }
  })
  async getWorkspaceGroupCodingStats(
    @WorkspaceId() workspace_id: number
  ): Promise<
      { groupName: string; testPersonCount: number; responsesToCode: number }[]
      > {
    return this.personService.getWorkspaceGroupCodingStats(workspace_id);
  }

  @Get(':workspace_id/coding/progress-overview')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiOkResponse({
    description: 'Coding progress overview retrieved successfully.',
    schema: {
      type: 'object',
      properties: {
        totalCasesToCode: {
          type: 'number',
          description: 'Total number of cases that need to be coded'
        },
        statusTotalCasesToCode: {
          type: 'number',
          description:
            'Raw status total before covered source variables are excluded'
        },
        coveredSourceVariableCount: {
          type: 'number',
          description:
            'Number of source variables represented by derived manual variables'
        },
        coveredSourceResponseCount: {
          type: 'number',
          description:
            'Number of source responses excluded because their derived variables are coded manually'
        },
        completedCases: {
          type: 'number',
          description:
            'Number of cases that have been completed through coding jobs'
        },
        completionPercentage: {
          type: 'number',
          description: 'Percentage of coding completion after duplicate aggregation'
        },
        rawTotalCasesToCode: {
          type: 'number',
          description: 'Raw total number of cases before duplicate aggregation'
        },
        rawCompletedCases: {
          type: 'number',
          description: 'Raw number of completed cases before duplicate aggregation'
        },
        rawCompletionPercentage: {
          type: 'number',
          description: 'Raw percentage of coding completion before duplicate aggregation'
        },
        aggregationActive: {
          type: 'boolean',
          description: 'Whether duplicate aggregation is active'
        },
        aggregationThreshold: {
          type: 'number',
          nullable: true,
          description: 'Current duplicate aggregation threshold'
        },
        aggregatedDuplicateCases: {
          type: 'number',
          description: 'Number of raw responses collapsed by duplicate aggregation'
        }
      }
    }
  })
  async getCodingProgressOverview(
    @WorkspaceId() workspace_id: number
  ): Promise<{
        totalCasesToCode: number;
        statusTotalCasesToCode: number;
        coveredSourceVariableCount: number;
        coveredSourceResponseCount: number;
        completedCases: number;
        completionPercentage: number;
        rawTotalCasesToCode: number;
        rawCompletedCases: number;
        rawCompletionPercentage: number;
        aggregationActive: boolean;
        aggregationThreshold: number | null;
        aggregatedDuplicateCases: number;
      }> {
    return this.codingProgressService.getCodingProgressOverview(workspace_id);
  }

  @Get(':workspace_id/coding/applied-results-overview')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiOkResponse({
    description: 'Applied results overview retrieved successfully.',
    schema: {
      type: 'object',
      properties: {
        totalIncompleteResponses: {
          type: 'number',
          description: 'Total cases after duplicate aggregation'
        },
        statusTotalIncompleteResponses: {
          type: 'number',
          description:
            'Raw status total before covered source variables are excluded'
        },
        coveredSourceVariableCount: {
          type: 'number',
          description:
            'Number of source variables represented by derived manual variables'
        },
        coveredSourceResponseCount: {
          type: 'number',
          description:
            'Number of source responses excluded because their derived variables are coded manually'
        },
        appliedResponses: {
          type: 'number',
          description: 'Applied result cases after duplicate aggregation'
        },
        remainingResponses: {
          type: 'number',
          description: 'Remaining result cases after duplicate aggregation'
        },
        completionPercentage: {
          type: 'number',
          description: 'Applied results completion percentage after duplicate aggregation'
        },
        rawTotalIncompleteResponses: {
          type: 'number',
          description: 'Raw total responses before duplicate aggregation'
        },
        rawAppliedResponses: {
          type: 'number',
          description: 'Raw applied responses before duplicate aggregation'
        },
        rawCompletionPercentage: {
          type: 'number',
          description: 'Raw applied results completion percentage before duplicate aggregation'
        },
        aggregationActive: {
          type: 'boolean',
          description: 'Whether duplicate aggregation is active'
        },
        aggregationThreshold: {
          type: 'number',
          nullable: true,
          description: 'Current duplicate aggregation threshold'
        },
        aggregatedDuplicateCases: {
          type: 'number',
          description: 'Number of raw responses collapsed by duplicate aggregation'
        },
        deriveErrorTotalResponses: {
          type: 'number',
          description: 'DERIVE_ERROR opt-in cases after duplicate aggregation'
        },
        deriveErrorAppliedResponses: {
          type: 'number',
          description: 'Applied DERIVE_ERROR opt-in cases after duplicate aggregation'
        },
        deriveErrorRemainingResponses: {
          type: 'number',
          description: 'Remaining DERIVE_ERROR opt-in cases after duplicate aggregation'
        },
        deriveErrorRawTotalResponses: {
          type: 'number',
          description: 'Raw DERIVE_ERROR opt-in responses before duplicate aggregation'
        },
        deriveErrorRawAppliedResponses: {
          type: 'number',
          description: 'Raw applied DERIVE_ERROR opt-in responses before duplicate aggregation'
        }
      }
    }
  })
  async getAppliedResultsOverview(
    @WorkspaceId() workspace_id: number
  ): Promise<{
        totalIncompleteResponses: number;
        statusTotalIncompleteResponses: number;
        coveredSourceVariableCount: number;
        coveredSourceResponseCount: number;
        appliedResponses: number;
        remainingResponses: number;
        completionPercentage: number;
        rawTotalIncompleteResponses: number;
        rawAppliedResponses: number;
        rawCompletionPercentage: number;
        aggregationActive: boolean;
        aggregationThreshold: number | null;
        aggregatedDuplicateCases: number;
        deriveErrorTotalResponses: number;
        deriveErrorAppliedResponses: number;
        deriveErrorRemainingResponses: number;
        deriveErrorRawTotalResponses: number;
        deriveErrorRawAppliedResponses: number;
      }> {
    return this.codingProgressService.getAppliedResultsOverview(workspace_id);
  }

  @Get(':workspace_id/coding/case-coverage-overview')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiOkResponse({
    description: 'Case coverage overview retrieved successfully.',
    schema: {
      type: 'object',
      properties: {
        totalCasesToCode: {
          type: 'number',
          description: 'Raw total number of cases that need to be coded'
        },
        statusTotalCasesToCode: {
          type: 'number',
          description:
            'Raw status total before covered source variables are excluded'
        },
        coveredSourceVariableCount: {
          type: 'number',
          description:
            'Number of source variables represented by derived manual variables'
        },
        coveredSourceResponseCount: {
          type: 'number',
          description:
            'Number of source responses excluded because their derived variables are coded manually'
        },
        effectiveTotalCasesToCode: {
          type: 'number',
          description: 'Total number of cases after duplicate aggregation is applied'
        },
        casesInJobs: {
          type: 'number',
          description: 'Number of cases assigned to coding jobs'
        },
        effectiveCasesInJobs: {
          type: 'number',
          description: 'Number of aggregation-adjusted cases covered by coding jobs'
        },
        doubleCodedCases: {
          type: 'number',
          description: 'Number of cases that are double-coded'
        },
        singleCodedCases: {
          type: 'number',
          description: 'Number of cases that are single-coded'
        },
        unassignedCases: {
          type: 'number',
          description: 'Raw number of cases not assigned to any coding job'
        },
        effectiveUnassignedCases: {
          type: 'number',
          description: 'Number of aggregation-adjusted cases not assigned to any coding job'
        },
        coveragePercentage: {
          type: 'number',
          description: 'Percentage of aggregation-adjusted cases covered by coding jobs'
        },
        rawCoveragePercentage: {
          type: 'number',
          description: 'Percentage of raw cases covered by coding jobs'
        },
        aggregationActive: {
          type: 'boolean',
          description: 'Whether duplicate aggregation is active for this workspace'
        },
        aggregationThreshold: {
          type: 'number',
          nullable: true,
          description: 'Duplicate aggregation threshold, or null when disabled'
        },
        aggregatedDuplicateCases: {
          type: 'number',
          description: 'Number of raw cases collapsed by duplicate aggregation'
        }
      }
    }
  })
  async getCaseCoverageOverview(@WorkspaceId() workspace_id: number): Promise<{
    totalCasesToCode: number;
    statusTotalCasesToCode: number;
    coveredSourceVariableCount: number;
    coveredSourceResponseCount: number;
    effectiveTotalCasesToCode: number;
    casesInJobs: number;
    effectiveCasesInJobs: number;
    doubleCodedCases: number;
    singleCodedCases: number;
    unassignedCases: number;
    effectiveUnassignedCases: number;
    coveragePercentage: number;
    rawCoveragePercentage: number;
    aggregationActive: boolean;
    aggregationThreshold: number | null;
    aggregatedDuplicateCases: number;
  }> {
    return this.codingProgressService.getCaseCoverageOverview(workspace_id);
  }

  @Get(':workspace_id/coding/variable-coverage-overview')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiOkResponse({
    description: 'Variable coverage overview retrieved successfully.',
    schema: {
      type: 'object',
      properties: {
        totalVariables: {
          type: 'number',
          description: 'Total number of potential variables from unit XML files'
        },
        statusTotalVariables: {
          type: 'number',
          description:
            'Raw status variable total before covered source variables are excluded'
        },
        coveredSourceVariableCount: {
          type: 'number',
          description:
            'Number of source variables represented by derived manual variables'
        },
        coveredSourceResponseCount: {
          type: 'number',
          description:
            'Number of source responses excluded because their derived variables are coded manually'
        },
        coveredVariables: {
          type: 'number',
          description: 'Total number of variables covered by job definitions'
        },
        coveredByDraft: {
          type: 'number',
          description: 'Number of variables covered by draft job definitions'
        },
        coveredByPendingReview: {
          type: 'number',
          description:
            'Number of variables covered by pending review job definitions'
        },
        coveredByApproved: {
          type: 'number',
          description: 'Number of variables covered by approved job definitions'
        },
        conflictedVariables: {
          type: 'number',
          description:
            'Number of variables assigned to multiple job definitions'
        },
        missingVariables: {
          type: 'number',
          description: 'Number of variables not covered by job definitions'
        },
        partiallyAbgedeckteVariablen: {
          type: 'number',
          description: 'Number of variables with partial case coverage'
        },
        fullyAbgedeckteVariablen: {
          type: 'number',
          description: 'Number of variables with full case coverage'
        },
        coveragePercentage: {
          type: 'number',
          description: 'Percentage of variables covered by job definitions'
        },
        variableCaseCounts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              unitName: { type: 'string', description: 'Unit name' },
              variableId: { type: 'string', description: 'Variable ID' },
              caseCount: {
                type: 'number',
                description: 'Number of coding cases for this variable'
              }
            }
          },
          description: 'List of all variables with their case counts'
        },
        coverageByStatus: {
          type: 'object',
          properties: {
            draft: {
              type: 'array',
              items: { type: 'string' },
              description: 'Variables covered by draft definitions'
            },
            pending_review: {
              type: 'array',
              items: { type: 'string' },
              description: 'Variables covered by pending review definitions'
            },
            approved: {
              type: 'array',
              items: { type: 'string' },
              description: 'Variables covered by approved definitions'
            },
            conflicted: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  variableKey: {
                    type: 'string',
                    description: 'Variable key in format unitName:variableId'
                  },
                  conflictingDefinitions: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id: {
                          type: 'number',
                          description: 'Job definition ID'
                        },
                        status: {
                          type: 'string',
                          description: 'Job definition status'
                        }
                      }
                    }
                  }
                }
              },
              description:
                'Variables assigned to multiple definitions with conflict details'
            }
          },
          description: 'Coverage breakdown by job definition status'
        }
      }
    }
  })
  async getVariableCoverageOverview(
    @WorkspaceId() workspace_id: number
  ): Promise<{
        totalVariables: number;
        statusTotalVariables: number;
        coveredSourceVariableCount: number;
        coveredSourceResponseCount: number;
        coveredVariables: number;
        coveredByDraft: number;
        coveredByPendingReview: number;
        coveredByApproved: number;
        conflictedVariables: number;
        missingVariables: number;
        partiallyAbgedeckteVariablen: number;
        fullyAbgedeckteVariablen: number;
        coveragePercentage: number;
        variableCaseCounts: {
          unitName: string;
          variableId: string;
          caseCount: number;
        }[];
        coverageByStatus: {
          draft: string[];
          pending_review: string[];
          approved: string[];
          conflicted: Array<{
            variableKey: string;
            conflictingDefinitions: Array<{
              id: number;
              status: string;
            }>;
          }>;
        };
      }> {
    return this.codingProgressService.getVariableCoverageOverview(
      workspace_id
    );
  }

  @Get(':workspace_id/coding/cohens-kappa')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiQuery({
    name: 'weightedMean',
    required: false,
    description: 'Use weighted mean (default: true, matching R eatPrep implementation)',
    type: Boolean
  })
  @ApiQuery({
    name: 'unitName',
    required: false,
    description: 'Filter by unit name',
    type: String
  })
  @ApiQuery({
    name: 'variableId',
    required: false,
    description: 'Filter by variable ID',
    type: String
  })
  @ApiQuery({
    name: 'excludeTrainings',
    required: false,
    description: 'Exclude coder training jobs (default: true)',
    type: Boolean
  })
  @ApiQuery({
    name: 'jobDefinitionIds',
    required: false,
    description: 'Limit statistics to one or more job definition IDs (comma-separated or repeated query parameters)',
    type: String
  })
  @ApiQuery({
    name: 'coderTrainingIds',
    required: false,
    description: 'Limit statistics to one or more coder training IDs (comma-separated or repeated query parameters)',
    type: String
  })
  @ApiQuery({
    name: 'coderIds',
    required: false,
    description: 'Limit statistics to one or more coder IDs (comma-separated or repeated query parameters)',
    type: String
  })
  @ApiOkResponse({
    description:
      "Cohen's Kappa statistics for double-coded variables with workspace summary.",
    schema: {
      type: 'object',
      properties: {
        variables: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              unitName: { type: 'string', description: 'Name of the unit' },
              variableId: { type: 'string', description: 'Variable ID' },
              meanKappa: {
                type: 'number',
                nullable: true,
                description: "Mean Cohen's Kappa for this variable, using the selected weighting method"
              },
              meanAgreement: {
                type: 'number',
                nullable: true,
                description: 'Mean observed agreement for this variable, using the selected weighting method'
              },
              caseCount: {
                type: 'number',
                description: 'Total coded cases for this variable'
              },
              doubleCodedCount: {
                type: 'number',
                description: 'Number of double-coded cases for this variable'
              },
              doubleCodedRate: {
                type: 'number',
                nullable: true,
                description: 'Share of coded cases that are double-coded'
              },
              validPairCount: {
                type: 'number',
                description: 'Total number of valid coder-pair comparisons for this variable'
              },
              coderPairCount: {
                type: 'number',
                description: 'Number of coder pairs with valid comparisons for this variable'
              },
              coderPairs: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    coder1Id: { type: 'number' },
                    coder1Name: { type: 'string' },
                    coder2Id: { type: 'number' },
                    coder2Name: { type: 'string' },
                    kappa: { type: 'number', nullable: true },
                    agreement: { type: 'number' },
                    totalItems: { type: 'number' },
                    validPairs: { type: 'number' },
                    interpretation: { type: 'string' },
                    jobNames: {
                      type: 'array',
                      items: { type: 'string' }
                    },
                    jobDefinitionIds: {
                      type: 'array',
                      items: { type: 'number' }
                    },
                    trainingIds: {
                      type: 'array',
                      items: { type: 'number' }
                    },
                    trainingLabels: {
                      type: 'array',
                      items: { type: 'string' }
                    }
                  }
                }
              }
            }
          }
        },
        workspaceSummary: {
          type: 'object',
          properties: {
            totalCodedResponses: { type: 'number' },
            totalDoubleCodedResponses: { type: 'number' },
            totalCoderPairs: { type: 'number' },
            averageKappa: { type: 'number', nullable: true },
            meanAgreement: { type: 'number', nullable: true },
            variablesIncluded: { type: 'number' },
            codersIncluded: { type: 'number' },
            weightingMethod: {
              type: 'string',
              enum: ['weighted', 'unweighted'],
              description: 'Method used to calculate mean kappa'
            }
          }
        }
      }
    }
  })
  async getCohensKappaStatistics(
    @WorkspaceId() workspace_id: number,
      @Query('weightedMean') weightedMean?: string,
      @Query('unitName') unitName?: string,
      @Query('variableId') variableId?: string,
      @Query('excludeTrainings') excludeTrainings?: string,
      @Query('jobDefinitionIds') jobDefinitionIds?: string | string[],
      @Query('coderTrainingIds') coderTrainingIds?: string | string[],
      @Query('coderIds') coderIds?: string | string[]
  ): Promise<KappaStatisticsResponse> {
    try {
      const options = this.buildKappaOptionsFromQuery({
        weightedMean,
        excludeTrainings,
        unitName,
        variableId,
        jobDefinitionIds,
        coderTrainingIds,
        coderIds
      });
      const statistics = await this.buildCohensKappaStatistics(workspace_id, options);
      return this.toPublicCohensKappaStatistics(statistics);
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(
        `Error calculating Cohen's Kappa: ${error.message}`,
        error.stack
      );
      throw new Error(
        "Could not calculate Cohen's Kappa statistics. Please check the database connection."
      );
    }
  }

  @Get(':workspace_id/coding/cohens-kappa/export/csv')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiQuery({
    name: 'weightedMean',
    required: false,
    description: 'Use weighted mean (default: true, matching R eatPrep implementation)',
    type: Boolean
  })
  @ApiQuery({
    name: 'unitName',
    required: false,
    description: 'Filter by unit name',
    type: String
  })
  @ApiQuery({
    name: 'variableId',
    required: false,
    description: 'Filter by variable ID',
    type: String
  })
  @ApiQuery({
    name: 'excludeTrainings',
    required: false,
    description: 'Exclude coder training jobs (default: true)',
    type: Boolean
  })
  @ApiQuery({
    name: 'jobDefinitionIds',
    required: false,
    description: 'Limit export to one or more job definition IDs (comma-separated or repeated query parameters)',
    type: String
  })
  @ApiQuery({
    name: 'coderTrainingIds',
    required: false,
    description: 'Limit export to one or more coder training IDs (comma-separated or repeated query parameters)',
    type: String
  })
  @ApiQuery({
    name: 'coderIds',
    required: false,
    description: 'Limit export to one or more coder IDs (comma-separated or repeated query parameters)',
    type: String
  })
  @ApiOkResponse({
    description: "Cohen's Kappa coder-pair details exported as CSV.",
    content: {
      'text/csv': {
        schema: {
          type: 'string',
          format: 'binary'
        }
      }
    }
  })
  async exportCohensKappaStatisticsAsCsv(
    @WorkspaceId() workspace_id: number,
      @Query('weightedMean') weightedMean: string | undefined,
      @Query('unitName') unitName: string | undefined,
      @Query('variableId') variableId: string | undefined,
      @Query('excludeTrainings') excludeTrainings: string | undefined,
      @Query('jobDefinitionIds') jobDefinitionIds: string | string[] | undefined,
      @Query('coderTrainingIds') coderTrainingIds: string | string[] | undefined,
      @Query('coderIds') coderIds: string | string[] | undefined,
      @Res() res: Response
  ): Promise<void> {
    try {
      const options = this.buildKappaOptionsFromQuery({
        weightedMean,
        excludeTrainings,
        unitName,
        variableId,
        jobDefinitionIds,
        coderTrainingIds,
        coderIds
      });
      const statistics = await this.buildCohensKappaStatistics(workspace_id, options);
      const rows = this.createCohensKappaExportRows(statistics, options);
      const csvContent = await fastCsv.writeToString(rows, {
        headers: [...COHENS_KAPPA_EXPORT_HEADERS],
        alwaysWriteHeaders: true,
        delimiter: ';',
        quote: '"'
      });
      const exportDate = new Date().toISOString().slice(0, 10);

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="cohens-kappa-details-${workspace_id}-${exportDate}.csv"`
      );
      res.send(`\uFEFF${csvContent}`);
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(
        `Error exporting Cohen's Kappa CSV: ${error.message}`,
        error.stack
      );
      throw new Error(
        "Could not export Cohen's Kappa statistics. Please check the database connection."
      );
    }
  }

  @Get(':workspace_id/coding/cohens-kappa/export/summary/csv')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiQuery({
    name: 'weightedMean',
    required: false,
    description: 'Use weighted mean (default: true, matching R eatPrep implementation)',
    type: Boolean
  })
  @ApiQuery({
    name: 'unitName',
    required: false,
    description: 'Filter by unit name',
    type: String
  })
  @ApiQuery({
    name: 'variableId',
    required: false,
    description: 'Filter by variable ID',
    type: String
  })
  @ApiQuery({
    name: 'excludeTrainings',
    required: false,
    description: 'Exclude coder training jobs (default: true)',
    type: Boolean
  })
  @ApiQuery({
    name: 'jobDefinitionIds',
    required: false,
    description: 'Limit export to one or more job definition IDs (comma-separated or repeated query parameters)',
    type: String
  })
  @ApiQuery({
    name: 'coderTrainingIds',
    required: false,
    description: 'Limit export to one or more coder training IDs (comma-separated or repeated query parameters)',
    type: String
  })
  @ApiQuery({
    name: 'coderIds',
    required: false,
    description: 'Limit export to one or more coder IDs (comma-separated or repeated query parameters)',
    type: String
  })
  @ApiOkResponse({
    description: "Cohen's Kappa variable summary exported as CSV.",
    content: {
      'text/csv': {
        schema: {
          type: 'string',
          format: 'binary'
        }
      }
    }
  })
  async exportCohensKappaSummaryAsCsv(
    @WorkspaceId() workspace_id: number,
      @Query('weightedMean') weightedMean: string | undefined,
      @Query('unitName') unitName: string | undefined,
      @Query('variableId') variableId: string | undefined,
      @Query('excludeTrainings') excludeTrainings: string | undefined,
      @Query('jobDefinitionIds') jobDefinitionIds: string | string[] | undefined,
      @Query('coderTrainingIds') coderTrainingIds: string | string[] | undefined,
      @Query('coderIds') coderIds: string | string[] | undefined,
      @Res() res: Response
  ): Promise<void> {
    try {
      const options = this.buildKappaOptionsFromQuery({
        weightedMean,
        excludeTrainings,
        unitName,
        variableId,
        jobDefinitionIds,
        coderTrainingIds,
        coderIds
      });
      const statistics = await this.buildCohensKappaStatistics(workspace_id, options);
      const csvContent = await fastCsv.writeToString(
        this.createCohensKappaSummaryExportRows(statistics),
        {
          headers: [...COHENS_KAPPA_SUMMARY_EXPORT_HEADERS],
          alwaysWriteHeaders: true,
          delimiter: ';',
          quote: '"'
        }
      );
      const exportDate = new Date().toISOString().slice(0, 10);

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="cohens-kappa-summary-${workspace_id}-${exportDate}.csv"`
      );
      res.send(`\uFEFF${csvContent}`);
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(
        `Error exporting Cohen's Kappa summary CSV: ${error.message}`,
        error.stack
      );
      throw new Error(
        "Could not export Cohen's Kappa summary. Please check the database connection."
      );
    }
  }

  @Get(':workspace_id/coding/cohens-kappa/export/xlsx')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiQuery({
    name: 'weightedMean',
    required: false,
    description: 'Use weighted mean (default: true, matching R eatPrep implementation)',
    type: Boolean
  })
  @ApiQuery({
    name: 'unitName',
    required: false,
    description: 'Filter by unit name',
    type: String
  })
  @ApiQuery({
    name: 'variableId',
    required: false,
    description: 'Filter by variable ID',
    type: String
  })
  @ApiQuery({
    name: 'excludeTrainings',
    required: false,
    description: 'Exclude coder training jobs (default: true)',
    type: Boolean
  })
  @ApiQuery({
    name: 'jobDefinitionIds',
    required: false,
    description: 'Limit export to one or more job definition IDs (comma-separated or repeated query parameters)',
    type: String
  })
  @ApiQuery({
    name: 'coderTrainingIds',
    required: false,
    description: 'Limit export to one or more coder training IDs (comma-separated or repeated query parameters)',
    type: String
  })
  @ApiQuery({
    name: 'coderIds',
    required: false,
    description: 'Limit export to one or more coder IDs (comma-separated or repeated query parameters)',
    type: String
  })
  @ApiOkResponse({
    description:
      "Cohen's Kappa workbook exported as XLSX with summary, pairwise details and coding results sheets.",
    content: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
        schema: {
          type: 'string',
          format: 'binary'
        }
      }
    }
  })
  async exportCohensKappaStatisticsAsXlsx(
    @WorkspaceId() workspace_id: number,
      @Query('weightedMean') weightedMean: string | undefined,
      @Query('unitName') unitName: string | undefined,
      @Query('variableId') variableId: string | undefined,
      @Query('excludeTrainings') excludeTrainings: string | undefined,
      @Query('jobDefinitionIds') jobDefinitionIds: string | string[] | undefined,
      @Query('coderTrainingIds') coderTrainingIds: string | string[] | undefined,
      @Query('coderIds') coderIds: string | string[] | undefined,
      @Res() res: Response
  ): Promise<void> {
    try {
      const options = this.buildKappaOptionsFromQuery({
        weightedMean,
        excludeTrainings,
        unitName,
        variableId,
        jobDefinitionIds,
        coderTrainingIds,
        coderIds
      });
      const statistics = await this.buildCohensKappaStatistics(workspace_id, options);
      const buffer = await this.createCohensKappaWorkbookBuffer(
        statistics,
        statistics.sourceItems
      );
      const exportDate = new Date().toISOString().slice(0, 10);

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="cohens-kappa-${workspace_id}-${exportDate}.xlsx"`
      );
      res.send(buffer);
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(
        `Error exporting Cohen's Kappa XLSX: ${error.message}`,
        error.stack
      );
      throw new Error(
        "Could not export Cohen's Kappa workbook. Please check the database connection."
      );
    }
  }

  @Get(':workspace_id/coding/cohens-kappa/workspace-summary')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiQuery({
    name: 'weightedMean',
    required: false,
    description: 'Use weighted mean (default: true, matching R eatPrep implementation)',
    type: Boolean
  })
  @ApiQuery({
    name: 'excludeTrainings',
    required: false,
    description: 'Exclude coder training jobs (default: true)',
    type: Boolean
  })
  @ApiQuery({
    name: 'jobDefinitionIds',
    required: false,
    description: 'Limit statistics to one or more job definition IDs (comma-separated or repeated query parameters)',
    type: String
  })
  @ApiQuery({
    name: 'coderTrainingIds',
    required: false,
    description: 'Limit statistics to one or more coder training IDs (comma-separated or repeated query parameters)',
    type: String
  })
  @ApiQuery({
    name: 'coderIds',
    required: false,
    description: 'Limit statistics to one or more coder IDs (comma-separated or repeated query parameters)',
    type: String
  })
  @ApiOkResponse({
    description:
      "Workspace-wide Cohen's Kappa statistics for double-coded incomplete variables.",
    schema: {
      type: 'object',
      properties: {
        coderPairs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              coder1Id: { type: 'number', description: 'First coder ID' },
              coder1Name: { type: 'string', description: 'First coder name' },
              coder2Id: { type: 'number', description: 'Second coder ID' },
              coder2Name: { type: 'string', description: 'Second coder name' },
              kappa: {
                type: 'number',
                nullable: true,
                description: "Cohen's Kappa coefficient"
              },
              agreement: {
                type: 'number',
                description: 'Observed agreement percentage'
              },
              totalSharedResponses: {
                type: 'number',
                description: 'Total responses coded by both coders'
              },
              validPairs: {
                type: 'number',
                description: 'Number of valid coding pairs'
              },
              interpretation: {
                type: 'string',
                description: 'Interpretation of the Kappa value'
              }
            }
          },
          description:
            "Cohen's Kappa statistics for each coder pair across all double-coded work"
        },
        workspaceSummary: {
          type: 'object',
          properties: {
            totalDoubleCodedResponses: {
              type: 'number',
              description: 'Total number of double-coded responses'
            },
            totalCoderPairs: {
              type: 'number',
              description: 'Total number of coder pairs analyzed'
            },
            averageKappa: {
              type: 'number',
              nullable: true,
              description: "Average Cohen's Kappa across all coder pairs"
            },
            variablesIncluded: {
              type: 'number',
              description: 'Number of variables included in the analysis'
            },
            codersIncluded: {
              type: 'number',
              description: 'Number of coders included in the analysis'
            },
            weightingMethod: {
              type: 'string',
              enum: ['weighted', 'unweighted'],
              description: 'Method used to calculate mean kappa'
            }
          },
          description: 'Summary statistics for the entire workspace'
        }
      }
    }
  })
  async getWorkspaceCohensKappaSummary(
    @WorkspaceId() workspace_id: number,
      @Query('weightedMean') weightedMean?: string,
      @Query('excludeTrainings') excludeTrainings?: string,
      @Query('jobDefinitionIds') jobDefinitionIds?: string | string[],
      @Query('coderTrainingIds') coderTrainingIds?: string | string[],
      @Query('coderIds') coderIds?: string | string[]
  ): Promise<{
        coderPairs: Array<{
          coder1Id: number;
          coder1Name: string;
          coder2Id: number;
          coder2Name: string;
          kappa: number | null;
          agreement: number;
          totalSharedResponses: number;
          validPairs: number;
          interpretation: string;
        }>;
        workspaceSummary: {
          totalDoubleCodedResponses: number;
          totalCoderPairs: number;
          averageKappa: number | null;
          variablesIncluded: number;
          codersIncluded: number;
          weightingMethod: 'weighted' | 'unweighted';
        };
      }> {
    const options = this.buildKappaOptionsFromQuery({
      weightedMean,
      excludeTrainings,
      jobDefinitionIds,
      coderTrainingIds,
      coderIds
    });
    return this.codingReviewService.getWorkspaceCohensKappaSummary(
      workspace_id,
      options.weightedMean,
      options.excludeTrainings,
      options.jobDefinitionIds,
      options.coderTrainingIds,
      options.coderIds
    );
  }

  @Post(':workspace_id/coding/calculate-distribution')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiBody({
    description: 'Calculate distribution for coding jobs (preview mode)',
    schema: {
      type: 'object',
      properties: {
        selectedVariables: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              unitName: { type: 'string' },
              variableId: { type: 'string' },
              includeDeriveError: { type: 'boolean' }
            }
          }
        },
        selectedVariableBundles: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'number' },
              name: { type: 'string' },
              caseOrderingMode: { type: 'string', enum: ['continuous', 'alternating'] },
              variables: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    unitName: { type: 'string' },
                    variableId: { type: 'string' },
                    includeDeriveError: { type: 'boolean' }
                  }
                }
              }
            }
          }
        },
        selectedCoders: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'number' },
              name: { type: 'string' },
              username: { type: 'string' },
              weight: { type: 'number' },
              capacityPercent: { type: 'number' }
            }
          }
        },
        doubleCodingAbsolute: { type: 'number' },
        doubleCodingPercentage: { type: 'number' },
        distributionSeed: { type: 'string' }
      },
      required: ['selectedVariables', 'selectedCoders']
    }
  })
  @ApiOkResponse({
    description: 'Distribution calculated successfully.',
    schema: {
      type: 'object',
      properties: {
        distribution: {
          type: 'object',
          description: 'Case distribution matrix',
          additionalProperties: {
            type: 'object',
            additionalProperties: { type: 'number' }
          }
        },
        distributionByCoderId: {
          type: 'object',
          description: 'Case distribution matrix keyed by coder ID',
          additionalProperties: {
            type: 'object',
            additionalProperties: { type: 'number' }
          }
        },
        doubleCodingInfo: {
          type: 'object',
          description: 'Double coding information',
          additionalProperties: {
            type: 'object',
            properties: {
              totalCases: { type: 'number' },
              distinctCases: { type: 'number' },
              codingTasksTotal: { type: 'number' },
              doubleCodedCases: { type: 'number' },
              singleCodedCasesAssigned: { type: 'number' },
              doubleCodedCasesPerCoder: {
                type: 'object',
                additionalProperties: { type: 'number' }
              },
              doubleCodedCasesPerCoderId: {
                type: 'object',
                additionalProperties: { type: 'number' }
              }
            }
          }
        },
        aggregationInfo: {
          type: 'object',
          additionalProperties: {
            type: 'object',
            properties: {
              uniqueCases: { type: 'number' },
              totalResponses: { type: 'number' }
            }
          }
        },
        matchingFlags: {
          type: 'array',
          items: { type: 'string' }
        },
        warnings: {
          type: 'array',
          items: { type: 'object' }
        },
        pairDistribution: {
          type: 'object',
          additionalProperties: { type: 'number' }
        },
        tasksPerCoder: {
          type: 'object',
          additionalProperties: { type: 'number' }
        },
        coderWeights: {
          type: 'object',
          additionalProperties: { type: 'number' }
        }
      }
    }
  })
  async calculateDistribution(
    @WorkspaceId() workspace_id: number,
      @Body()
                   body: {
                     selectedVariables: { unitName: string; variableId: string; includeDeriveError?: boolean }[];
                     selectedVariableBundles?: {
                       id: number;
                       name: string;
                       caseOrderingMode?: 'continuous' | 'alternating';
                       variables: { unitName: string; variableId: string; includeDeriveError?: boolean }[];
                     }[];
                     selectedCoders: {
                       id: number;
                       name: string;
                       username: string;
                       weight?: number;
                       capacityPercent?: number;
                     }[];
                     doubleCodingAbsolute?: number;
                     doubleCodingPercentage?: number;
                     caseOrderingMode?: 'continuous' | 'alternating';
                     maxCodingCases?: number;
                     distributionSeed?: string | number;
                   }
  ): Promise<DistributionCalculationResponse> {
    return this.codingJobService.calculateDistribution(workspace_id, body);
  }

  @Post(':workspace_id/coding/create-distributed-jobs')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiBody({
    description: 'Create distributed coding jobs with equal case distribution',
    schema: {
      type: 'object',
      properties: {
        selectedVariables: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              unitName: { type: 'string' },
              variableId: { type: 'string' },
              includeDeriveError: { type: 'boolean' }
            }
          }
        },
        selectedVariableBundles: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'number' },
              name: { type: 'string' },
              caseOrderingMode: { type: 'string', enum: ['continuous', 'alternating'] },
              variables: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    unitName: { type: 'string' },
                    variableId: { type: 'string' },
                    includeDeriveError: { type: 'boolean' }
                  }
                }
              }
            }
          }
        },
        selectedCoders: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'number' },
              name: { type: 'string' },
              username: { type: 'string' },
              weight: { type: 'number' },
              capacityPercent: { type: 'number' }
            }
          }
        },
        doubleCodingAbsolute: { type: 'number' },
        doubleCodingPercentage: { type: 'number' },
        distributionSeed: { type: 'string' },
        showScore: { type: 'boolean' },
        allowComments: { type: 'boolean' },
        suppressGeneralInstructions: { type: 'boolean' }
      },
      required: ['selectedVariables', 'selectedCoders']
    }
  })
  @ApiOkResponse({
    description: 'Distributed coding jobs created successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        jobsCreated: { type: 'number' },
        message: { type: 'string' },
        distribution: {
          type: 'object',
          description: 'Case distribution matrix',
          additionalProperties: {
            type: 'object',
            additionalProperties: { type: 'number' }
          }
        },
        distributionByCoderId: {
          type: 'object',
          description: 'Case distribution matrix keyed by coder ID',
          additionalProperties: {
            type: 'object',
            additionalProperties: { type: 'number' }
          }
        },
        doubleCodingInfo: {
          type: 'object',
          description: 'Double coding information',
          additionalProperties: {
            type: 'object',
            properties: {
              totalCases: { type: 'number' },
              distinctCases: { type: 'number' },
              codingTasksTotal: { type: 'number' },
              doubleCodedCases: { type: 'number' },
              singleCodedCasesAssigned: { type: 'number' },
              doubleCodedCasesPerCoder: {
                type: 'object',
                additionalProperties: { type: 'number' }
              },
              doubleCodedCasesPerCoderId: {
                type: 'object',
                additionalProperties: { type: 'number' }
              }
            }
          }
        },
        aggregationInfo: {
          type: 'object',
          additionalProperties: {
            type: 'object',
            properties: {
              uniqueCases: { type: 'number' },
              totalResponses: { type: 'number' }
            }
          }
        },
        matchingFlags: {
          type: 'array',
          items: { type: 'string' }
        },
        warnings: {
          type: 'array',
          items: { type: 'object' }
        },
        pairDistribution: {
          type: 'object',
          additionalProperties: { type: 'number' }
        },
        tasksPerCoder: {
          type: 'object',
          additionalProperties: { type: 'number' }
        },
        coderWeights: {
          type: 'object',
          additionalProperties: { type: 'number' }
        },
        jobs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              itemKey: { type: 'string' },
              coderId: { type: 'number' },
              coderName: { type: 'string' },
              variable: {
                type: 'object',
                properties: {
                  unitName: { type: 'string' },
                  variableId: { type: 'string' }
                }
              },
              jobId: { type: 'number' },
              jobName: { type: 'string' },
              caseCount: { type: 'number' }
            }
          }
        }
      }
    }
  })
  async createDistributedCodingJobs(
    @WorkspaceId() workspace_id: number,
      @Body()
                   body: {
                     selectedVariables: { unitName: string; variableId: string; includeDeriveError?: boolean }[];
                     selectedVariableBundles?: {
                       id: number;
                       name: string;
                       caseOrderingMode?: 'continuous' | 'alternating';
                       variables: { unitName: string; variableId: string; includeDeriveError?: boolean }[];
                     }[];
                     selectedCoders: {
                       id: number;
                       name: string;
                       username: string;
                       weight?: number;
                       capacityPercent?: number;
                     }[];
                     doubleCodingAbsolute?: number;
                     doubleCodingPercentage?: number;
                     caseOrderingMode?: 'continuous' | 'alternating';
                     maxCodingCases?: number;
                     distributionSeed?: string | number;
                     showScore?: boolean;
                     allowComments?: boolean;
                     suppressGeneralInstructions?: boolean;
                   }
  ): Promise<DistributedCodingJobsResponse> {
    if (!body) {
      throw new BadRequestException('Request body is required');
    }

    if (Object.prototype.hasOwnProperty.call(body, 'jobDefinitionId')) {
      throw new BadRequestException(
        'Use the job definition endpoint to create coding jobs from a job definition'
      );
    }

    return this.codingJobService.createDistributedCodingJobs(workspace_id, body);
  }
}
