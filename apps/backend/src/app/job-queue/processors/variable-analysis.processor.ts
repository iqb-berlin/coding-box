import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { ResponseEntity } from '../../database/entities/response.entity';
import { CacheService } from '../../cache/cache.service';
import {
  VariableAnalysisJobData,
  VariableAnalysisJobResult,
  VariableAnalysisResultCacheManifest
} from '../job-queue.service';
import { VariableAnalysisResultDto, VariableCombo } from '../../admin/variable-analysis/dto/variable-analysis-result.dto';
import { VariableFrequencyDto } from '../../admin/variable-analysis/dto/variable-frequency.dto';
import {
  applyResolvedExclusionsToQuery,
  WorkspaceExclusionService
} from '../../database/services/workspace/workspace-exclusion.service';
import { WorkspaceFilesService } from '../../database/services/workspace/workspace-files.service';
import { VariableDetailDto } from '../../models/unit-variable-details.dto';

interface SchemaCodeInfo {
  value: string;
  label?: string;
  score?: number;
  order: number;
}

interface VariableAnalysisMetadata {
  multiple: boolean;
  categoryDefinitions: SchemaCodeInfo[];
  valuesByPosition: SchemaCodeInfo[];
}

interface SchemaValueCountRow {
  unitName: string;
  variableId: string;
  value: string | null;
  count: string | number;
  validCount: string | number;
}

interface MultipleResponseRow {
  responseId: string | number;
  unitName: string;
  variableId: string;
  value: string | null;
  status: string | number | null;
  statusV1: string | number | null;
  codeV1: string | number | null;
  scoreV1: string | number | null;
}

interface AnalyzedVariableScopeEntry {
  combo: VariableCombo;
  comboKey: string;
  logicalKey: string;
  multiple: boolean;
  categoryDefinitions: SchemaCodeInfo[];
  valuesByPosition: SchemaCodeInfo[];
}

interface AnalysisSql {
  sql: string;
  parameters: unknown[];
}

interface VariableAnalysisScopeOptions {
  unitId?: number;
  variableId?: string;
}

interface ParsedMultipleCategory {
  value: string;
  label?: string;
  score?: number;
  schemaOrder?: number;
}

interface MultipleResponseSummary {
  totalCount: number;
  validCount: number;
  emptyCount: number;
  counts: Map<string, number>;
  validCounts: Map<string, number>;
  categories: Map<string, ParsedMultipleCategory>;
}

interface FrequencyCounts {
  count: number;
  validCount: number;
}

interface MultipleResponseObservedCounts {
  countsByComboKey: Map<string, Map<string, number>>;
  validCountsByComboKey: Map<string, Map<string, number>>;
}

@Processor('variable-analysis')
export class VariableAnalysisProcessor {
  private readonly logger = new Logger(VariableAnalysisProcessor.name);

  private readonly MAX_VALUES_PER_VARIABLE = 20;
  private readonly MAX_VALUE_PREVIEW_LENGTH = 500;
  private readonly RESULT_CACHE_TTL_SECONDS = 86400;
  private readonly RESULT_CACHE_CHUNK_SIZE = 100;
  private readonly MULTIPLE_RESPONSE_COMBO_CHUNK_SIZE = 100;
  private readonly MULTIPLE_RESPONSE_ROW_BATCH_SIZE = 5000;
  private readonly INVALID_OR_MISSING_VALID_DENOMINATOR_STATUSES = [
    0, // UNSET
    1, // NOT_REACHED
    2, // DISPLAYED
    4, // DERIVE_ERROR
    7, // INVALID
    9, // CODING_ERROR
    10 // PARTLY_DISPLAYED
  ];

  constructor(
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    private cacheService: CacheService,
    private workspaceExclusionService: WorkspaceExclusionService,
    private workspaceFilesService: WorkspaceFilesService
  ) { }

  @Process()
  async process(job: Job<VariableAnalysisJobData>): Promise<VariableAnalysisJobResult> {
    this.logger.log(`Processing variable analysis job ${job.id} for workspace ${job.data.workspaceId}`);

    try {
      await job.progress(0);

      const workspaceId = job.data.workspaceId;
      const unitId = job.data.unitId;
      const variableId = job.data.variableId;
      const cacheKey = job.data.cacheKey || this.createResultCacheKey(workspaceId, job.id);
      const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);

      const query = this.responseRepository
        .createQueryBuilder('response')
        .innerJoin('response.unit', 'unit')
        .innerJoin('unit.booklet', 'booklet')
        .innerJoin('booklet.person', 'person')
        .innerJoin('booklet.bookletinfo', 'bookletinfo')
        .where('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('person.consider = :consider', { consider: true });
      applyResolvedExclusionsToQuery(query, exclusions);

      // Add filters
      if (unitId) {
        query.andWhere('unit.id = :unitId', { unitId });
      }

      const scopeEntries = await this.getAnalysisScope(
        workspaceId,
        query,
        { unitId, variableId }
      );
      const variableCombos = scopeEntries.map(entry => entry.combo);

      if (variableCombos.length === 0) {
        await job.progress(100);
        return await this.cacheAndReturnMetadata(job, cacheKey, {
          variableCombos: [],
          frequencies: {},
          total: 0
        });
      }

      const total = variableCombos.length;

      const frequencies: { [key: string]: VariableFrequencyDto[] } = {};
      const comboByKey = new Map<string, VariableCombo>();
      const scopeByLogicalKey = new Map<string, AnalyzedVariableScopeEntry>();
      scopeEntries.forEach(entry => {
        const comboKey = entry.comboKey;
        comboByKey.set(comboKey, entry.combo);
        scopeByLogicalKey.set(entry.logicalKey, entry);
        frequencies[comboKey] = [];
      });
      const metadataByComboKey = this.getVariableMetadataByComboKey(
        scopeEntries
      );
      const categoryDefinitionsByComboKey = this.getCategoryDefinitionsByComboKey(
        metadataByComboKey
      );
      const analysisSql = this.getDedupedAnalysisSql(
        query,
        scopeEntries.map(entry => entry.logicalKey)
      );

      await job.progress(25);

      const summaryRows = await this.responseRepository.query(
        `
          SELECT
            analysis_rows."unitName" AS "unitName",
            analysis_rows."variableId" AS "variableId",
            COUNT(*) AS "totalCount",
            SUM(CASE WHEN ${this.getValidResponseSql()} THEN 1 ELSE 0 END) AS "validCount",
            SUM(CASE WHEN analysis_rows."value" IS NULL OR analysis_rows."value" = '' THEN 1 ELSE 0 END) AS "emptyCount",
            COUNT(DISTINCT COALESCE(analysis_rows."value", '')) AS "distinctValueCount"
          FROM (${analysisSql.sql}) analysis_rows
          GROUP BY analysis_rows."unitName", analysis_rows."variableId"
        `,
        analysisSql.parameters
      );

      for (const row of summaryRows) {
        const scopeEntry = this.getScopeEntryForRow(
          scopeByLogicalKey,
          row.unitName,
          row.variableId
        );
        const combo = scopeEntry ? comboByKey.get(scopeEntry.comboKey) : undefined;

        if (combo) {
          combo.totalCount = this.parseCount(row.totalCount);
          combo.validCount = this.parseCount(row.validCount);
          combo.invalidCount = Math.max(0, combo.totalCount - combo.validCount);
          combo.emptyCount = this.parseCount(row.emptyCount);
          combo.distinctValueCount = this.parseCount(row.distinctValueCount);
        }
      }

      await job.progress(40);

      const maxValuesParameter = `$${analysisSql.parameters.length + 1}`;
      const maxValuePreviewLengthParameter = `$${analysisSql.parameters.length + 2}`;
      const valueRows = await this.responseRepository.query(
        `
          SELECT
            ranked_values."unitName",
            ranked_values."variableId",
            LEFT(ranked_values."value", ${maxValuePreviewLengthParameter}) AS "value",
            LENGTH(ranked_values."value") AS "valueLength",
            md5(ranked_values."value") AS "valueHash",
            ranked_values."count",
            ranked_values."validCount",
            ranked_values."rank"
          FROM (
            SELECT
              grouped_values.*,
              ROW_NUMBER() OVER (
                PARTITION BY grouped_values."unitName", grouped_values."variableId"
                ORDER BY grouped_values."count" DESC, grouped_values."value" ASC
              ) AS "rank"
            FROM (
              SELECT
                analysis_rows."unitName" AS "unitName",
                analysis_rows."variableId" AS "variableId",
                COALESCE(analysis_rows."value", '') AS "value",
                COUNT(*) AS "count",
                SUM(CASE WHEN ${this.getValidResponseSql()} THEN 1 ELSE 0 END) AS "validCount"
              FROM (${analysisSql.sql}) analysis_rows
              GROUP BY
                analysis_rows."unitName",
                analysis_rows."variableId",
                COALESCE(analysis_rows."value", '')
            ) grouped_values
          ) ranked_values
          WHERE ranked_values."rank" <= ${maxValuesParameter}
          ORDER BY ranked_values."unitName" ASC, ranked_values."variableId" ASC, ranked_values."count" DESC
        `,
        [...analysisSql.parameters, this.MAX_VALUES_PER_VARIABLE, this.MAX_VALUE_PREVIEW_LENGTH]
      );

      for (const row of valueRows) {
        const scopeEntry = this.getScopeEntryForRow(
          scopeByLogicalKey,
          row.unitName,
          row.variableId
        );
        const combo = scopeEntry ? comboByKey.get(scopeEntry.comboKey) : undefined;

        if (combo && scopeEntry) {
          const count = this.parseCount(row.count);
          const validOccurrenceCount = this.parseCount(row.validCount);
          frequencies[scopeEntry.comboKey].push({
            unitId: combo.unitId,
            unitName: row.unitName,
            variableId: row.variableId,
            value: this.formatValuePreview(
              row.value || '',
              this.parseCount(row.valueLength),
              row.valueHash
            ),
            count,
            validOccurrenceCount,
            percentage: 0
          });
        }
      }

      const multipleObservedCounts =
        await this.recalculateMultipleVariableFrequencies(
          query,
          scopeEntries,
          frequencies,
          metadataByComboKey
        );

      await this.addSchemaCodeFrequencies(
        query,
        scopeEntries,
        frequencies,
        categoryDefinitionsByComboKey,
        multipleObservedCounts
      );

      this.applyFrequencyPercentages(variableCombos, frequencies);

      await job.progress(70);

      const statusRows = await this.responseRepository.query(
        `
          SELECT
            analysis_rows."unitName" AS "unitName",
            analysis_rows."variableId" AS "variableId",
            analysis_rows."status" AS "status",
            COUNT(*) AS "count"
          FROM (${analysisSql.sql}) analysis_rows
          GROUP BY
            analysis_rows."unitName",
            analysis_rows."variableId",
            analysis_rows."status"
          ORDER BY
            analysis_rows."unitName" ASC,
            analysis_rows."variableId" ASC,
            COUNT(*) DESC
        `,
        analysisSql.parameters
      );

      for (const row of statusRows) {
        const scopeEntry = this.getScopeEntryForRow(
          scopeByLogicalKey,
          row.unitName,
          row.variableId
        );
        const combo = scopeEntry ? comboByKey.get(scopeEntry.comboKey) : undefined;

        if (combo) {
          const count = this.parseCount(row.count);
          const totalResponses = combo.totalCount || 0;
          combo.statusCounts = [
            ...(combo.statusCounts || []),
            {
              status: Number(row.status ?? 0),
              count,
              percentage: totalResponses > 0 ? (count / totalResponses) * 100 : 0
            }
          ];
        }
      }

      await job.progress(100);
      this.logger.log(`Job ${job.id} completed successfully`);

      return await this.cacheAndReturnMetadata(job, cacheKey, {
        variableCombos,
        frequencies,
        total
      });
    } catch (error) {
      this.logger.error(`Error processing job ${job.id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  private async cacheAndReturnMetadata(
    job: Job<VariableAnalysisJobData>,
    cacheKey: string,
    result: VariableAnalysisResultDto
  ): Promise<VariableAnalysisJobResult> {
    const manifest = await this.storeResultInChunks(cacheKey, result, job.data.workspaceId);

    if (!manifest) {
      throw new Error(`Failed to cache variable analysis result for job ${job.id}`);
    }

    return {
      cacheKey,
      workspaceId: job.data.workspaceId,
      total: result.total,
      storage: manifest.storage,
      variableComboChunks: manifest.variableComboChunks,
      frequencyChunks: manifest.frequencyChunks,
      storedAt: manifest.storedAt
    };
  }

  private async storeResultInChunks(
    cacheKey: string,
    result: VariableAnalysisResultDto,
    workspaceId: number
  ): Promise<VariableAnalysisResultCacheManifest | null> {
    const variableComboChunks = this.chunkArray(result.variableCombos, this.RESULT_CACHE_CHUNK_SIZE);
    const frequencyChunks = this.chunkArray(Object.entries(result.frequencies), this.RESULT_CACHE_CHUNK_SIZE);
    const writtenKeys: string[] = [];
    const manifest: VariableAnalysisResultCacheManifest = {
      storage: 'chunked',
      workspaceId,
      total: result.total,
      variableComboChunks: variableComboChunks.length,
      frequencyChunks: frequencyChunks.length,
      storedAt: new Date().toISOString()
    };

    try {
      for (let index = 0; index < variableComboChunks.length; index += 1) {
        const chunkKey = this.getVariableComboChunkKey(cacheKey, index);
        const stored = await this.cacheService.set(
          chunkKey,
          variableComboChunks[index],
          this.RESULT_CACHE_TTL_SECONDS
        );
        if (!stored) {
          return await this.cleanupFailedChunkedWrite(writtenKeys, cacheKey);
        }
        writtenKeys.push(chunkKey);
      }

      for (let index = 0; index < frequencyChunks.length; index += 1) {
        const chunkKey = this.getFrequencyChunkKey(cacheKey, index);
        const stored = await this.cacheService.set(
          chunkKey,
          frequencyChunks[index],
          this.RESULT_CACHE_TTL_SECONDS
        );
        if (!stored) {
          return await this.cleanupFailedChunkedWrite(writtenKeys, cacheKey);
        }
        writtenKeys.push(chunkKey);
      }

      const storedManifest = await this.cacheService.set(
        cacheKey,
        manifest,
        this.RESULT_CACHE_TTL_SECONDS
      );
      if (!storedManifest) {
        return await this.cleanupFailedChunkedWrite(writtenKeys, cacheKey);
      }

      return manifest;
    } catch (error) {
      this.logger.error(
        `Failed to store variable analysis result chunks for ${cacheKey}: ${error.message}`,
        error.stack
      );
      await this.cleanupFailedChunkedWrite(writtenKeys, cacheKey);
      return null;
    }
  }

  private async cleanupFailedChunkedWrite(writtenKeys: string[], manifestKey: string): Promise<null> {
    await Promise.all([
      ...writtenKeys.map(key => this.cacheService.delete(key)),
      this.cacheService.delete(manifestKey)
    ]);
    return null;
  }

  private chunkArray<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
      chunks.push(items.slice(index, index + size));
    }
    return chunks;
  }

  private getVariableComboChunkKey(cacheKey: string, index: number): string {
    return `${cacheKey}:variable-combos:${index}`;
  }

  private getFrequencyChunkKey(cacheKey: string, index: number): string {
    return `${cacheKey}:frequencies:${index}`;
  }

  private createResultCacheKey(workspaceId: number, jobId: Job['id']): string {
    return `variable-analysis:${workspaceId}:${jobId}`;
  }

  private formatValuePreview(value: string, valueLength: number, valueHash?: string): string {
    if (!Number.isFinite(valueLength) || valueLength <= this.MAX_VALUE_PREVIEW_LENGTH) {
      return value;
    }

    return `${value}... [truncated ${valueLength} chars, md5:${valueHash || 'unknown'}]`;
  }

  private parseCount(value: unknown): number {
    const parsed = parseInt(String(value), 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private getValidResponseSql(alias = 'analysis_rows'): string {
    const ignoredStatuses =
      this.INVALID_OR_MISSING_VALID_DENOMINATOR_STATUSES.join(', ');

    return `(
      (
        (
          ${alias}."statusV1" IS NOT NULL
          OR ${alias}."codeV1" IS NOT NULL
          OR ${alias}."scoreV1" IS NOT NULL
        )
        AND COALESCE(${alias}."statusV1", 0) NOT IN (${ignoredStatuses})
      )
      OR (
        ${alias}."statusV1" IS NULL
        AND ${alias}."codeV1" IS NULL
        AND ${alias}."scoreV1" IS NULL
        AND ${alias}."value" IS NOT NULL
        AND ${alias}."value" <> ''
        AND COALESCE(${alias}."status", 0) NOT IN (${ignoredStatuses})
      )
    )`;
  }

  private isValidAnalysisRow(row: {
    value: string | null;
    status: string | number | null;
    statusV1: string | number | null;
    codeV1: string | number | null;
    scoreV1: string | number | null;
  }): boolean {
    const hasCodingInfo =
      (row.statusV1 !== null && row.statusV1 !== undefined) ||
      (row.codeV1 !== null && row.codeV1 !== undefined) ||
      (row.scoreV1 !== null && row.scoreV1 !== undefined);

    if (hasCodingInfo) {
      return this.isValidStatus(row.statusV1);
    }

    const value = String(row.value || '').trim();
    if (this.isEmptyStoredValue(value)) {
      return false;
    }

    return this.isValidStatus(row.status);
  }

  private isValidStatus(status: string | number | null): boolean {
    const numericStatus = Number(status ?? 0);
    return !this.INVALID_OR_MISSING_VALID_DENOMINATOR_STATUSES.includes(
      numericStatus
    );
  }

  private applyFrequencyPercentages(
    variableCombos: VariableCombo[],
    frequencies: Record<string, VariableFrequencyDto[]>
  ): void {
    variableCombos.forEach(combo => {
      const comboKey = `${combo.unitId}:${combo.variableId}`;
      const totalResponses = combo.totalCount || 0;
      const validResponses = combo.validCount || 0;
      combo.invalidCount = Math.max(0, totalResponses - validResponses);
      combo.emptyPercentage = totalResponses > 0 ?
        ((combo.emptyCount || 0) / totalResponses) * 100 :
        0;

      frequencies[comboKey] = (frequencies[comboKey] || []).map(item => {
        const validOccurrenceCount = item.validOccurrenceCount ?? item.count;
        const percentageTotal = totalResponses > 0 ?
          (item.count / totalResponses) * 100 :
          0;
        const percentageValid = validResponses > 0 ?
          (validOccurrenceCount / validResponses) * 100 :
          null;

        return {
          ...item,
          validOccurrenceCount,
          percentage: percentageTotal,
          percentageTotal,
          percentageValid
        };
      });
    });
  }

  private async getAnalysisScope(
    workspaceId: number,
    query: SelectQueryBuilder<ResponseEntity>,
    options: VariableAnalysisScopeOptions
  ): Promise<AnalyzedVariableScopeEntry[]> {
    const unitVariableDetails =
      await this.workspaceFilesService.getUnitVariableDetails(workspaceId);

    if (unitVariableDetails.length === 0) {
      return [];
    }

    const representativeUnitIds =
      await this.getRepresentativeUnitIdsByUnitName(query);
    const allowedUnitNames = new Set(representativeUnitIds.keys());

    if (allowedUnitNames.size === 0) {
      return [];
    }
    const normalizedVariableFilter = options.variableId?.trim().toLowerCase();
    const syntheticUnitIds = new Map<string, number>();
    let nextSyntheticUnitId = -1;

    const getUnitId = (normalizedUnitName: string): number => {
      const observedUnitId = representativeUnitIds.get(normalizedUnitName);
      if (observedUnitId !== undefined) {
        return observedUnitId;
      }

      const existingSyntheticUnitId = syntheticUnitIds.get(normalizedUnitName);
      if (existingSyntheticUnitId !== undefined) {
        return existingSyntheticUnitId;
      }

      const syntheticUnitId = nextSyntheticUnitId;
      nextSyntheticUnitId -= 1;
      syntheticUnitIds.set(normalizedUnitName, syntheticUnitId);
      return syntheticUnitId;
    };

    const entries: AnalyzedVariableScopeEntry[] = [];
    const seenLogicalKeys = new Set<string>();

    unitVariableDetails.forEach(details => {
      const unitName = String(details.unitName || '').trim();
      const normalizedUnitName = this.normalizeUnitName(unitName);

      if (!unitName) {
        return;
      }

      if (!allowedUnitNames.has(normalizedUnitName)) {
        return;
      }

      details.variables.forEach(variable => {
        if (!this.isAnalyzableVariable(variable)) {
          return;
        }

        const variableAlias = String(variable.alias || variable.id || '').trim();
        const sourceVariableId = String(variable.id || variableAlias).trim();

        if (!variableAlias) {
          return;
        }

        if (
          normalizedVariableFilter &&
          !variableAlias.toLowerCase().includes(normalizedVariableFilter) &&
          !sourceVariableId.toLowerCase().includes(normalizedVariableFilter)
        ) {
          return;
        }

        const logicalKey = this.getLogicalKey(unitName, variableAlias);
        if (seenLogicalKeys.has(logicalKey)) {
          return;
        }
        seenLogicalKeys.add(logicalKey);

        const unitId = getUnitId(normalizedUnitName);
        const metadata = this.getVariableMetadata(variable);
        const combo: VariableCombo = {
          unitId,
          unitName,
          variableId: variableAlias,
          sourceVariableId,
          variableAlias: variableAlias !== sourceVariableId ?
            variableAlias :
            undefined,
          selectionSource: this.getSelectionSource(variable),
          sourceType: variable.sourceType,
          isDerived: variable.isDerived,
          hasCodingScheme: variable.hasCodingScheme,
          totalCount: 0,
          emptyCount: 0,
          emptyPercentage: 0,
          distinctValueCount: 0,
          statusCounts: []
        };

        entries.push({
          combo,
          comboKey: this.getComboKey(combo),
          logicalKey,
          multiple: metadata.multiple,
          categoryDefinitions: metadata.categoryDefinitions,
          valuesByPosition: metadata.valuesByPosition
        });
      });
    });

    return entries.sort((a, b) => (
      a.combo.unitName.localeCompare(b.combo.unitName, 'de', {
        numeric: true,
        sensitivity: 'base'
      }) ||
      a.combo.variableId.localeCompare(b.combo.variableId, 'de', {
        numeric: true,
        sensitivity: 'base'
      })
    ));
  }

  private async getRepresentativeUnitIdsByUnitName(
    query: SelectQueryBuilder<ResponseEntity>
  ): Promise<Map<string, number>> {
    const rows = await query.clone()
      .select('unit.name', 'unitName')
      .addSelect('MIN(unit.id)', 'unitId')
      .groupBy('unit.name')
      .getRawMany();

    return new Map(
      rows
        .filter(row => row.unitName !== undefined && row.unitName !== null)
        .map(row => [
          this.normalizeUnitName(row.unitName),
          Number(row.unitId)
        ])
        .filter(([, unitId]) => Number.isFinite(unitId)) as [string, number][]
    );
  }

  private getVariableMetadata(
    variable: VariableDetailDto
  ): VariableAnalysisMetadata {
    const seenValues = new Set<string>();
    const categoryDefinitions = (variable.codes || []).reduce<SchemaCodeInfo[]>(
      (items, code) => {
        const value = String(code.id);
        if (seenValues.has(value)) {
          return items;
        }
        seenValues.add(value);
        items.push({
          value,
          label: code.label,
          score: code.score,
          order: items.length
        });
        return items;
      },
      []
    );

    (variable.values || []).forEach(valueInfo => {
      const value = String(valueInfo.value);
      if (seenValues.has(value)) {
        return;
      }
      seenValues.add(value);
      categoryDefinitions.push({
        value,
        label: valueInfo.label,
        order: categoryDefinitions.length
      });
    });

    const variableValues = variable.values || [];
    const valuePositionLabels = variable.valuePositionLabels || [];
    const positionCount = Math.max(
      variableValues.length,
      valuePositionLabels.length
    );
    const valuesByPosition: SchemaCodeInfo[] = [];
    Array.from({ length: positionCount }).forEach((_, index) => {
      const variableValue = variableValues[index]?.value;
      const label =
        valuePositionLabels[index] ||
        variableValues[index]?.label ||
        String(variableValue ?? index + 1);
      valuesByPosition.push({
        value: variableValue !== undefined ?
          String(variableValue) :
          String(index + 1),
        label,
        order: index
      });
    });

    valuesByPosition.forEach(positionValue => {
      if (seenValues.has(positionValue.value)) {
        return;
      }
      seenValues.add(positionValue.value);
      categoryDefinitions.push({
        ...positionValue,
        order: categoryDefinitions.length
      });
    });

    return {
      multiple: variable.multiple === true,
      categoryDefinitions,
      valuesByPosition
    };
  }

  private getVariableMetadataByComboKey(
    scopeEntries: AnalyzedVariableScopeEntry[]
  ): Map<string, VariableAnalysisMetadata> {
    return new Map(
      scopeEntries.map(entry => [
        entry.comboKey,
        {
          multiple: entry.multiple,
          categoryDefinitions: entry.categoryDefinitions,
          valuesByPosition: entry.valuesByPosition
        }
      ])
    );
  }

  private getSelectionSource(variable: VariableDetailDto): string {
    if (variable.isDerived) {
      return variable.hasCodingScheme ?
        'coding-scheme-derived' :
        'unit-metadata-derived';
    }

    return variable.hasCodingScheme ? 'coding-scheme' : 'unit-metadata';
  }

  private isAnalyzableVariable(variable: VariableDetailDto): boolean {
    if (variable.type === 'no-value') {
      return false;
    }

    if (variable.sourceType === 'BASE_NO_VALUE') {
      return false;
    }

    return !(variable.isDerived === true && variable.sourceType === 'BASE');
  }

  private getDedupedAnalysisSql(
    query: SelectQueryBuilder<ResponseEntity>,
    logicalKeys: string[]
  ): AnalysisSql {
    const analysisRowsQuery = query.clone()
      .select('response.id', 'responseId')
      .addSelect('unit.name', 'unitName')
      .addSelect('response.variableid', 'variableId')
      .addSelect('response.value', 'value')
      .addSelect('response.status', 'status')
      .addSelect('response.status_v1', 'statusV1')
      .addSelect('response.code_v1', 'codeV1')
      .addSelect('response.score_v1', 'scoreV1')
      .addSelect(
        `
          ROW_NUMBER() OVER (
            PARTITION BY
              person.id,
              booklet.id,
              unit.name,
              response.variableid,
              COALESCE(response.subform, '')
            ORDER BY
              CASE WHEN response.value IS NULL OR response.value = '' THEN 1 ELSE 0 END ASC,
              response.id DESC
          )
        `,
        'analysisRank'
      );
    const [sourceSql, sourceParameters] =
      analysisRowsQuery.getQueryAndParameters();

    if (logicalKeys.length === 0) {
      return {
        sql: `SELECT * FROM (${sourceSql}) analysis_source WHERE 1 = 0`,
        parameters: sourceParameters
      };
    }

    const logicalKeysParameter = `$${sourceParameters.length + 1}`;
    return {
      sql: `
        SELECT *
        FROM (${sourceSql}) analysis_source
        WHERE analysis_source."analysisRank" = 1
          AND CONCAT(
            UPPER(analysis_source."unitName"),
            CHR(31),
            analysis_source."variableId"
          ) = ANY(${logicalKeysParameter})
      `,
      parameters: [...sourceParameters, logicalKeys]
    };
  }

  private getScopeEntryForRow(
    scopeByLogicalKey: Map<string, AnalyzedVariableScopeEntry>,
    unitName: string,
    variableId: string
  ): AnalyzedVariableScopeEntry | undefined {
    return scopeByLogicalKey.get(this.getLogicalKey(unitName, variableId));
  }

  private getComboKey(combo: Pick<VariableCombo, 'unitId' | 'variableId'>): string {
    return `${combo.unitId}:${combo.variableId}`;
  }

  private normalizeUnitName(unitName: string | null | undefined): string {
    return String(unitName || '').trim().toUpperCase();
  }

  private normalizeVariableId(variableId: string | null | undefined): string {
    return String(variableId || '').trim();
  }

  private getLogicalKey(unitName: string, variableId: string): string {
    return `${this.normalizeUnitName(unitName)}\u001F${this.normalizeVariableId(variableId)}`;
  }

  private getCategoryDefinitionsByComboKey(
    metadataByComboKey: Map<string, VariableAnalysisMetadata>
  ): Map<string, SchemaCodeInfo[]> {
    const categoryDefinitionsByComboKey = new Map<string, SchemaCodeInfo[]>();

    metadataByComboKey.forEach((metadata, comboKey) => {
      if (metadata.categoryDefinitions.length > 0) {
        categoryDefinitionsByComboKey.set(
          comboKey,
          metadata.categoryDefinitions
        );
      }
    });

    return categoryDefinitionsByComboKey;
  }

  private async recalculateMultipleVariableFrequencies(
    query: SelectQueryBuilder<ResponseEntity>,
    scopeEntries: AnalyzedVariableScopeEntry[],
    frequencies: Record<string, VariableFrequencyDto[]>,
    metadataByComboKey: Map<string, VariableAnalysisMetadata>
  ): Promise<MultipleResponseObservedCounts> {
    const multipleEntries = scopeEntries.filter(entry => (
      Boolean(metadataByComboKey.get(entry.comboKey)?.multiple)
    ));
    const observedCounts: MultipleResponseObservedCounts = {
      countsByComboKey: new Map<string, Map<string, number>>(),
      validCountsByComboKey: new Map<string, Map<string, number>>()
    };

    if (multipleEntries.length === 0) {
      return observedCounts;
    }

    const summariesByComboKey = new Map<string, MultipleResponseSummary>();
    const scopeByLogicalKey = new Map(
      multipleEntries.map(entry => [entry.logicalKey, entry])
    );

    multipleEntries.forEach(entry => {
      summariesByComboKey.set(entry.comboKey, {
        totalCount: 0,
        validCount: 0,
        emptyCount: 0,
        counts: new Map<string, number>(),
        validCounts: new Map<string, number>(),
        categories: new Map<string, ParsedMultipleCategory>()
      });
    });

    for (
      let index = 0;
      index < multipleEntries.length;
      index += this.MULTIPLE_RESPONSE_COMBO_CHUNK_SIZE
    ) {
      const comboChunk = multipleEntries.slice(
        index,
        index + this.MULTIPLE_RESPONSE_COMBO_CHUNK_SIZE
      );
      const analysisSql = this.getDedupedAnalysisSql(
        query,
        comboChunk.map(entry => entry.logicalKey)
      );
      let lastResponseId: string | number = 0;
      let hasMoreRows = true;

      while (hasMoreRows) {
        const lastResponseIdParameter =
          `$${analysisSql.parameters.length + 1}`;
        const limitParameter = `$${analysisSql.parameters.length + 2}`;
        const responseRows: MultipleResponseRow[] =
          await this.responseRepository.query(
            `
              SELECT
                analysis_rows."responseId" AS "responseId",
                analysis_rows."unitName" AS "unitName",
                analysis_rows."variableId" AS "variableId",
                analysis_rows."value" AS "value",
                analysis_rows."status" AS "status",
                analysis_rows."statusV1" AS "statusV1",
                analysis_rows."codeV1" AS "codeV1",
                analysis_rows."scoreV1" AS "scoreV1"
              FROM (${analysisSql.sql}) analysis_rows
              WHERE analysis_rows."responseId" > ${lastResponseIdParameter}
              ORDER BY analysis_rows."responseId" ASC
              LIMIT ${limitParameter}
            `,
            [
              ...analysisSql.parameters,
              lastResponseId,
              this.MULTIPLE_RESPONSE_ROW_BATCH_SIZE
            ]
          );

        responseRows.forEach(row => this.addMultipleResponseRowToSummary(
          row,
          scopeByLogicalKey,
          metadataByComboKey,
          summariesByComboKey
        ));

        const lastRow = responseRows[responseRows.length - 1];
        const nextLastResponseId = lastRow?.responseId;
        const hasNextLastResponseId =
          nextLastResponseId !== undefined && nextLastResponseId !== null;

        if (hasNextLastResponseId) {
          lastResponseId = nextLastResponseId;
        }

        hasMoreRows =
          responseRows.length === this.MULTIPLE_RESPONSE_ROW_BATCH_SIZE &&
          hasNextLastResponseId;
      }
    }

    multipleEntries.forEach(entry => {
      const combo = entry.combo;
      const summary = summariesByComboKey.get(entry.comboKey);

      if (!summary) {
        return;
      }

      combo.totalCount = summary.totalCount;
      combo.validCount = summary.validCount;
      combo.invalidCount = Math.max(0, summary.totalCount - summary.validCount);
      combo.emptyCount = summary.emptyCount;
      combo.distinctValueCount = summary.counts.size;
      observedCounts.countsByComboKey.set(entry.comboKey, summary.counts);
      observedCounts.validCountsByComboKey.set(
        entry.comboKey,
        summary.validCounts
      );

      const sortedValues = Array.from(summary.counts.entries())
        .sort(([valueA, countA], [valueB, countB]) => {
          if (countA !== countB) {
            return countB - countA;
          }
          return valueA.localeCompare(valueB);
        })
        .slice(0, this.MAX_VALUES_PER_VARIABLE);

      frequencies[entry.comboKey] = sortedValues.map(([value, count]) => {
        const category = summary.categories.get(value);
        return {
          unitId: combo.unitId,
          unitName: combo.unitName,
          variableId: combo.variableId,
          value,
          label: category?.label,
          score: category?.score,
          schemaOrder: category?.schemaOrder,
          count,
          validOccurrenceCount: summary.validCounts.get(value) || 0,
          percentage: 0
        };
      });
    });

    return observedCounts;
  }

  private addMultipleResponseRowToSummary(
    row: MultipleResponseRow,
    scopeByLogicalKey: Map<string, AnalyzedVariableScopeEntry>,
    metadataByComboKey: Map<string, VariableAnalysisMetadata>,
    summariesByComboKey: Map<string, MultipleResponseSummary>
  ): void {
    const scopeEntry = scopeByLogicalKey.get(
      this.getLogicalKey(row.unitName, row.variableId)
    );
    const comboKey = scopeEntry?.comboKey;
    if (!comboKey) {
      return;
    }
    const metadata = metadataByComboKey.get(comboKey);
    const summary = summariesByComboKey.get(comboKey);

    if (!metadata || !summary) {
      return;
    }

    summary.totalCount += 1;
    const isValidResponse = this.isValidAnalysisRow(row);
    if (isValidResponse) {
      summary.validCount += 1;
    }
    const categories = this.parseMultipleResponseCategories(
      row.value,
      metadata
    );

    if (categories.length === 0) {
      summary.emptyCount += 1;
      return;
    }

    const uniqueCategories = new Map<string, ParsedMultipleCategory>();
    categories.forEach(category => {
      if (!uniqueCategories.has(category.value)) {
        uniqueCategories.set(category.value, category);
      }
    });

    uniqueCategories.forEach(category => {
      summary.counts.set(
        category.value,
        (summary.counts.get(category.value) || 0) + 1
      );
      if (isValidResponse) {
        summary.validCounts.set(
          category.value,
          (summary.validCounts.get(category.value) || 0) + 1
        );
      }
      summary.categories.set(category.value, category);
    });
  }

  private parseMultipleResponseCategories(
    rawValue: string | null,
    metadata: VariableAnalysisMetadata
  ): ParsedMultipleCategory[] {
    const value = rawValue || '';
    const trimmedValue = value.trim();

    if (this.isEmptyStoredValue(trimmedValue)) {
      return [];
    }

    try {
      const parsedValue = JSON.parse(trimmedValue);

      if (Array.isArray(parsedValue)) {
        return this.parseMultipleArrayValue(parsedValue, metadata);
      }

      return this.valueToCategory(parsedValue, metadata);
    } catch {
      return this.valueToCategory(trimmedValue, metadata);
    }
  }

  private parseMultipleArrayValue(
    value: unknown[],
    metadata: VariableAnalysisMetadata
  ): ParsedMultipleCategory[] {
    if (value.length === 0) {
      return [];
    }

    if (value.every(item => typeof item === 'boolean')) {
      return value.flatMap((item, index) => {
        if (item === true) {
          return [this.positionToCategory(index, metadata)];
        }

        return [];
      });
    }

    return value.flatMap(item => this.valueToCategory(item, metadata));
  }

  private positionToCategory(
    index: number,
    metadata: VariableAnalysisMetadata
  ): ParsedMultipleCategory {
    const positionValue = metadata.valuesByPosition[index];
    const fallbackValue = String(index + 1);
    const value = positionValue?.value || fallbackValue;

    return {
      value,
      label: positionValue?.label || this.getCategoryDefinition(value, metadata)?.label,
      score: positionValue?.score ?? this.getCategoryDefinition(value, metadata)?.score,
      schemaOrder: positionValue?.order ?? this.getCategoryDefinition(value, metadata)?.order
    };
  }

  private valueToCategory(
    value: unknown,
    metadata: VariableAnalysisMetadata
  ): ParsedMultipleCategory[] {
    if (value === null || value === undefined) {
      return [];
    }

    const normalizedValue = typeof value === 'object' ?
      JSON.stringify(value) :
      String(value);

    if (this.isEmptyStoredValue(normalizedValue.trim())) {
      return [];
    }

    const definition = this.getCategoryDefinition(normalizedValue, metadata);

    return [{
      value: this.formatDirectValuePreview(normalizedValue),
      label: definition?.label,
      score: definition?.score,
      schemaOrder: definition?.order
    }];
  }

  private getCategoryDefinition(
    value: string,
    metadata: VariableAnalysisMetadata
  ): SchemaCodeInfo | undefined {
    return metadata.categoryDefinitions.find(
      definition => definition.value === value
    );
  }

  private isEmptyStoredValue(value: string): boolean {
    return value === '' || value.toLowerCase() === 'null';
  }

  private formatDirectValuePreview(value: string): string {
    if (value.length <= this.MAX_VALUE_PREVIEW_LENGTH) {
      return value;
    }

    return `${value.slice(0, this.MAX_VALUE_PREVIEW_LENGTH)}... [truncated ${value.length} chars]`;
  }

  private async addSchemaCodeFrequencies(
    query: SelectQueryBuilder<ResponseEntity>,
    scopeEntries: AnalyzedVariableScopeEntry[],
    frequencies: Record<string, VariableFrequencyDto[]>,
    schemaCodesByComboKey: Map<string, SchemaCodeInfo[]>,
    observedCountsOverride: MultipleResponseObservedCounts = {
      countsByComboKey: new Map<string, Map<string, number>>(),
      validCountsByComboKey: new Map<string, Map<string, number>>()
    }
  ): Promise<void> {
    if (schemaCodesByComboKey.size === 0) {
      return;
    }

    const observedSchemaCounts = await this.getObservedSchemaValueCounts(
      query,
      scopeEntries,
      schemaCodesByComboKey
    );

    scopeEntries.forEach(entry => {
      const combo = entry.combo;
      const schemaCodes = schemaCodesByComboKey.get(entry.comboKey);
      if (!schemaCodes?.length) {
        return;
      }

      const rows = frequencies[entry.comboKey] || [];
      const rowsByValue = new Map(rows.map(row => [row.value, row]));
      const observedCountsForCombo = observedCountsOverride.countsByComboKey
        .get(entry.comboKey) ||
        observedSchemaCounts.get(entry.comboKey) ||
        new Map<string, FrequencyCounts>();
      const observedValidCountsForCombo =
        observedCountsOverride.validCountsByComboKey.get(entry.comboKey);

      schemaCodes.forEach(schemaCode => {
        const existingRow = rowsByValue.get(schemaCode.value);
        const observedCounts = observedCountsForCombo.get(schemaCode.value);
        const count = typeof observedCounts === 'number' ?
          observedCounts :
          observedCounts?.count || 0;
        let validOccurrenceCount = 0;
        if (observedValidCountsForCombo) {
          validOccurrenceCount =
            observedValidCountsForCombo.get(schemaCode.value) || 0;
        } else if (typeof observedCounts !== 'number') {
          validOccurrenceCount = observedCounts?.validCount || 0;
        }

        if (existingRow) {
          existingRow.label = schemaCode.label;
          existingRow.score = schemaCode.score;
          existingRow.schemaOrder = schemaCode.order;
          existingRow.validOccurrenceCount =
            existingRow.validOccurrenceCount ?? validOccurrenceCount;
          return;
        }

        rows.push({
          unitId: combo.unitId,
          unitName: combo.unitName,
          variableId: combo.variableId,
          value: schemaCode.value,
          label: schemaCode.label,
          score: schemaCode.score,
          schemaOrder: schemaCode.order,
          isSchemaOnly: count === 0,
          isSchemaSupplemental: true,
          count,
          validOccurrenceCount,
          percentage: 0
        });
      });

      frequencies[entry.comboKey] = rows;
    });
  }

  private async getObservedSchemaValueCounts(
    query: SelectQueryBuilder<ResponseEntity>,
    scopeEntries: AnalyzedVariableScopeEntry[],
    schemaCodesByComboKey: Map<string, SchemaCodeInfo[]>
  ): Promise<Map<string, Map<string, FrequencyCounts>>> {
    const countsByComboKey =
      new Map<string, Map<string, FrequencyCounts>>();
    const entriesWithSchemaCodes = scopeEntries.filter(entry => (
      (schemaCodesByComboKey.get(entry.comboKey)?.length || 0) > 0
    ));
    const scopeByLogicalKey = new Map(
      entriesWithSchemaCodes.map(entry => [entry.logicalKey, entry])
    );
    const chunkSize = 100;

    for (let index = 0; index < entriesWithSchemaCodes.length; index += chunkSize) {
      const entryChunk = entriesWithSchemaCodes.slice(index, index + chunkSize);
      const analysisSql = this.getDedupedAnalysisSql(
        query,
        entryChunk.map(entry => entry.logicalKey)
      );
      const schemaValueFilters = entryChunk.flatMap(entry => (
        (schemaCodesByComboKey.get(entry.comboKey) || []).map(schemaCode => ({
          logicalKey: entry.logicalKey,
          value: schemaCode.value
        }))
      ));
      const schemaValueFiltersParameter =
        `$${analysisSql.parameters.length + 1}`;
      const rows: SchemaValueCountRow[] = await this.responseRepository.query(
        `
          SELECT
            analysis_rows."unitName" AS "unitName",
            analysis_rows."variableId" AS "variableId",
            COALESCE(analysis_rows."value", '') AS "value",
            COUNT(*) AS "count",
            SUM(CASE WHEN ${this.getValidResponseSql()} THEN 1 ELSE 0 END) AS "validCount"
          FROM (${analysisSql.sql}) analysis_rows
          INNER JOIN jsonb_to_recordset(${schemaValueFiltersParameter}::jsonb)
            AS schema_filter("logicalKey" text, "value" text)
            ON schema_filter."logicalKey" = CONCAT(
              UPPER(analysis_rows."unitName"),
              CHR(31),
              analysis_rows."variableId"
            )
            AND schema_filter."value" = COALESCE(analysis_rows."value", '')
          GROUP BY
            analysis_rows."unitName",
            analysis_rows."variableId",
            COALESCE(analysis_rows."value", '')
        `,
        [
          ...analysisSql.parameters,
          JSON.stringify(schemaValueFilters)
        ]
      );

      rows.forEach(row => {
        const entry = scopeByLogicalKey.get(
          this.getLogicalKey(row.unitName, row.variableId)
        );
        if (!entry) {
          return;
        }
        const schemaValues = new Set(
          (schemaCodesByComboKey.get(entry.comboKey) || [])
            .map(schemaCode => schemaCode.value)
        );
        const value = row.value || '';
        if (!schemaValues.has(value)) {
          return;
        }
        const valueCounts = countsByComboKey.get(entry.comboKey) ||
          new Map<string, FrequencyCounts>();
        valueCounts.set(value, {
          count: this.parseCount(row.count),
          validCount: this.parseCount(row.validCount)
        });
        countsByComboKey.set(entry.comboKey, valueCounts);
      });
    }

    return countsByComboKey;
  }
}
