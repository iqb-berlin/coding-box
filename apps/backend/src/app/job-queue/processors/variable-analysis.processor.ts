import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository, SelectQueryBuilder } from 'typeorm';
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
  unitId: string | number;
  variableId: string;
  value: string | null;
  count: string | number;
}

interface MultipleResponseRow {
  responseId: string | number;
  unitId: string | number;
  unitName: string;
  variableId: string;
  value: string | null;
}

interface ParsedMultipleCategory {
  value: string;
  label?: string;
  score?: number;
  schemaOrder?: number;
}

interface MultipleResponseSummary {
  totalCount: number;
  emptyCount: number;
  counts: Map<string, number>;
  categories: Map<string, ParsedMultipleCategory>;
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

      // Build the query
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

      if (variableId) {
        query.andWhere('response.variableid LIKE :variableId', { variableId: `%${variableId}%` });
      }

      // Get distinct combinations of unit name and variable ID
      const variableCombosQuery = query.clone()
        .select('unit.id', 'unitId')
        .addSelect('unit.name', 'unitName')
        .addSelect('response.variableid', 'variableId')
        .distinct(true)
        .orderBy('unit.name', 'ASC')
        .addOrderBy('response.variableid', 'ASC');

      // Execute the query to get variable combinations
      const variableCombosResult = await variableCombosQuery.getRawMany();
      const variableCombos: VariableCombo[] = variableCombosResult.map(result => ({
        unitId: Number(result.unitId),
        unitName: result.unitName,
        variableId: result.variableId,
        totalCount: 0,
        emptyCount: 0,
        emptyPercentage: 0,
        distinctValueCount: 0,
        statusCounts: []
      }));

      // If no variable combinations found, return empty result
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
      variableCombos.forEach(combo => {
        const comboKey = `${combo.unitId}:${combo.variableId}`;
        comboByKey.set(comboKey, combo);
        frequencies[comboKey] = [];
      });
      const metadataByComboKey = await this.getVariableMetadataByComboKey(
        workspaceId,
        variableCombos
      );
      const categoryDefinitionsByComboKey = this.getCategoryDefinitionsByComboKey(
        metadataByComboKey
      );

      await job.progress(25);

      const summaryRows = await query.clone()
        .select('unit.id', 'unitId')
        .addSelect('response.variableid', 'variableId')
        .addSelect('COUNT(*)', 'totalCount')
        .addSelect("SUM(CASE WHEN response.value IS NULL OR response.value = '' THEN 1 ELSE 0 END)", 'emptyCount')
        .addSelect("COUNT(DISTINCT COALESCE(response.value, ''))", 'distinctValueCount')
        .groupBy('unit.id')
        .addGroupBy('response.variableid')
        .getRawMany();

      for (const row of summaryRows) {
        const combo = comboByKey.get(`${Number(row.unitId)}:${row.variableId}`);

        if (combo) {
          combo.totalCount = parseInt(row.totalCount, 10);
          combo.emptyCount = parseInt(row.emptyCount, 10);
          combo.distinctValueCount = parseInt(row.distinctValueCount, 10);
        }
      }

      await job.progress(40);

      const topValuesQuery = query.clone()
        .select('unit.id', 'unitId')
        .addSelect('unit.name', 'unitName')
        .addSelect('response.variableid', 'variableId')
        .addSelect("COALESCE(response.value, '')", 'value')
        .addSelect('COUNT(*)', 'count')
        .groupBy('unit.id')
        .addGroupBy('unit.name')
        .addGroupBy('response.variableid')
        .addGroupBy("COALESCE(response.value, '')")
        .orderBy('unit.name', 'ASC')
        .addOrderBy('response.variableid', 'ASC')
        .addOrderBy('count', 'DESC');

      const [topValuesSql, topValuesParameters] = topValuesQuery.getQueryAndParameters();
      const maxValuesParameter = `$${topValuesParameters.length + 1}`;
      const maxValuePreviewLengthParameter = `$${topValuesParameters.length + 2}`;
      const valueRows = await this.responseRepository.query(
        `
          SELECT
            ranked_values."unitId",
            ranked_values."unitName",
            ranked_values."variableId",
            LEFT(ranked_values."value", ${maxValuePreviewLengthParameter}) AS "value",
            LENGTH(ranked_values."value") AS "valueLength",
            md5(ranked_values."value") AS "valueHash",
            ranked_values."count",
            ranked_values."rank"
          FROM (
            SELECT
              grouped_values.*,
              ROW_NUMBER() OVER (
                PARTITION BY grouped_values."unitId", grouped_values."variableId"
                ORDER BY grouped_values."count" DESC, grouped_values."value" ASC
              ) AS "rank"
            FROM (${topValuesSql}) grouped_values
          ) ranked_values
          WHERE ranked_values."rank" <= ${maxValuesParameter}
          ORDER BY ranked_values."unitName" ASC, ranked_values."variableId" ASC, ranked_values."count" DESC
        `,
        [...topValuesParameters, this.MAX_VALUES_PER_VARIABLE, this.MAX_VALUE_PREVIEW_LENGTH]
      );

      for (const row of valueRows) {
        const unitIdNumber = Number(row.unitId);
        const comboKey = `${unitIdNumber}:${row.variableId}`;
        const combo = comboByKey.get(comboKey);

        if (combo) {
          const count = parseInt(row.count, 10);
          frequencies[comboKey].push({
            unitId: unitIdNumber,
            unitName: row.unitName,
            variableId: row.variableId,
            value: this.formatValuePreview(
              row.value || '',
              parseInt(row.valueLength, 10),
              row.valueHash
            ),
            count,
            percentage: 0
          });
        }
      }

      const multipleObservedCountsByComboKey =
        await this.recalculateMultipleVariableFrequencies(
          query,
          variableCombos,
          frequencies,
          metadataByComboKey
        );

      variableCombos.forEach(combo => {
        const comboKey = `${combo.unitId}:${combo.variableId}`;
        const totalResponses = combo.totalCount || 0;
        combo.emptyPercentage = totalResponses > 0 ? ((combo.emptyCount || 0) / totalResponses) * 100 : 0;
        frequencies[comboKey] = frequencies[comboKey].map(item => ({
          ...item,
          percentage: totalResponses > 0 ? (item.count / totalResponses) * 100 : 0
        }));
      });

      await this.addSchemaCodeFrequencies(
        query,
        variableCombos,
        frequencies,
        categoryDefinitionsByComboKey,
        multipleObservedCountsByComboKey
      );

      await job.progress(70);

      const statusRows = await query.clone()
        .select('unit.id', 'unitId')
        .addSelect('response.variableid', 'variableId')
        .addSelect('response.status', 'status')
        .addSelect('COUNT(*)', 'count')
        .groupBy('unit.id')
        .addGroupBy('response.variableid')
        .addGroupBy('response.status')
        .orderBy('unit.id', 'ASC')
        .addOrderBy('response.variableid', 'ASC')
        .addOrderBy('count', 'DESC')
        .getRawMany();

      for (const row of statusRows) {
        const combo = comboByKey.get(`${Number(row.unitId)}:${row.variableId}`);

        if (combo) {
          const count = parseInt(row.count, 10);
          const totalResponses = combo.totalCount || 0;
          combo.statusCounts = [
            ...(combo.statusCounts || []),
            {
              status: Number(row.status),
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

  private async getVariableMetadataByComboKey(
    workspaceId: number,
    variableCombos: VariableCombo[]
  ): Promise<Map<string, VariableAnalysisMetadata>> {
    const metadataByComboKey = new Map<string, VariableAnalysisMetadata>();

    if (variableCombos.length === 0) {
      return metadataByComboKey;
    }

    try {
      const unitVariableDetails =
        await this.workspaceFilesService.getUnitVariableDetails(workspaceId);
      const detailsByUnitName = new Map(
        unitVariableDetails.map(details => [
          details.unitName.toUpperCase(),
          details
        ])
      );

      variableCombos.forEach(combo => {
        const details = detailsByUnitName.get(combo.unitName.toUpperCase());
        if (!details) {
          return;
        }

        const variable = details.variables.find(
          item => item.id === combo.variableId || item.alias === combo.variableId
        );
        if (!variable) {
          return;
        }

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

        metadataByComboKey.set(`${combo.unitId}:${combo.variableId}`, {
          multiple: variable.multiple === true,
          categoryDefinitions,
          valuesByPosition
        });
      });
    } catch (error) {
      this.logger.warn(
        `Could not enrich variable analysis with coding scheme codes: ${error.message}`
      );
    }

    return metadataByComboKey;
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
    variableCombos: VariableCombo[],
    frequencies: Record<string, VariableFrequencyDto[]>,
    metadataByComboKey: Map<string, VariableAnalysisMetadata>
  ): Promise<Map<string, Map<string, number>>> {
    const multipleCombos = variableCombos.filter(combo => {
      const comboKey = `${combo.unitId}:${combo.variableId}`;
      return Boolean(metadataByComboKey.get(comboKey)?.multiple);
    });
    const observedCountsByComboKey = new Map<string, Map<string, number>>();

    if (multipleCombos.length === 0) {
      return observedCountsByComboKey;
    }

    const summariesByComboKey = new Map<string, MultipleResponseSummary>();

    multipleCombos.forEach(combo => {
      const comboKey = `${combo.unitId}:${combo.variableId}`;
      summariesByComboKey.set(comboKey, {
        totalCount: 0,
        emptyCount: 0,
        counts: new Map<string, number>(),
        categories: new Map<string, ParsedMultipleCategory>()
      });
    });

    for (
      let index = 0;
      index < multipleCombos.length;
      index += this.MULTIPLE_RESPONSE_COMBO_CHUNK_SIZE
    ) {
      const comboChunk = multipleCombos.slice(
        index,
        index + this.MULTIPLE_RESPONSE_COMBO_CHUNK_SIZE
      );
      let lastResponseId: string | number = 0;
      let hasMoreRows = true;

      while (hasMoreRows) {
        const responseRows: MultipleResponseRow[] = await query.clone()
          .select('response.id', 'responseId')
          .addSelect('unit.id', 'unitId')
          .addSelect('unit.name', 'unitName')
          .addSelect('response.variableid', 'variableId')
          .addSelect('response.value', 'value')
          .andWhere('response.id > :multipleLastResponseId', {
            multipleLastResponseId: lastResponseId
          })
          .andWhere(new Brackets(qb => {
            comboChunk.forEach((combo, comboIndex) => {
              const params = {
                [`multipleUnitId${comboIndex}`]: combo.unitId,
                [`multipleVariableId${comboIndex}`]: combo.variableId
              };
              const condition =
                `unit.id = :multipleUnitId${comboIndex} ` +
                `AND response.variableid = :multipleVariableId${comboIndex}`;

              if (comboIndex === 0) {
                qb.where(condition, params);
              } else {
                qb.orWhere(condition, params);
              }
            });
          }))
          .orderBy('response.id', 'ASC')
          .limit(this.MULTIPLE_RESPONSE_ROW_BATCH_SIZE)
          .getRawMany();

        responseRows.forEach(row => this.addMultipleResponseRowToSummary(
          row,
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

    multipleCombos.forEach(combo => {
      const comboKey = `${combo.unitId}:${combo.variableId}`;
      const summary = summariesByComboKey.get(comboKey);

      if (!summary) {
        return;
      }

      combo.totalCount = summary.totalCount;
      combo.emptyCount = summary.emptyCount;
      combo.distinctValueCount = summary.counts.size;
      observedCountsByComboKey.set(comboKey, summary.counts);

      const sortedValues = Array.from(summary.counts.entries())
        .sort(([valueA, countA], [valueB, countB]) => {
          if (countA !== countB) {
            return countB - countA;
          }
          return valueA.localeCompare(valueB);
        })
        .slice(0, this.MAX_VALUES_PER_VARIABLE);

      frequencies[comboKey] = sortedValues.map(([value, count]) => {
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
          percentage: 0
        };
      });
    });

    return observedCountsByComboKey;
  }

  private addMultipleResponseRowToSummary(
    row: MultipleResponseRow,
    metadataByComboKey: Map<string, VariableAnalysisMetadata>,
    summariesByComboKey: Map<string, MultipleResponseSummary>
  ): void {
    const comboKey = `${Number(row.unitId)}:${row.variableId}`;
    const metadata = metadataByComboKey.get(comboKey);
    const summary = summariesByComboKey.get(comboKey);

    if (!metadata || !summary) {
      return;
    }

    summary.totalCount += 1;
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
    variableCombos: VariableCombo[],
    frequencies: Record<string, VariableFrequencyDto[]>,
    schemaCodesByComboKey: Map<string, SchemaCodeInfo[]>,
    observedCountsOverrideByComboKey = new Map<string, Map<string, number>>()
  ): Promise<void> {
    if (schemaCodesByComboKey.size === 0) {
      return;
    }

    const observedSchemaCounts = await this.getObservedSchemaValueCounts(
      query,
      variableCombos,
      schemaCodesByComboKey
    );

    variableCombos.forEach(combo => {
      const comboKey = `${combo.unitId}:${combo.variableId}`;
      const schemaCodes = schemaCodesByComboKey.get(comboKey);
      if (!schemaCodes?.length) {
        return;
      }

      const rows = frequencies[comboKey] || [];
      const rowsByValue = new Map(rows.map(row => [row.value, row]));
      const observedCountsForCombo =
        observedCountsOverrideByComboKey.get(comboKey) ||
        observedSchemaCounts.get(comboKey) ||
        new Map<string, number>();
      const totalResponses = combo.totalCount || 0;

      schemaCodes.forEach(schemaCode => {
        const existingRow = rowsByValue.get(schemaCode.value);

        if (existingRow) {
          existingRow.label = schemaCode.label;
          existingRow.score = schemaCode.score;
          existingRow.schemaOrder = schemaCode.order;
          return;
        }

        const count = observedCountsForCombo.get(schemaCode.value) || 0;
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
          percentage: totalResponses > 0 ? (count / totalResponses) * 100 : 0
        });
      });

      frequencies[comboKey] = rows;
    });
  }

  private async getObservedSchemaValueCounts(
    query: SelectQueryBuilder<ResponseEntity>,
    variableCombos: VariableCombo[],
    schemaCodesByComboKey: Map<string, SchemaCodeInfo[]>
  ): Promise<Map<string, Map<string, number>>> {
    const countsByComboKey = new Map<string, Map<string, number>>();
    const combosWithSchemaCodes = variableCombos.filter(combo => {
      const comboKey = `${combo.unitId}:${combo.variableId}`;
      return (schemaCodesByComboKey.get(comboKey)?.length || 0) > 0;
    });
    const chunkSize = 100;

    for (let index = 0; index < combosWithSchemaCodes.length; index += chunkSize) {
      const comboChunk = combosWithSchemaCodes.slice(index, index + chunkSize);
      const schemaCountQuery = query.clone()
        .select('unit.id', 'unitId')
        .addSelect('response.variableid', 'variableId')
        .addSelect("COALESCE(response.value, '')", 'value')
        .addSelect('COUNT(*)', 'count')
        .andWhere(new Brackets(qb => {
          comboChunk.forEach((combo, comboIndex) => {
            const comboKey = `${combo.unitId}:${combo.variableId}`;
            const schemaValues = (schemaCodesByComboKey.get(comboKey) || [])
              .map(schemaCode => schemaCode.value);
            const params = {
              [`schemaUnitId${comboIndex}`]: combo.unitId,
              [`schemaVariableId${comboIndex}`]: combo.variableId,
              [`schemaValues${comboIndex}`]: schemaValues
            };
            const condition =
              `unit.id = :schemaUnitId${comboIndex} ` +
              `AND response.variableid = :schemaVariableId${comboIndex} ` +
              `AND COALESCE(response.value, '') IN (:...schemaValues${comboIndex})`;

            if (comboIndex === 0) {
              qb.where(condition, params);
            } else {
              qb.orWhere(condition, params);
            }
          });
        }))
        .groupBy('unit.id')
        .addGroupBy('response.variableid')
        .addGroupBy("COALESCE(response.value, '')");

      const rows: SchemaValueCountRow[] = await schemaCountQuery.getRawMany();

      rows.forEach(row => {
        const comboKey = `${Number(row.unitId)}:${row.variableId}`;
        const valueCounts = countsByComboKey.get(comboKey) || new Map<string, number>();
        valueCounts.set(row.value || '', parseInt(String(row.count), 10));
        countsByComboKey.set(comboKey, valueCounts);
      });
    }

    return countsByComboKey;
  }
}
