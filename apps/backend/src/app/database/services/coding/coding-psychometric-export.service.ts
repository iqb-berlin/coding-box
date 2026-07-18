import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import * as ExcelJS from 'exceljs';
import * as fastCsv from 'fast-csv';
import * as fs from 'fs';
import { PassThrough } from 'stream';
import {
  DataSource,
  EntityManager,
  ILike,
  Repository,
  SelectQueryBuilder
} from 'typeorm';
import {
  PsychometricDomainCandidatesDto,
  PsychometricDomainFieldSelection,
  PsychometricDomainSelection,
  PsychometricExportOptions,
  PsychometricVersion
} from '../../../../../../../api-dto/coding/psychometric-discrimination.dto';
import FileUpload from '../../entities/file_upload.entity';
import { ResponseEntity } from '../../entities/response.entity';
import { VariableDetailDto } from '../../../models/unit-variable-details.dto';
import { mapCodeForExport } from '../../../utils/coding-utils';
import { sanitizeCsvText } from '../../../utils/csv.util';
import { STATISTICS_IGNORED_STATUSES } from '../../utils/response-status-converter';
import {
  applyResolvedExclusionsToQuery,
  ResolvedWorkspaceExclusions,
  WorkspaceExclusionService
} from '../workspace/workspace-exclusion.service';
import { WorkspaceFilesService } from '../workspace/workspace-files.service';
import { MissingsProfilesService } from './missings-profiles.service';
import {
  CorrelationAccumulator,
  CorrelationStatus,
  addCorrelationPair,
  calculateCorrelation,
  createCorrelationAccumulator
} from './psychometric-statistics.util';

type PsychometricMetricType = 'SCORE' | 'CODE' | 'CATEGORY';
type MetadataScope = 'UNIT' | 'ITEM';

interface LanguageCodedText {
  lang?: string;
  value?: string;
}

interface StoredVocabularyEntry {
  id?: string;
  label?: LanguageCodedText[];
}

interface StoredSimpleValue {
  raw?: unknown;
  asText?: LanguageCodedText[];
}

interface StoredMetadataValue {
  id?: string;
  label?: LanguageCodedText[];
  value?: unknown;
}

interface StoredMetadataProfile {
  profileId?: string;
  isCurrent?: boolean;
  entries?: StoredMetadataValue[];
}

interface StoredMetadataItem {
  id?: string;
  uuid?: string;
  variableId?: string | null;
  description?: string | null;
  profiles?: StoredMetadataProfile[];
}

interface StoredVomd {
  profiles?: StoredMetadataProfile[];
  items?: StoredMetadataItem[];
}

interface VomdDocument {
  fileName: string;
  unitKey: string;
  profiles: StoredMetadataProfile[];
  items: StoredMetadataItem[];
}

interface MetadataScalarValue {
  id: string;
  label: string;
}

interface MappedItem {
  key: string;
  unitName: string;
  variableId: string;
  sourceVariableId: string;
  itemId: string;
  itemLabel: string;
  variable: VariableDetailDto;
  vomd: VomdDocument;
  vomdItem: StoredMetadataItem;
  domain?: MetadataScalarValue;
  codeDefinitions: Map<number, MetricDefinition>;
  categories: Map<string, MetricDefinition>;
  scoreAccumulator: CorrelationAccumulator;
  codeAccumulators: Map<number, CorrelationAccumulator>;
  categoryAccumulators: Map<string, CorrelationAccumulator>;
  categoryLimitExceeded: boolean;
}

interface ItemMappingContext {
  items: MappedItem[];
  byLogicalKey: Map<string, MappedItem>;
  issues: string[];
}

interface MetricDefinition {
  value: string;
  label: string;
  score?: number;
  source: 'VOCS' | 'MISSING_PROFILE' | 'OBSERVED' | 'UNIT_DEFINITION';
}

interface MissingDefinition {
  id: string;
  code: number;
  score: number | null;
  label: string;
}

interface RawResponseRow {
  responseId: number | string;
  personId: number | string;
  unitName: string;
  variableId: string;
  value: string | null;
  codeV1: number | string | null;
  scoreV1: number | string | null;
  codeV2: number | string | null;
  scoreV2: number | string | null;
  codeV3: number | string | null;
  scoreV3: number | string | null;
}

interface VersionedResponseValue {
  code: number | null;
  score: number | null;
}

interface DomainAggregate {
  sum: number;
  count: number;
}

interface PsychometricMetricRow {
  type: PsychometricMetricType;
  domain: string;
  domainLabel: string;
  unit: string;
  item: string;
  variable: string;
  itemLabel: string;
  code: string;
  category: string;
  label: string;
  score: number | '';
  source: string;
  n: number;
  positiveN: number | '';
  positiveShare: number | '';
  correlation: number | '';
  status: CorrelationStatus | 'TOO_MANY_CATEGORIES';
  note: string;
}

interface PsychometricAnalysis {
  rows: PsychometricMetricRow[];
  summary: Array<{ key: string; value: string | number | boolean }>;
}

export interface PsychometricExportServiceOptions extends PsychometricExportOptions {
  workspaceId: number;
  onProgress?: (
    percentage: number,
    details?: { processedRows?: number; totalRows?: number }
  ) => Promise<void>;
  checkCancellation?: () => Promise<void>;
}

type NormalizedPsychometricExportServiceOptions = Required<
Pick<
PsychometricExportServiceOptions,
| 'workspaceId'
| 'version'
| 'partWholeCorrection'
| 'domain'
| 'maxCategoryCount'
>
> &
PsychometricExportServiceOptions;

interface ResponseAnalysisSummary {
  duplicatePersonIds: Set<number>;
  totalRows: number;
  includedPersonIds: Set<number>;
  includedResponseCount: number;
}

@Injectable()
export class CodingPsychometricExportService {
  private readonly logger = new Logger(CodingPsychometricExportService.name);
  private readonly responseBatchSize = 5000;
  private readonly emptyCategoryValue = '___EMPTY___';

  constructor(
    @InjectRepository(FileUpload)
    private readonly fileUploadRepository: Repository<FileUpload>,
    private readonly workspaceFilesService: WorkspaceFilesService,
    private readonly workspaceExclusionService: WorkspaceExclusionService,
    private readonly missingsProfilesService: MissingsProfilesService,
    @InjectDataSource()
    private readonly connection: DataSource
  ) {}

  async getDomainCandidates(
    workspaceId: number
  ): Promise<PsychometricDomainCandidatesDto> {
    const mapping = await this.buildItemMappingContext(workspaceId);
    const itemCount = mapping.items.length;
    const mappingIssueCount = mapping.issues.length;
    const candidates = new Map<
    string,
    {
      scope: MetadataScope;
      profileId: string;
      entryId: string;
      label: string;
      valuesByItem: Map<string, MetadataScalarValue[]>;
    }
    >();

    mapping.items.forEach(item => {
      this.addCandidateEntries(candidates, item, 'UNIT', item.vomd.profiles);
      this.addCandidateEntries(
        candidates,
        item,
        'ITEM',
        item.vomdItem.profiles || []
      );
    });

    const domainCandidates = Array.from(candidates.values())
      .map(candidate => {
        const values = mapping.items.map(
          item => candidate.valuesByItem.get(item.key) || []
        );
        const coverage = values.filter(
          itemValues => itemValues.length > 0
        ).length;
        const singleValued = values.every(
          itemValues => itemValues.length <= 1
        );

        return {
          scope: candidate.scope,
          profileId: candidate.profileId,
          entryId: candidate.entryId,
          label: candidate.label,
          coverage,
          itemCount,
          singleValued,
          selectable:
            itemCount > 0 &&
            coverage === itemCount &&
            singleValued &&
            mappingIssueCount === 0
        };
      })
      .sort(
        (left, right) => left.scope.localeCompare(right.scope) ||
          left.label.localeCompare(right.label, 'de', {
            numeric: true,
            sensitivity: 'base'
          })
      );

    return {
      candidates: domainCandidates,
      mappingIssueCount
    };
  }

  async exportPsychometricsAsCsv(
    options: PsychometricExportServiceOptions
  ): Promise<NodeJS.ReadableStream> {
    const output = new PassThrough();
    this.writePsychometricsCsv(output, options).catch(error => {
      output.destroy(error instanceof Error ? error : new Error(String(error)));
    });
    return output;
  }

  private async writePsychometricsCsv(
    output: PassThrough,
    options: PsychometricExportServiceOptions
  ): Promise<void> {
    let csv: ReturnType<typeof fastCsv.format> | undefined;
    let outputAborted = output.destroyed;
    let outputAbortError = new Error(
      'Psychometric CSV output stream was closed'
    );
    const abortCsvProduction = (error?: Error) => {
      outputAborted = true;
      if (error instanceof Error) {
        outputAbortError = error;
      }
      if (csv && !csv.destroyed) {
        csv.destroy(outputAbortError);
      }
    };

    output.once('error', abortCsvProduction);
    output.once('close', abortCsvProduction);

    const checkProductionCancellation = async (): Promise<void> => {
      if (outputAborted) {
        throw outputAbortError;
      }
      await options.checkCancellation?.();
    };

    try {
      const analysis = await this.analyze({
        ...options,
        checkCancellation: checkProductionCancellation
      });
      await checkProductionCancellation();
      csv = fastCsv.format({
        headers: [
          'type',
          'domain',
          'domain_label',
          'unit',
          'item',
          'variable',
          'item_label',
          'code',
          'category',
          'label',
          'score',
          'source',
          'n',
          'positive_n',
          'positive_share',
          'correlation',
          'status',
          'note'
        ],
        delimiter: ';',
        alwaysWriteHeaders: true
      });

      csv.on('error', error => {
        if (!output.destroyed) {
          output.destroy(error);
        }
      });
      csv.pipe(output);

      for (const row of analysis.rows) {
        if (outputAborted) {
          throw outputAbortError;
        }
        const canContinue = csv.write({
          type: sanitizeCsvText(row.type),
          domain: sanitizeCsvText(row.domain),
          domain_label: sanitizeCsvText(row.domainLabel),
          unit: sanitizeCsvText(row.unit),
          item: sanitizeCsvText(row.item),
          variable: sanitizeCsvText(row.variable),
          item_label: sanitizeCsvText(row.itemLabel),
          code: sanitizeCsvText(row.code),
          category: sanitizeCsvText(row.category),
          label: sanitizeCsvText(row.label),
          score: row.score,
          source: sanitizeCsvText(row.source),
          n: row.n,
          positive_n: row.positiveN,
          positive_share: row.positiveShare,
          correlation: row.correlation,
          status: sanitizeCsvText(row.status),
          note: sanitizeCsvText(row.note)
        });
        if (!canContinue) {
          await new Promise<void>((resolve, reject) => {
            const onDrain = () => {
              csv.off('error', onError);
              resolve();
            };
            const onError = (error: Error) => {
              csv.off('drain', onDrain);
              reject(error);
            };
            csv.once('drain', onDrain);
            csv.once('error', onError);
          });
          await checkProductionCancellation();
        }
      }

      await checkProductionCancellation();
      csv.end();
    } catch (error) {
      if (csv && !csv.destroyed) {
        csv.destroy();
      }
      if (!output.destroyed) {
        output.destroy(
          error instanceof Error ? error : new Error(String(error))
        );
      }
    } finally {
      output.off('error', abortCsvProduction);
      output.off('close', abortCsvProduction);
    }
  }

  async writePsychometricsExcelToFile(
    filePath: string,
    options: PsychometricExportServiceOptions
  ): Promise<void> {
    const analysis = await this.analyze(options);
    await options.checkCancellation?.();
    const outputStream = fs.createWriteStream(filePath);
    const streamComplete = new Promise<void>((resolve, reject) => {
      outputStream.on('finish', resolve);
      outputStream.on('error', reject);
    });
    streamComplete.catch(() => undefined);
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream: outputStream,
      useStyles: false,
      useSharedStrings: false
    });

    try {
      const overview = workbook.addWorksheet('Übersicht');
      overview.columns = [
        { header: 'Kennzahl', key: 'key', width: 36 },
        { header: 'Wert', key: 'value', width: 60 }
      ];
      analysis.summary.forEach(row => overview.addRow(row).commit());
      await overview.commit();

      await this.writeMetricWorksheet(
        workbook,
        'Score-Trennschärfen',
        analysis.rows.filter(row => row.type === 'SCORE')
      );
      await this.writeMetricWorksheet(
        workbook,
        'Code-Trennschärfen',
        analysis.rows.filter(row => row.type === 'CODE')
      );
      await this.writeMetricWorksheet(
        workbook,
        'Kategorie-Trennschärfen',
        analysis.rows.filter(row => row.type === 'CATEGORY')
      );

      await options.checkCancellation?.();
      await workbook.commit();
      await streamComplete;
    } catch (error) {
      const streamError =
        error instanceof Error ? error : new Error(String(error));
      if (!outputStream.destroyed) {
        outputStream.destroy(streamError);
      }
      await streamComplete.catch(() => undefined);
      throw error;
    }
  }

  private async writeMetricWorksheet(
    workbook: ExcelJS.stream.xlsx.WorkbookWriter,
    name: string,
    rows: PsychometricMetricRow[]
  ): Promise<void> {
    const worksheet = workbook.addWorksheet(name);
    worksheet.columns = [
      { header: 'Domäne', key: 'domainLabel', width: 24 },
      { header: 'Domänen-ID', key: 'domain', width: 22 },
      { header: 'Unit', key: 'unit', width: 24 },
      { header: 'Item', key: 'item', width: 20 },
      { header: 'Variable', key: 'variable', width: 22 },
      { header: 'Item-Label', key: 'itemLabel', width: 32 },
      { header: 'Code', key: 'code', width: 14 },
      { header: 'Kategorie', key: 'category', width: 22 },
      { header: 'Label', key: 'label', width: 32 },
      { header: 'Score', key: 'score', width: 12 },
      { header: 'Quelle', key: 'source', width: 20 },
      { header: 'N', key: 'n', width: 12 },
      { header: 'N positiv', key: 'positiveN', width: 14 },
      { header: 'Anteil positiv', key: 'positiveShare', width: 16 },
      { header: 'Korrelation', key: 'correlation', width: 16 },
      { header: 'Status', key: 'status', width: 24 },
      { header: 'Hinweis', key: 'note', width: 42 }
    ];
    rows.forEach(row => worksheet.addRow(row).commit());
    await worksheet.commit();
  }

  private async analyze(
    rawOptions: PsychometricExportServiceOptions
  ): Promise<PsychometricAnalysis> {
    const options = this.normalizeOptions(rawOptions);
    await options.checkCancellation?.();
    await options.onProgress?.(2);

    const mapping = await this.buildItemMappingContext(options.workspaceId);
    if (mapping.issues.length > 0) {
      const preview = mapping.issues.slice(0, 10).join('; ');
      const suffix =
        mapping.issues.length > 10 ?
          `; weitere Probleme: ${mapping.issues.length - 10}` :
          '';
      throw new BadRequestException(
        `VOMD-Itemzuordnung ist unvollständig oder mehrdeutig: ${preview}${suffix}`
      );
    }
    if (mapping.items.length === 0) {
      throw new BadRequestException(
        'Keine auswertbaren Items mit VOMD-Zuordnung gefunden'
      );
    }

    await this.assignDomains(
      options.workspaceId,
      mapping.items,
      options.domain
    );
    const missingDefinitions = await this.loadMissingDefinitions(
      options.workspaceId,
      options.missingsProfileId
    );
    this.initializeMetricDefinitions(
      mapping.items,
      missingDefinitions,
      options.maxCategoryCount
    );

    const {
      duplicatePersonIds,
      totalRows,
      includedPersonIds,
      includedResponseCount
    } = await this.withConsistentResponseSnapshot(
      options.workspaceId,
      (manager, exclusions) => this.analyzeResponseSnapshot(
        options,
        mapping,
        missingDefinitions,
        manager,
        exclusions
      )
    );

    const rows = this.createMetricRows(mapping.items, options.maxCategoryCount);
    await options.checkCancellation?.();
    await options.onProgress?.(100, {
      processedRows: totalRows * 2,
      totalRows: totalRows * 2
    });

    return {
      rows,
      summary: [
        { key: 'Ergebnisversion', value: options.version },
        {
          key: 'Domänenbildung',
          value:
            options.domain.mode === 'workspace' ?
              'Gesamter Workspace' :
              `${options.domain.scope}: ${options.domain.entryId}`
        },
        {
          key: 'Part-Whole-Korrektur',
          value: options.partWholeCorrection
        },
        { key: 'Maximale Kategorienzahl', value: options.maxCategoryCount },
        { key: 'Zugeordnete Items', value: mapping.items.length },
        { key: 'Berücksichtigte Testpersonen', value: includedPersonIds.size },
        { key: 'Berücksichtigte Ergebniszeilen', value: includedResponseCount },
        {
          key: 'Ausgeschlossene Testpersonen mit Duplikaten',
          value: duplicatePersonIds.size
        },
        {
          key: 'Hinweis Duplikate',
          value:
            'Testpersonen mit mehreren Ergebniszeilen für dieselbe Unit-Variable-Kombination wurden vollständig ausgeschlossen.'
        },
        {
          key: 'Hinweis fehlende Scores',
          value:
            'Numerische Missing-Scores wurden einbezogen; Missing-Scores mit null wurden paarweise ausgeschlossen.'
        }
      ]
    };
  }

  private async withConsistentResponseSnapshot<T>(
    workspaceId: number,
    callback: (
      manager: EntityManager,
      exclusions: ResolvedWorkspaceExclusions
    ) => Promise<T>
  ): Promise<T> {
    const exclusions =
      await this.workspaceExclusionService.resolveExclusionsForQueries(
        workspaceId
      );
    const queryRunner = this.connection.createQueryRunner();

    try {
      await queryRunner.connect();
      await queryRunner.startTransaction('REPEATABLE READ');
      await queryRunner.query('SET TRANSACTION READ ONLY');
      const result = await callback(queryRunner.manager, exclusions);
      await queryRunner.commitTransaction();
      return result;
    } catch (error) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }
      throw error;
    } finally {
      if (!queryRunner.isReleased) {
        await queryRunner.release();
      }
    }
  }

  private async analyzeResponseSnapshot(
    options: NormalizedPsychometricExportServiceOptions,
    mapping: ItemMappingContext,
    missingDefinitions: MissingDefinition[],
    manager: EntityManager,
    exclusions: ResolvedWorkspaceExclusions
  ): Promise<ResponseAnalysisSummary> {
    const duplicatePersonIds = await this.getDuplicatePersonIds(
      options.workspaceId,
      options.version,
      mapping,
      manager,
      exclusions,
      options.checkCancellation
    );
    const totalRows = await this.countResponseRows(
      options.workspaceId,
      options.version,
      manager,
      exclusions
    );
    const personDomainScores = new Map<string, DomainAggregate>();
    const includedPersonIds = new Set<number>();
    let includedResponseCount = 0;

    await this.forEachResponseBatch(
      options.workspaceId,
      options.version,
      manager,
      exclusions,
      async (rows, processedRows) => {
        rows.forEach(row => {
          const personId = Number(row.personId);
          if (duplicatePersonIds.has(personId)) {
            return;
          }

          const item = this.getMappedItem(mapping, row);
          if (!item) {
            return;
          }
          const value = this.getVersionedValue(row, options.version);
          const normalizedCode = this.normalizeCode(
            value.code,
            missingDefinitions
          );
          const normalizedScore = this.normalizeScore(
            value,
            normalizedCode,
            missingDefinitions
          );
          const domain = this.requireDomain(item);
          const domainKey = this.getPersonDomainKey(personId, domain.id);

          includedPersonIds.add(personId);
          includedResponseCount += 1;
          if (normalizedScore !== null) {
            const aggregate = personDomainScores.get(domainKey) || {
              sum: 0,
              count: 0
            };
            aggregate.sum += normalizedScore;
            aggregate.count += 1;
            personDomainScores.set(domainKey, aggregate);
          }

          if (
            normalizedCode !== null &&
            !item.codeDefinitions.has(normalizedCode)
          ) {
            item.codeDefinitions.set(normalizedCode, {
              value: String(normalizedCode),
              label: String(normalizedCode),
              source: 'OBSERVED'
            });
          }

          if (
            this.isCategoryEligible(normalizedCode) &&
            !item.categoryLimitExceeded
          ) {
            this.parseCategories(row.value, item.variable).forEach(
              category => {
                this.addCategoryDefinition(
                  item,
                  category,
                  options.maxCategoryCount
                );
              }
            );
          }
        });
        await options.onProgress?.(
          10 + Math.round((processedRows / Math.max(1, totalRows)) * 35),
          { processedRows, totalRows: totalRows * 2 }
        );
      },
      options.checkCancellation
    );

    mapping.items.forEach(item => {
      item.codeDefinitions.forEach((_definition, code) => {
        item.codeAccumulators.set(code, createCorrelationAccumulator());
      });
      if (!item.categoryLimitExceeded) {
        item.categories.forEach((_definition, category) => {
          item.categoryAccumulators.set(
            category,
            createCorrelationAccumulator()
          );
        });
      }
    });

    await this.forEachResponseBatch(
      options.workspaceId,
      options.version,
      manager,
      exclusions,
      async (rows, processedRows) => {
        rows.forEach(row => {
          const personId = Number(row.personId);
          if (duplicatePersonIds.has(personId)) {
            return;
          }

          const item = this.getMappedItem(mapping, row);
          if (!item) {
            return;
          }
          const value = this.getVersionedValue(row, options.version);
          const normalizedCode = this.normalizeCode(
            value.code,
            missingDefinitions
          );
          const normalizedScore = this.normalizeScore(
            value,
            normalizedCode,
            missingDefinitions
          );
          const domain = this.requireDomain(item);
          const aggregate = personDomainScores.get(
            this.getPersonDomainKey(personId, domain.id)
          );
          const domainScore = this.getDomainScore(
            aggregate,
            normalizedScore,
            options.partWholeCorrection
          );
          if (domainScore === null) {
            return;
          }

          if (normalizedScore !== null) {
            addCorrelationPair(
              item.scoreAccumulator,
              normalizedScore,
              domainScore
            );
          }

          if (normalizedCode !== null) {
            item.codeAccumulators.forEach((accumulator, code) => {
              addCorrelationPair(
                accumulator,
                normalizedCode === code ? 1 : 0,
                domainScore
              );
            });
          }

          if (
            !item.categoryLimitExceeded &&
            this.isCategoryEligible(normalizedCode)
          ) {
            const observedCategories = new Set(
              this.parseCategories(row.value, item.variable).map(
                category => category.value
              )
            );
            item.categoryAccumulators.forEach((accumulator, category) => {
              addCorrelationPair(
                accumulator,
                observedCategories.has(category) ? 1 : 0,
                domainScore
              );
            });
          }
        });
        await options.onProgress?.(
          50 + Math.round((processedRows / Math.max(1, totalRows)) * 40),
          {
            processedRows: totalRows + processedRows,
            totalRows: totalRows * 2
          }
        );
      },
      options.checkCancellation
    );

    return {
      duplicatePersonIds,
      totalRows,
      includedPersonIds,
      includedResponseCount
    };
  }

  private normalizeOptions(
    options: PsychometricExportServiceOptions
  ): NormalizedPsychometricExportServiceOptions {
    const version = options.version || 'v2';
    if (!['v1', 'v2', 'v3'].includes(version)) {
      throw new BadRequestException(
        'Psychometrie-Exporte unterstützen nur v1, v2 oder v3'
      );
    }

    const maxCategoryCount = options.maxCategoryCount ?? 10;
    if (
      !Number.isSafeInteger(maxCategoryCount) ||
      maxCategoryCount < 1 ||
      maxCategoryCount > 100
    ) {
      throw new BadRequestException(
        'maxCategoryCount muss eine ganze Zahl zwischen 1 und 100 sein'
      );
    }
    if (
      options.partWholeCorrection !== undefined &&
      typeof options.partWholeCorrection !== 'boolean'
    ) {
      throw new BadRequestException(
        'partWholeCorrection muss ein boolescher Wert sein'
      );
    }

    return {
      ...options,
      version,
      partWholeCorrection: options.partWholeCorrection !== false,
      domain: options.domain || { mode: 'workspace' },
      maxCategoryCount
    };
  }

  private async buildItemMappingContext(
    workspaceId: number
  ): Promise<ItemMappingContext> {
    const [unitDetails, vomdDocuments] = await Promise.all([
      this.workspaceFilesService.getUnitVariableDetails(workspaceId),
      this.loadVomdDocuments(workspaceId)
    ]);
    const items: MappedItem[] = [];
    const byLogicalKey = new Map<string, MappedItem>();
    const issues: string[] = [];
    const unitDetailsByKey = new Map(
      unitDetails.map(unit => [this.normalizeUnitKey(unit.unitName), unit])
    );
    const documentsByUnit = new Map<string, VomdDocument[]>();
    vomdDocuments.forEach(document => {
      const documents = documentsByUnit.get(document.unitKey) || [];
      documents.push(document);
      documentsByUnit.set(document.unitKey, documents);
    });

    unitDetailsByKey.forEach((unit, unitKey) => {
      const documents = documentsByUnit.get(unitKey) || [];
      if (documents.length === 0) {
        issues.push(`${unit.unitName}: keine VOMD-Datei`);
        return;
      }

      documents
        .flatMap(document => document.items.map(vomdItem => ({
          document,
          vomdItem
        }))
        )
        .forEach(({ document, vomdItem }) => {
          const vomdVariableId = String(vomdItem.variableId || '').trim();
          const itemId = String(vomdItem.id || vomdVariableId || '?');
          if (!vomdVariableId) {
            issues.push(
              `${unit.unitName}/${itemId}: VOMD-Item ohne variableId`
            );
            return;
          }

          const normalizedVomdVariableId =
            this.normalizeVariableKey(vomdVariableId);
          const variableCandidates = unit.variables.filter(variable => [variable.alias, variable.id]
            .map(value => this.normalizeVariableKey(value))
            .includes(normalizedVomdVariableId)
          );
          if (variableCandidates.length === 0) {
            issues.push(
              `${unit.unitName}/${itemId}: Variable ${vomdVariableId} nicht gefunden`
            );
            return;
          }
          if (variableCandidates.length > 1) {
            issues.push(
              `${unit.unitName}/${itemId}: Variable ${vomdVariableId} ist mehrdeutig`
            );
            return;
          }

          const variable = variableCandidates[0];
          const variableId = String(variable.alias || variable.id).trim();
          const sourceVariableId = String(variable.id || variableId).trim();
          const key = this.getLogicalKey(unit.unitName, variableId);
          if (items.some(item => item.key === key)) {
            issues.push(`${unit.unitName}/${variableId}: mehrere VOMD-Items`);
            return;
          }
          const mappedItem: MappedItem = {
            key,
            unitName: unit.unitName,
            variableId,
            sourceVariableId,
            itemId: String(vomdItem.id || variableId),
            itemLabel: String(
              vomdItem.description || vomdItem.id || variableId
            ),
            variable,
            vomd: document,
            vomdItem,
            codeDefinitions: new Map(),
            categories: new Map(),
            scoreAccumulator: createCorrelationAccumulator(),
            codeAccumulators: new Map(),
            categoryAccumulators: new Map(),
            categoryLimitExceeded: false
          };
          items.push(mappedItem);

          [variableId, sourceVariableId].forEach(responseVariableId => {
            const logicalKey = this.getLogicalKey(
              unit.unitName,
              responseVariableId
            );
            const existing = byLogicalKey.get(logicalKey);
            if (existing && existing !== mappedItem) {
              issues.push(
                `${unit.unitName}/${responseVariableId}: mehrdeutige Variablenzuordnung`
              );
            } else {
              byLogicalKey.set(logicalKey, mappedItem);
            }
          });
        });
    });

    return { items, byLogicalKey, issues };
  }

  private async loadVomdDocuments(
    workspaceId: number
  ): Promise<VomdDocument[]> {
    const files = await this.fileUploadRepository.find({
      where: [
        {
          workspace_id: workspaceId,
          file_type: 'Resource',
          filename: ILike('%.vomd')
        },
        {
          workspace_id: workspaceId,
          file_type: 'Resource',
          file_id: ILike('%.vomd')
        }
      ],
      select: ['id', 'file_id', 'filename', 'data']
    });
    const uniqueFiles = Array.from(
      new Map(files.map(file => [file.id, file])).values()
    );

    return uniqueFiles.map(file => {
      let parsed: StoredVomd;
      try {
        parsed = JSON.parse(String(file.data || '')) as StoredVomd;
      } catch (error) {
        throw new BadRequestException(
          `VOMD-Datei '${file.filename}' ist kein gültiges JSON: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }

      return {
        fileName: file.filename,
        unitKey: this.normalizeUnitKey(file.file_id || file.filename),
        profiles: this.getCurrentMetadataProfiles(parsed.profiles),
        items: (Array.isArray(parsed.items) ? parsed.items : []).map(
          item => ({
            ...item,
            profiles: this.getCurrentMetadataProfiles(item.profiles)
          })
        )
      };
    });
  }

  private getCurrentMetadataProfiles(
    profiles: StoredMetadataProfile[] | undefined
  ): StoredMetadataProfile[] {
    return (Array.isArray(profiles) ? profiles : []).filter(
      profile => profile.isCurrent !== false
    );
  }

  private addCandidateEntries(
    candidates: Map<
    string,
    {
      scope: MetadataScope;
      profileId: string;
      entryId: string;
      label: string;
      valuesByItem: Map<string, MetadataScalarValue[]>;
    }
    >,
    item: MappedItem,
    scope: MetadataScope,
    profiles: StoredMetadataProfile[]
  ): void {
    profiles.forEach(profile => {
      const profileId = String(profile.profileId || '').trim();
      if (!profileId) {
        return;
      }
      (profile.entries || []).forEach(entry => {
        const entryId = String(entry.id || '').trim();
        if (!entryId) {
          return;
        }
        const key = this.getDomainFieldKey({
          mode: 'vomd-field',
          scope,
          profileId,
          entryId
        });
        const candidate = candidates.get(key) || {
          scope,
          profileId,
          entryId,
          label: this.getLocalizedText(entry.label) || entryId,
          valuesByItem: new Map<string, MetadataScalarValue[]>()
        };
        candidate.valuesByItem.set(
          item.key,
          this.normalizeMetadataValue(entry.value)
        );
        candidates.set(key, candidate);
      });
    });
  }

  private async assignDomains(
    workspaceId: number,
    items: MappedItem[],
    selection: PsychometricDomainSelection
  ): Promise<void> {
    if (selection.mode === 'workspace') {
      items.forEach(item => {
        item.domain = {
          id: 'WORKSPACE',
          label: 'Gesamter Workspace'
        };
      });
      return;
    }

    const { candidates } = await this.getDomainCandidates(workspaceId);
    const selectedCandidate = candidates.find(
      candidate => candidate.scope === selection.scope &&
        candidate.profileId === selection.profileId &&
        candidate.entryId === selection.entryId
    );
    if (!selectedCandidate?.selectable) {
      throw new BadRequestException(
        'Das ausgewählte VOMD-Domänenfeld ist nicht vollständig und einwertig'
      );
    }

    items.forEach(item => {
      const profiles =
        selection.scope === 'UNIT' ?
          item.vomd.profiles :
          item.vomdItem.profiles || [];
      const values = this.getSelectedMetadataValues(profiles, selection);
      if (values.length !== 1) {
        throw new BadRequestException(
          `Domänenwert für ${item.unitName}/${item.variableId} ist nicht eindeutig`
        );
      }
      item.domain = values[0];
    });
  }

  private getSelectedMetadataValues(
    profiles: StoredMetadataProfile[],
    selection: PsychometricDomainFieldSelection
  ): MetadataScalarValue[] {
    const profile = profiles.find(
      item => item.profileId === selection.profileId
    );
    const entry = (profile?.entries || []).find(
      item => item.id === selection.entryId
    );
    return this.normalizeMetadataValue(entry?.value);
  }

  private normalizeMetadataValue(value: unknown): MetadataScalarValue[] {
    if (value === null || value === undefined) {
      return [];
    }

    if (Array.isArray(value)) {
      if (
        value.every(
          item => this.isRecord(item) &&
            typeof item.lang === 'string' &&
            typeof item.value === 'string'
        )
      ) {
        const label = this.getLocalizedText(value as LanguageCodedText[]);
        return label ? [{ id: label, label }] : [];
      }

      return value.flatMap(item => this.normalizeMetadataValue(item));
    }

    if (this.isRecord(value)) {
      if (value.id !== undefined) {
        const vocabularyValue = value as unknown as StoredVocabularyEntry;
        const id = String(vocabularyValue.id || '').trim();
        return id ?
          [
            {
              id,
              label: this.getLocalizedText(vocabularyValue.label) || id
            }
          ] :
          [];
      }
      if (value.raw !== undefined) {
        const simpleValue = value as StoredSimpleValue;
        const id = String(simpleValue.raw ?? '').trim();
        return id ?
          [
            {
              id,
              label: this.getLocalizedText(simpleValue.asText) || id
            }
          ] :
          [];
      }
    }

    const normalized = String(value).trim();
    return normalized ? [{ id: normalized, label: normalized }] : [];
  }

  private getLocalizedText(values?: LanguageCodedText[]): string {
    if (!Array.isArray(values) || values.length === 0) {
      return '';
    }
    const preferred = values.find(value => value.lang === 'de') || values[0];
    return String(preferred?.value || '').trim();
  }

  private async loadMissingDefinitions(
    workspaceId: number,
    requestedProfileId?: number
  ): Promise<MissingDefinition[]> {
    const profileId =
      await this.missingsProfilesService.resolveMissingsProfileId(
        workspaceId,
        requestedProfileId
      );
    const profile =
      await this.missingsProfilesService.getMissingsProfileDetails(
        workspaceId,
        profileId
      );
    if (!profile) {
      throw new BadRequestException(
        `Missing-Profil ${profileId} wurde nicht gefunden`
      );
    }

    return profile.parseMissings().map(missing => ({
      id: missing.id,
      code: Number(missing.code),
      score: missing.score === null ? null : Number(missing.score),
      label: missing.label
    }));
  }

  private initializeMetricDefinitions(
    items: MappedItem[],
    missingDefinitions: MissingDefinition[],
    maxCategoryCount: number
  ): void {
    items.forEach(item => {
      missingDefinitions.forEach(missing => {
        item.codeDefinitions.set(missing.code, {
          value: String(missing.code),
          label: missing.label,
          score: missing.score === null ? undefined : missing.score,
          source: 'MISSING_PROFILE'
        });
      });
      (item.variable.codes || []).forEach(code => {
        const numericCode = Number(code.id);
        if (!Number.isFinite(numericCode)) {
          return;
        }
        if (!item.codeDefinitions.has(numericCode)) {
          item.codeDefinitions.set(numericCode, {
            value: String(code.id),
            label: code.label || String(code.id),
            score: code.score,
            source: 'VOCS'
          });
        }
      });
      (item.variable.values || []).forEach(value => {
        const rawCategoryValue = String(value.value ?? '').trim();
        const categoryValue =
          rawCategoryValue ||
          (this.acceptsEmptyCategory(item.variable) ?
            this.emptyCategoryValue :
            '');
        if (categoryValue) {
          this.addCategoryDefinition(
            item,
            {
              value: categoryValue,
              label: value.label || categoryValue,
              source: 'UNIT_DEFINITION'
            },
            maxCategoryCount
          );
        }
      });
      (item.variable.valuePositionLabels || []).forEach((label, index) => {
        const categoryValue = String(
          item.variable.values?.[index]?.value ?? index + 1
        ).trim();
        if (categoryValue) {
          this.addCategoryDefinition(
            item,
            {
              value: categoryValue,
              label: label || categoryValue,
              source: 'UNIT_DEFINITION'
            },
            maxCategoryCount
          );
        }
      });
    });
  }

  private addCategoryDefinition(
    item: MappedItem,
    definition: MetricDefinition,
    maxCategoryCount: number
  ): void {
    if (
      item.categoryLimitExceeded ||
      item.categories.has(definition.value)
    ) {
      return;
    }
    if (item.categories.size >= maxCategoryCount) {
      item.categoryLimitExceeded = true;
      return;
    }
    item.categories.set(definition.value, definition);
  }

  private acceptsEmptyCategory(variable: VariableDetailDto): boolean {
    return variable.processing?.includes('TAKE_EMPTY_AS_VALID') === true;
  }

  private async getDuplicatePersonIds(
    workspaceId: number,
    version: PsychometricVersion,
    mapping: ItemMappingContext,
    manager: EntityManager,
    exclusions: ResolvedWorkspaceExclusions,
    checkCancellation?: () => Promise<void>
  ): Promise<Set<number>> {
    await checkCancellation?.();
    const query = this.createResponseQuery(
      workspaceId,
      version,
      manager,
      exclusions
    );
    const rows = await query
      .select('person.id', 'personId')
      .addSelect('UPPER(TRIM(unit.name))', 'unitName')
      .addSelect('UPPER(TRIM(response.variableid))', 'variableId')
      .groupBy('person.id')
      .addGroupBy('UPPER(TRIM(unit.name))')
      .addGroupBy('UPPER(TRIM(response.variableid))')
      .having('COUNT(*) > 1')
      .getRawMany<{
      personId: number | string;
      unitName: string;
      variableId: string;
    }>();
    await checkCancellation?.();
    return new Set(
      rows
        .filter(row => mapping.byLogicalKey.has(
          this.getLogicalKey(row.unitName, row.variableId)
        )
        )
        .map(row => Number(row.personId))
    );
  }

  private async countResponseRows(
    workspaceId: number,
    version: PsychometricVersion,
    manager: EntityManager,
    exclusions: ResolvedWorkspaceExclusions
  ): Promise<number> {
    const query = this.createResponseQuery(
      workspaceId,
      version,
      manager,
      exclusions
    );
    return query.getCount();
  }

  private async forEachResponseBatch(
    workspaceId: number,
    version: PsychometricVersion,
    manager: EntityManager,
    exclusions: ResolvedWorkspaceExclusions,
    callback: (rows: RawResponseRow[], processedRows: number) => Promise<void>,
    checkCancellation?: () => Promise<void>
  ): Promise<void> {
    let lastResponseId = 0;
    let processedRows = 0;
    let hasMoreRows = true;

    while (hasMoreRows) {
      await checkCancellation?.();
      const query = this.createResponseQuery(
        workspaceId,
        version,
        manager,
        exclusions
      );
      const rows = await query
        .select('response.id', 'responseId')
        .addSelect('person.id', 'personId')
        .addSelect('unit.name', 'unitName')
        .addSelect('response.variableid', 'variableId')
        .addSelect('response.value', 'value')
        .addSelect('response.code_v1', 'codeV1')
        .addSelect('response.score_v1', 'scoreV1')
        .addSelect('response.code_v2', 'codeV2')
        .addSelect('response.score_v2', 'scoreV2')
        .addSelect('response.code_v3', 'codeV3')
        .addSelect('response.score_v3', 'scoreV3')
        .andWhere('response.id > :lastResponseId', { lastResponseId })
        .orderBy('response.id', 'ASC')
        .limit(this.responseBatchSize)
        .getRawMany<RawResponseRow>();
      if (rows.length === 0) {
        hasMoreRows = false;
        continue;
      }

      processedRows += rows.length;
      await callback(rows, processedRows);
      lastResponseId = Number(rows[rows.length - 1].responseId);
      if (rows.length < this.responseBatchSize) {
        break;
      }
    }

    this.logger.debug(
      `Read ${processedRows} response rows for psychometric ${version} export`
    );
  }

  private createResponseQuery(
    workspaceId: number,
    version: PsychometricVersion,
    manager: EntityManager,
    exclusions: ResolvedWorkspaceExclusions
  ): SelectQueryBuilder<ResponseEntity> {
    const query = manager
      .getRepository(ResponseEntity)
      .createQueryBuilder('response')
      .innerJoin('response.unit', 'unit')
      .innerJoin('unit.booklet', 'booklet')
      .innerJoin('booklet.person', 'person')
      .innerJoin('booklet.bookletinfo', 'bookletinfo')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      .andWhere(`response.status_${version} IS NOT NULL`)
      .andWhere(
        `response.status_${version} NOT IN (:...psychometricIgnoredStatuses)`,
        { psychometricIgnoredStatuses: STATISTICS_IGNORED_STATUSES }
      );
    applyResolvedExclusionsToQuery(query, exclusions);
    return query;
  }

  private getMappedItem(
    mapping: ItemMappingContext,
    row: RawResponseRow
  ): MappedItem | undefined {
    return mapping.byLogicalKey.get(
      this.getLogicalKey(row.unitName, row.variableId)
    );
  }

  private getVersionedValue(
    row: RawResponseRow,
    version: PsychometricVersion
  ): VersionedResponseValue {
    const suffix = version.substring(1);
    return {
      code: this.toNullableNumber(
        row[`codeV${suffix}` as keyof RawResponseRow]
      ),
      score: this.toNullableNumber(
        row[`scoreV${suffix}` as keyof RawResponseRow]
      )
    };
  }

  private toNullableNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : null;
  }

  private normalizeCode(
    code: number | null,
    missingDefinitions: MissingDefinition[]
  ): number | null {
    const mir = missingDefinitions.find(missing => missing.id === 'mir');
    const mci = missingDefinitions.find(missing => missing.id === 'mci');
    return mapCodeForExport(code, {
      mirCode: mir?.code,
      mciCode: mci?.code
    });
  }

  private normalizeScore(
    value: VersionedResponseValue,
    normalizedCode: number | null,
    missingDefinitions: MissingDefinition[]
  ): number | null {
    const missing = missingDefinitions.find(
      definition => definition.code === normalizedCode
    );
    if (missing) {
      return missing.score;
    }
    return value.score;
  }

  private isCategoryEligible(code: number | null): boolean {
    return code !== null && code >= 0;
  }

  private getDomainScore(
    aggregate: DomainAggregate | undefined,
    itemScore: number | null,
    partWholeCorrection: boolean
  ): number | null {
    if (!aggregate || aggregate.count === 0) {
      return null;
    }

    const shouldSubtract = partWholeCorrection && itemScore !== null;
    const count = aggregate.count - (shouldSubtract ? 1 : 0);
    if (count <= 0) {
      return null;
    }
    const sum = aggregate.sum - (shouldSubtract ? itemScore : 0);
    return sum / count;
  }

  private parseCategories(
    rawValue: string | null,
    variable: VariableDetailDto
  ): MetricDefinition[] {
    if (rawValue === null) {
      return [];
    }
    const value = String(rawValue).trim();
    if (!value) {
      if (!this.acceptsEmptyCategory(variable)) {
        return [];
      }
      const emptyDefinition = (variable.values || []).find(
        definition => String(definition.value ?? '').trim() === ''
      );
      return [
        {
          value: this.emptyCategoryValue,
          label: emptyDefinition?.label || this.emptyCategoryValue,
          source: 'UNIT_DEFINITION'
        }
      ];
    }
    if (value.toLowerCase() === 'null') {
      return [];
    }

    let parsed: unknown = value;
    try {
      parsed = JSON.parse(value);
    } catch {
      // Plain text values are valid categories.
    }

    const categoryValues: string[] = [];
    if (Array.isArray(parsed)) {
      if (
        variable.multiple === true &&
        parsed.every(item => typeof item === 'boolean')
      ) {
        parsed.forEach((selected, index) => {
          if (selected) {
            categoryValues.push(
              variable.values?.[index]?.value || String(index + 1)
            );
          }
        });
      } else {
        parsed.forEach(item => {
          if (item !== null && item !== undefined) {
            categoryValues.push(
              typeof item === 'object' ? JSON.stringify(item) : String(item)
            );
          }
        });
      }
    } else if (parsed !== null && parsed !== undefined) {
      categoryValues.push(
        typeof parsed === 'object' ? JSON.stringify(parsed) : String(parsed)
      );
    }

    return Array.from(new Set(categoryValues.map(item => item.trim())))
      .filter(Boolean)
      .map(category => {
        const definitionValue =
          category === this.emptyCategoryValue ? '' : category;
        const valueDefinition = (variable.values || []).find(
          definition => String(definition.value) === definitionValue
        );
        const codeDefinition = (variable.codes || []).find(
          definition => String(definition.id) === category
        );
        return {
          value: category,
          label: valueDefinition?.label || codeDefinition?.label || category,
          score: codeDefinition?.score,
          source: this.getCategorySource(valueDefinition, codeDefinition)
        };
      });
  }

  private getCategorySource(
    valueDefinition: unknown,
    codeDefinition: unknown
  ): MetricDefinition['source'] {
    if (valueDefinition) {
      return 'UNIT_DEFINITION';
    }
    if (codeDefinition) {
      return 'VOCS';
    }
    return 'OBSERVED';
  }

  private createMetricRows(
    items: MappedItem[],
    maxCategoryCount: number
  ): PsychometricMetricRow[] {
    const rows: PsychometricMetricRow[] = [];
    items.forEach(item => {
      rows.push(
        this.toMetricRow(item, 'SCORE', item.scoreAccumulator, undefined)
      );
      item.codeDefinitions.forEach((definition, code) => {
        rows.push(
          this.toMetricRow(
            item,
            'CODE',
            item.codeAccumulators.get(code),
            definition
          )
        );
      });

      if (item.categoryLimitExceeded) {
        const domain = this.requireDomain(item);
        rows.push({
          type: 'CATEGORY',
          domain: domain.id,
          domainLabel: domain.label,
          unit: item.unitName,
          item: item.itemId,
          variable: item.variableId,
          itemLabel: item.itemLabel,
          code: '',
          category: '',
          label: '',
          score: '',
          source: '',
          n: 0,
          positiveN: '',
          positiveShare: '',
          correlation: '',
          status: 'TOO_MANY_CATEGORIES',
          note: `Mehr als ${maxCategoryCount} Kategorien überschreiten das konfigurierte Limit.`
        });
      } else {
        item.categories.forEach((definition, category) => {
          rows.push(
            this.toMetricRow(
              item,
              'CATEGORY',
              item.categoryAccumulators.get(category),
              definition
            )
          );
        });
      }
    });

    return rows.sort(
      (left, right) => left.type.localeCompare(right.type) ||
        left.domainLabel.localeCompare(right.domainLabel, 'de', {
          numeric: true,
          sensitivity: 'base'
        }) ||
        left.unit.localeCompare(right.unit, 'de', {
          numeric: true,
          sensitivity: 'base'
        }) ||
        left.variable.localeCompare(right.variable, 'de', {
          numeric: true,
          sensitivity: 'base'
        }) ||
        left.code.localeCompare(right.code, 'de', { numeric: true }) ||
        left.category.localeCompare(right.category, 'de', { numeric: true })
    );
  }

  private toMetricRow(
    item: MappedItem,
    type: PsychometricMetricType,
    accumulator: CorrelationAccumulator | undefined,
    definition: MetricDefinition | undefined
  ): PsychometricMetricRow {
    const domain = this.requireDomain(item);
    const safeAccumulator = accumulator || createCorrelationAccumulator();
    const result = calculateCorrelation(safeAccumulator);
    return {
      type,
      domain: domain.id,
      domainLabel: domain.label,
      unit: item.unitName,
      item: item.itemId,
      variable: item.variableId,
      itemLabel: item.itemLabel,
      code: type === 'CODE' ? definition?.value || '' : '',
      category: type === 'CATEGORY' ? definition?.value || '' : '',
      label: definition?.label || '',
      score: definition?.score ?? '',
      source: definition?.source || '',
      n: safeAccumulator.n,
      positiveN: type === 'SCORE' ? '' : safeAccumulator.positiveCount,
      positiveShare:
        type === 'SCORE' || safeAccumulator.n === 0 ?
          '' :
          safeAccumulator.positiveCount / safeAccumulator.n,
      correlation: result.correlation ?? '',
      status: result.status,
      note: this.getCorrelationNote(result.status)
    };
  }

  private getCorrelationNote(status: CorrelationStatus): string {
    switch (status) {
      case 'INSUFFICIENT_CASES':
        return 'Weniger als zwei paarweise vollständige Fälle.';
      case 'CONSTANT_ITEM':
        return 'Itemwert bzw. Dummyvariable ist konstant.';
      case 'CONSTANT_DOMAIN':
        return 'Domänenscore ist konstant.';
      default:
        return '';
    }
  }

  private requireDomain(item: MappedItem): MetadataScalarValue {
    if (!item.domain) {
      throw new BadRequestException(
        `Keine Domäne für ${item.unitName}/${item.variableId}`
      );
    }
    return item.domain;
  }

  private getPersonDomainKey(personId: number, domainId: string): string {
    return `${personId}\u001F${domainId}`;
  }

  private getLogicalKey(unitName: string, variableId: string): string {
    return `${this.normalizeUnitKey(unitName)}\u001F${this.normalizeVariableKey(
      variableId
    )}`;
  }

  private normalizeUnitKey(value: unknown): string {
    return String(value || '')
      .trim()
      .replace(/^.*[\\/]/, '')
      .replace(/\.(VOMD|VOCS|XML)$/i, '')
      .trim()
      .toUpperCase();
  }

  private normalizeVariableKey(value: unknown): string {
    return String(value || '')
      .trim()
      .toUpperCase();
  }

  private getDomainFieldKey(
    selection: PsychometricDomainFieldSelection
  ): string {
    return [selection.scope, selection.profileId, selection.entryId].join(
      '\u001F'
    );
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }
}
