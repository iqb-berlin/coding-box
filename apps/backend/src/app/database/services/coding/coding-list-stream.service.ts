import {
  BadRequestException, Injectable, Logger, Optional
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fastCsv from 'fast-csv';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import archiver = require('archiver');
import { PassThrough, Writable } from 'stream';
// eslint-disable-next-line import/no-cycle
import {
  CodingResponseFilterService,
  ResponseFilterOptions
} from './coding-response-filter.service';
import {
  CodingItemBuilderService,
  CodingItem,
  CodingVariableAnchorMaps,
  CodingItemVersionRow
} from './coding-item-builder.service';
import { CodingFileCacheService } from './coding-file-cache.service';
// eslint-disable-next-line import/no-cycle
import { WorkspaceFilesService } from '../workspace/workspace-files.service';
import {
  buildGeoGebraFileName,
  decodeGeoGebraValue
} from './geogebra-export.util';
import { ResponseEntity } from '../../entities/response.entity';
import { CodingReplayAnchorService } from './coding-replay-anchor.service';
import {
  MissingsProfilesService,
  ResolvedMissingsProfile
} from './missings-profiles.service';
import { resolveV1ExportValue } from './versioned-results-missing-resolver';

interface JsonStream {
  on(event: 'data', listener: (item: CodingItem) => void): void;
  on(event: 'end', listener: () => void): void;
  on(event: 'error', listener: (error: Error) => void): void;
}

type ExportProgressCallback = (
  percentage: number,
  details?: {
    phase?: 'counting' | 'writing' | 'finalizing';
    processedRows?: number;
    totalRows?: number;
  }
) => Promise<void>;

interface VersionedExportProgressState {
  lastReportedRows: number;
  lastReportedAt: number;
}

/**
 * Service responsible for streaming exports of coding data.
 *
 * Handles:
 * - CSV streaming with memory efficiency
 * - Excel export with batching
 * - JSON streaming
 * - Batch processing with backpressure handling
 * - Memory management and garbage collection hints
 */
@Injectable()
export class CodingListStreamService {
  private readonly logger = new Logger(CodingListStreamService.name);
  private static readonly defaultMaxGeoGebraFileCount = 100000;
  private static readonly defaultMaxGeoGebraBytes = 512 * 1024 * 1024;
  private static readonly defaultCodingListExportBatchSize = 500;
  private static readonly defaultVersionedExportBatchSize = 250;
  private static readonly exportYieldEveryRows = 50;
  private static readonly versionedProgressEveryRows = 500;
  private static readonly versionedProgressEveryMs = 1000;

  constructor(
    private readonly responseFilterService: CodingResponseFilterService,
    private readonly itemBuilderService: CodingItemBuilderService,
    private readonly fileCacheService: CodingFileCacheService,
    private readonly workspaceFilesService: WorkspaceFilesService,
    @Optional() private readonly configService?: ConfigService,
    @Optional() private readonly replayAnchorService?: CodingReplayAnchorService,
    @Optional() private readonly missingsProfilesService?: MissingsProfilesService
  ) { }

  private async loadV1ExportProfile(
    workspaceId: number,
    version: 'v1' | 'v2' | 'v3',
    missingsProfileId?: number
  ): Promise<ResolvedMissingsProfile | undefined> {
    if (version !== 'v1') {
      return undefined;
    }
    if (!Number.isSafeInteger(missingsProfileId) || Number(missingsProfileId) <= 0) {
      throw new BadRequestException(
        'Version v1 exports require missingsProfileId to be a positive integer'
      );
    }
    if (!this.missingsProfilesService) {
      throw new BadRequestException('Missings profile service is unavailable');
    }
    return this.missingsProfilesService.getResolvedMissingsProfileForExport(
      workspaceId,
      Number(missingsProfileId),
      ['mir', 'mci', 'mbi_mbo', 'mnr']
    );
  }

  private buildVersionedExportItem(
    row: CodingItemVersionRow,
    version: 'v1' | 'v2' | 'v3',
    authToken: string,
    serverUrl: string,
    workspaceId: number,
    includeReplayUrls: boolean,
    includeResponseValues: boolean,
    includeGeoGebraResponseValues: boolean,
    variableAnchorMaps: CodingVariableAnchorMaps,
    v1ExportProfile?: ResolvedMissingsProfile
  ): Promise<CodingItem | null> {
    if (v1ExportProfile) {
      return this.itemBuilderService.buildCodingItemWithVersionRow(
        row,
        version,
        authToken,
        serverUrl,
        workspaceId,
        includeReplayUrls,
        includeResponseValues,
        includeGeoGebraResponseValues,
        variableAnchorMaps,
        resolveV1ExportValue(row, v1ExportProfile)
      );
    }
    return this.itemBuilderService.buildCodingItemWithVersionRow(
      row,
      version,
      authToken,
      serverUrl,
      workspaceId,
      includeReplayUrls,
      includeResponseValues,
      includeGeoGebraResponseValues,
      variableAnchorMaps
    );
  }

  private getGeoGebraExportLimits(): { maxFileCount: number; maxBytes: number } {
    return {
      maxFileCount: this.getPositiveIntegerConfig(
        'GEOGEBRA_EXPORT_MAX_FILES',
        CodingListStreamService.defaultMaxGeoGebraFileCount
      ),
      maxBytes: this.getPositiveIntegerConfig(
        'GEOGEBRA_EXPORT_MAX_BYTES',
        CodingListStreamService.defaultMaxGeoGebraBytes
      )
    };
  }

  private getPositiveIntegerConfig(key: string, fallback: number): number {
    const rawValue = this.configService?.get<string | number>(key);
    if (rawValue === undefined || rawValue === null || rawValue === '') {
      return fallback;
    }

    const parsedValue = typeof rawValue === 'number' ?
      rawValue :
      Number.parseInt(rawValue, 10);

    return Number.isInteger(parsedValue) && parsedValue > 0 ?
      parsedValue :
      fallback;
  }

  private getCodingListExportBatchSize(): number {
    return this.getPositiveIntegerConfig(
      'EXPORT_CODING_LIST_BATCH_SIZE',
      CodingListStreamService.defaultCodingListExportBatchSize
    );
  }

  private getVersionedExportBatchSize(): number {
    return this.getPositiveIntegerConfig(
      'EXPORT_VERSIONED_BATCH_SIZE',
      CodingListStreamService.defaultVersionedExportBatchSize
    );
  }

  private async yieldToEventLoop(): Promise<void> {
    await new Promise<void>(resolve => {
      setImmediate(resolve);
    });
  }

  private shouldYieldExportRow(rowIndex: number): boolean {
    return rowIndex > 0 &&
      rowIndex % CodingListStreamService.exportYieldEveryRows === 0;
  }

  private isExportCancellationError(error: Error): boolean {
    return /^Export job .* was cancelled$/.test(error.message);
  }

  private getVersionedResponseFilterOptions(version: 'v1' | 'v2' | 'v3'): ResponseFilterOptions {
    return {
      version,
      validCodingVariablesOnly: true,
      givenResponsesOnly: true
    };
  }

  private async countVersionedResponseRows(
    workspaceId: number,
    version: 'v1' | 'v2' | 'v3',
    checkCancellation?: () => Promise<void>
  ): Promise<number> {
    await checkCancellation?.();
    const totalRows = await this.responseFilterService.countResponses(
      workspaceId,
      this.getVersionedResponseFilterOptions(version)
    );
    await checkCancellation?.();
    return totalRows;
  }

  private async reportRowBasedProgress(
    progressCallback: ExportProgressCallback | undefined,
    processedRows: number,
    totalRows: number,
    state?: VersionedExportProgressState,
    force: boolean = false
  ): Promise<void> {
    if (!progressCallback || totalRows <= 0) {
      return;
    }

    const now = Date.now();
    const rowsSinceLastReport = processedRows - (state?.lastReportedRows ?? 0);
    const msSinceLastReport = now - (state?.lastReportedAt ?? 0);

    if (
      !force &&
      rowsSinceLastReport < CodingListStreamService.versionedProgressEveryRows &&
      msSinceLastReport < CodingListStreamService.versionedProgressEveryMs
    ) {
      return;
    }

    const percentage = Math.min(
      99,
      Math.max(1, Math.round((processedRows / totalRows) * 100))
    );
    await progressCallback(percentage, {
      phase: 'writing',
      processedRows,
      totalRows
    });

    if (state) {
      state.lastReportedRows = processedRows;
      state.lastReportedAt = now;
    }
  }

  private async getCodingListFilterContext(
    workspaceId: number,
    trainingRequired?: boolean,
    checkCancellation?: () => Promise<void>
  ): Promise<{
      filterOptions: ResponseFilterOptions;
      trainingRequiredMap: Map<string, Set<string>> | null;
    }> {
    await checkCancellation?.();
    const trainingRequiredMap = await (
      trainingRequired !== undefined ?
        this.workspaceFilesService.getCoderTrainingRequiredVariableMap(workspaceId) :
        Promise.resolve(null)
    );
    await checkCancellation?.();

    return {
      filterOptions: {
        manualCodingCandidatesOnly: true
      },
      trainingRequiredMap
    };
  }

  private async loadVariableAnchorMapsForResponses(
    responses: ResponseEntity[],
    workspaceId: number,
    checkCancellation?: () => Promise<void>
  ): Promise<CodingVariableAnchorMaps> {
    if (!this.replayAnchorService) {
      return new Map();
    }

    await checkCancellation?.();
    const unitNames = Array.from(new Set(
      responses
        .map(response => response.unit?.name || '')
        .filter(unitName => unitName)
    ));

    if (!unitNames.length) {
      return new Map();
    }

    try {
      const anchorMaps = await this.replayAnchorService.getVariableAnchorMaps(unitNames, workspaceId);
      await checkCancellation?.();
      return anchorMaps;
    } catch (error) {
      this.logger.warn(
        `Failed to load replay anchor overrides for workspace ${workspaceId}: ${error.message}`
      );
      return new Map(
        unitNames.map(unitName => [unitName, new Map<string, string>()])
      );
    }
  }

  private async loadVariableAnchorMapsForVersionRows(
    rows: CodingItemVersionRow[],
    workspaceId: number,
    checkCancellation?: () => Promise<void>
  ): Promise<CodingVariableAnchorMaps> {
    if (!this.replayAnchorService) {
      return new Map();
    }

    await checkCancellation?.();
    const unitNames = Array.from(new Set(
      rows
        .map(row => row.unitKey || '')
        .filter(unitName => unitName)
    ));

    if (!unitNames.length) {
      return new Map();
    }

    try {
      const anchorMaps = await this.replayAnchorService.getVariableAnchorMaps(unitNames, workspaceId);
      await checkCancellation?.();
      return anchorMaps;
    } catch (error) {
      this.logger.warn(
        `Failed to load replay anchor overrides for workspace ${workspaceId}: ${error.message}`
      );
      return new Map(
        unitNames.map(unitName => [unitName, new Map<string, string>()])
      );
    }
  }

  /**
   * Stream coding list as CSV with memory-efficient batching.
   */
  async getCodingListCsvStream(
    workspace_id: number,
    authToken: string,
    serverUrl?: string,
    progressCallback?: (percentage: number) => Promise<void>,
    trainingRequired?: boolean,
    checkCancellation?: () => Promise<void>
  ) {
    this.logger.log(
      `Memory-efficient CSV export for workspace ${workspace_id} (trainingRequired: ${trainingRequired})`
    );
    this.fileCacheService.clearCaches();
    const csvStream = fastCsv.format({ headers: true, delimiter: ';' });

    (async () => {
      try {
        await checkCancellation?.();
        const { filterOptions, trainingRequiredMap } =
          await this.getCodingListFilterContext(workspace_id, trainingRequired, checkCancellation);
        await checkCancellation?.();
        const totalRows = await this.responseFilterService.countResponses(
          workspace_id,
          filterOptions
        );
        await checkCancellation?.();
        const batchSize = this.getCodingListExportBatchSize();
        let lastId = 0;
        let totalWritten = 0;

        let hasMoreRows = true;
        while (hasMoreRows) {
          await checkCancellation?.();
          const responses = await this.responseFilterService.getResponsesBatch(
            workspace_id,
            lastId,
            batchSize,
            filterOptions
          );
          await checkCancellation?.();

          if (!responses.length) {
            hasMoreRows = false;
            continue;
          }

          const variableAnchorMaps = await this.loadVariableAnchorMapsForResponses(
            responses,
            workspace_id,
            checkCancellation
          );

          // Process responses
          const items: CodingItem[] = [];

          for (let responseIndex = 0; responseIndex < responses.length; responseIndex += 1) {
            if (this.shouldYieldExportRow(responseIndex)) {
              await checkCancellation?.();
              await this.yieldToEventLoop();
            }

            const response = responses[responseIndex];
            // Apply trainingRequired filter here
            if (trainingRequired !== undefined && trainingRequiredMap) {
              const unitKey = response.unit?.name || '';
              const variableId = response.variableid || '';
              const isRequired = trainingRequiredMap.get(unitKey.toUpperCase())?.has(variableId) || false;
              if (isRequired !== trainingRequired) {
                continue;
              }
            }

            const item = await this.itemBuilderService.buildCodingItem(
              response,
              authToken,
              serverUrl!,
              workspace_id,
              variableAnchorMaps
            );
            if (item) {
              items.push(item);
            }
          }

          // Write items to CSV stream
          for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
            if (this.shouldYieldExportRow(itemIndex)) {
              await checkCancellation?.();
              await this.yieldToEventLoop();
            }

            const item = items[itemIndex];
            const ok = csvStream.write(item);
            totalWritten += 1;

            if (!ok) {
              await new Promise(resolve => {
                csvStream.once('drain', resolve);
              });
              await checkCancellation?.();
            }
          }

          // Force garbage collection hint after each batch
          if (global.gc) {
            global.gc();
          }

          lastId = responses[responses.length - 1].id;

          if (progressCallback && totalRows > 0) {
            const percentage = Math.min(100, Math.round((totalWritten / totalRows) * 100));
            await progressCallback(percentage);
          }

          await this.yieldToEventLoop();
        }

        await checkCancellation?.();
        this.logger.log(`CSV stream finished. Rows written: ${totalWritten}`);
        csvStream.end();
      } catch (error) {
        this.logger.error(`Error streaming CSV export: ${error.message}`);
        csvStream.emit('error', error);
      } finally {
        // Clear caches after export to free memory
        this.fileCacheService.clearCaches();
      }
    })();

    return csvStream;
  }

  /**
   * Export coding list as Excel with streaming to minimize memory usage.
   */
  async getCodingListAsExcel(
    workspace_id: number,
    authToken?: string,
    serverUrl?: string,
    progressCallback?: (percentage: number) => Promise<void>,
    trainingRequired?: boolean,
    checkCancellation?: () => Promise<void>
  ): Promise<Buffer> {
    this.logger.log(
      `Streaming Excel export for workspace ${workspace_id} (trainingRequired: ${trainingRequired})`
    );
    this.fileCacheService.clearCaches();

    const chunks: Buffer[] = [];

    // Create a PassThrough stream that collects chunks
    const stream = new PassThrough();

    stream.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    // Use streaming workbook writer instead of in-memory workbook
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream,
      useStyles: false,
      useSharedStrings: false
    });

    const worksheet = workbook.addWorksheet('Coding List');

    worksheet.columns = [
      { header: 'unit_key', key: 'unit_key', width: 30 },
      { header: 'unit_alias', key: 'unit_alias', width: 30 },
      { header: 'person_login', key: 'person_login', width: 25 },
      { header: 'person_code', key: 'person_code', width: 25 },
      { header: 'person_group', key: 'person_group', width: 25 },
      { header: 'booklet_name', key: 'booklet_name', width: 30 },
      { header: 'variable_id', key: 'variable_id', width: 30 },
      { header: 'variable_page', key: 'variable_page', width: 15 },
      { header: 'variable_anchor', key: 'variable_anchor', width: 30 },
      { header: 'status_v1', key: 'status_v1', width: 20 },
      { header: 'url', key: 'url', width: 60 }
    ];

    try {
      await checkCancellation?.();
      const { filterOptions, trainingRequiredMap } =
        await this.getCodingListFilterContext(workspace_id, trainingRequired, checkCancellation);
      await checkCancellation?.();
      const totalRows = await this.responseFilterService.countResponses(
        workspace_id,
        filterOptions
      );
      await checkCancellation?.();
      const batchSize = this.getCodingListExportBatchSize();
      let lastId = 0;
      let totalWritten = 0;

      let hasMoreRows = true;
      while (hasMoreRows) {
        await checkCancellation?.();
        const responses = await this.responseFilterService.getResponsesBatch(
          workspace_id,
          lastId,
          batchSize,
          filterOptions
        );
        await checkCancellation?.();

        if (!responses.length) {
          hasMoreRows = false;
          continue;
        }

        const variableAnchorMaps = await this.loadVariableAnchorMapsForResponses(
          responses,
          workspace_id,
          checkCancellation
        );

        for (let responseIndex = 0; responseIndex < responses.length; responseIndex += 1) {
          if (this.shouldYieldExportRow(responseIndex)) {
            await checkCancellation?.();
            await this.yieldToEventLoop();
          }

          const response = responses[responseIndex];
          // Apply trainingRequired filter here
          if (trainingRequired !== undefined && trainingRequiredMap) {
            const unitKey = response.unit?.name || '';
            const variableId = response.variableid || '';
            const isRequired = trainingRequiredMap.get(unitKey.toUpperCase())?.has(variableId) || false;
            if (isRequired !== trainingRequired) {
              continue;
            }
          }

          const item = await this.itemBuilderService.buildCodingItem(
            response,
            authToken!,
            serverUrl!,
            workspace_id,
            variableAnchorMaps
          );
          if (item) {
            worksheet.addRow(item).commit();
            totalWritten += 1;
          }
        }

        // Force garbage collection hint after each batch
        if (global.gc) {
          global.gc();
        }

        lastId = responses[responses.length - 1].id;

        if (progressCallback && totalRows > 0) {
          const percentage = Math.min(100, Math.round((totalWritten / totalRows) * 100));
          await progressCallback(percentage);
        }

        await this.yieldToEventLoop();
      }

      await checkCancellation?.();
      this.logger.log(`Excel export finished. Rows written: ${totalWritten}`);

      // Set up promise to wait for stream completion BEFORE committing
      const streamComplete = new Promise<void>((resolve, reject) => {
        stream.on('end', resolve);
        stream.on('error', reject);
      });

      // Commit the worksheet and workbook (this triggers data writing)
      await worksheet.commit();
      await workbook.commit();

      // Wait for all data to be written and read
      await streamComplete;
      await checkCancellation?.();

      return Buffer.concat(chunks);
    } catch (error) {
      this.logger.error(`Error creating Excel export: ${error.message}`);
      throw error;
    } finally {
      // Clear caches after export to free memory
      this.fileCacheService.clearCaches();
    }
  }

  async writeCodingListExcelToFile(
    filePath: string,
    workspace_id: number,
    authToken?: string,
    serverUrl?: string,
    progressCallback?: (percentage: number) => Promise<void>,
    trainingRequired?: boolean,
    checkCancellation?: () => Promise<void>
  ): Promise<void> {
    this.logger.log(
      `Direct-to-file Excel export for workspace ${workspace_id} (trainingRequired: ${trainingRequired})`
    );
    this.fileCacheService.clearCaches();

    const outputStream = fs.createWriteStream(filePath);
    const streamComplete = new Promise<void>((resolve, reject) => {
      outputStream.on('finish', resolve);
      outputStream.on('error', reject);
    });
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream: outputStream,
      useStyles: false,
      useSharedStrings: false
    });
    const worksheet = workbook.addWorksheet('Coding List');

    worksheet.columns = [
      { header: 'unit_key', key: 'unit_key', width: 30 },
      { header: 'unit_alias', key: 'unit_alias', width: 30 },
      { header: 'person_login', key: 'person_login', width: 25 },
      { header: 'person_code', key: 'person_code', width: 25 },
      { header: 'person_group', key: 'person_group', width: 25 },
      { header: 'booklet_name', key: 'booklet_name', width: 30 },
      { header: 'variable_id', key: 'variable_id', width: 30 },
      { header: 'variable_page', key: 'variable_page', width: 15 },
      { header: 'variable_anchor', key: 'variable_anchor', width: 30 },
      { header: 'status_v1', key: 'status_v1', width: 20 },
      { header: 'url', key: 'url', width: 60 }
    ];

    try {
      await checkCancellation?.();
      const { filterOptions, trainingRequiredMap } =
        await this.getCodingListFilterContext(workspace_id, trainingRequired, checkCancellation);
      await checkCancellation?.();
      const totalRows = await this.responseFilterService.countResponses(
        workspace_id,
        filterOptions
      );
      await checkCancellation?.();
      const batchSize = this.getCodingListExportBatchSize();
      let lastId = 0;
      let totalWritten = 0;

      let hasMoreRows = true;
      while (hasMoreRows) {
        await checkCancellation?.();
        const responses = await this.responseFilterService.getResponsesBatch(
          workspace_id,
          lastId,
          batchSize,
          filterOptions
        );
        await checkCancellation?.();

        if (!responses.length) {
          hasMoreRows = false;
          continue;
        }

        const variableAnchorMaps = await this.loadVariableAnchorMapsForResponses(
          responses,
          workspace_id,
          checkCancellation
        );

        for (let responseIndex = 0; responseIndex < responses.length; responseIndex += 1) {
          if (this.shouldYieldExportRow(responseIndex)) {
            await checkCancellation?.();
            await this.yieldToEventLoop();
          }

          const response = responses[responseIndex];
          if (trainingRequired !== undefined && trainingRequiredMap) {
            const unitKey = response.unit?.name || '';
            const variableId = response.variableid || '';
            const isRequired = trainingRequiredMap.get(unitKey.toUpperCase())?.has(variableId) || false;
            if (isRequired !== trainingRequired) {
              continue;
            }
          }

          const item = await this.itemBuilderService.buildCodingItem(
            response,
            authToken!,
            serverUrl!,
            workspace_id,
            variableAnchorMaps
          );
          if (item) {
            worksheet.addRow(item).commit();
            totalWritten += 1;
          }
        }

        if (global.gc) {
          global.gc();
        }

        lastId = responses[responses.length - 1].id;

        if (progressCallback && totalRows > 0) {
          const percentage = Math.min(100, Math.round((totalWritten / totalRows) * 100));
          await progressCallback(percentage);
        }

        await this.yieldToEventLoop();
      }

      await checkCancellation?.();
      await worksheet.commit();
      await workbook.commit();
      await streamComplete;
      await checkCancellation?.();

      this.logger.log(`Direct-to-file Excel export finished. Rows written: ${totalWritten}`);
    } catch (error) {
      outputStream.destroy(error);
      await streamComplete.catch(() => undefined);
      if (this.isExportCancellationError(error)) {
        this.logger.log(`Direct-to-file Excel export cancelled: ${error.message}`);
      } else {
        this.logger.error(`Error creating direct-to-file Excel export: ${error.message}`);
      }
      throw error;
    } finally {
      this.fileCacheService.clearCaches();
    }
  }

  /**
   * Stream coding list as JSON.
   */
  getCodingListJsonStream(
    workspace_id: number,
    authToken: string,
    serverUrl?: string,
    progressCallback?: (percentage: number) => Promise<void>,
    trainingRequired?: boolean,
    checkCancellation?: () => Promise<void>
  ): JsonStream {
    this.logger.log(
      `Memory-efficient JSON stream export for workspace ${workspace_id} (trainingRequired: ${trainingRequired})`
    );
    this.fileCacheService.clearCaches();

    let endListener: (() => void) | null = null;
    let errorListener: ((error: Error) => void) | null = null;

    return {
      on: (
        event: string,
        listener:
        | ((item: CodingItem) => void)
        | (() => void)
        | ((error: Error) => void)
      ) => {
        if (event === 'data') {
          this.processJsonExport(
            workspace_id,
            authToken,
            serverUrl!,
            listener as (item: CodingItem) => void,
            () => endListener?.(),
            err => errorListener?.(err),
            progressCallback,
            trainingRequired,
            checkCancellation
          );
        } else if (event === 'end') {
          endListener = listener as () => void;
        } else if (event === 'error') {
          errorListener = listener as (error: Error) => void;
        }
      }
    };
  }

  /**
   * Process JSON export with streaming.
   */
  private async processJsonExport(
    workspace_id: number,
    authToken: string,
    serverUrl: string,
    dataListener: (item: CodingItem) => void,
    onEnd: () => void,
    onError: (error: Error) => void,
    progressCallback?: (percentage: number) => Promise<void>,
    trainingRequired?: boolean,
    checkCancellation?: () => Promise<void>
  ) {
    try {
      await checkCancellation?.();
      const { filterOptions, trainingRequiredMap } =
        await this.getCodingListFilterContext(workspace_id, trainingRequired, checkCancellation);
      await checkCancellation?.();
      const totalRows = await this.responseFilterService.countResponses(
        workspace_id,
        filterOptions
      );
      await checkCancellation?.();
      const batchSize = this.getCodingListExportBatchSize();
      let lastId = 0;
      let totalWritten = 0;

      let hasMoreRows = true;
      while (hasMoreRows) {
        await checkCancellation?.();
        const responses = await this.responseFilterService.getResponsesBatch(
          workspace_id,
          lastId,
          batchSize,
          filterOptions
        );
        await checkCancellation?.();

        if (!responses.length) {
          hasMoreRows = false;
          continue;
        }

        const variableAnchorMaps = await this.loadVariableAnchorMapsForResponses(
          responses,
          workspace_id,
          checkCancellation
        );

        for (let responseIndex = 0; responseIndex < responses.length; responseIndex += 1) {
          if (this.shouldYieldExportRow(responseIndex)) {
            await checkCancellation?.();
            await this.yieldToEventLoop();
          }

          const response = responses[responseIndex];
          // Apply trainingRequired filter here
          if (trainingRequired !== undefined && trainingRequiredMap) {
            const unitKey = response.unit?.name || '';
            const variableId = response.variableid || '';
            const isRequired = trainingRequiredMap.get(unitKey.toUpperCase())?.has(variableId) || false;
            if (isRequired !== trainingRequired) {
              continue;
            }
          }

          const item = await this.itemBuilderService.buildCodingItem(
            response,
            authToken,
            serverUrl,
            workspace_id,
            variableAnchorMaps
          );
          if (item) {
            dataListener(item);
            totalWritten += 1;
          }
        }

        // Force garbage collection hint after each batch
        if (global.gc) {
          global.gc();
        }

        lastId = responses[responses.length - 1].id;

        if (progressCallback && totalRows > 0) {
          const percentage = Math.min(100, Math.round((totalWritten / totalRows) * 100));
          await progressCallback(percentage);
        }

        await this.yieldToEventLoop();
      }

      await checkCancellation?.();
      // Signal end of stream
      onEnd();

      this.fileCacheService.clearCaches();
    } catch (error) {
      this.logger.error(`Error during JSON stream export: ${error.message}`);
      onError(error);
    }
  }

  /**
   * Stream coding results by version as CSV.
   */
  async getCodingResultsByVersionCsvStream(
    workspace_id: number,
    version: 'v1' | 'v2' | 'v3',
    authToken: string,
    serverUrl?: string,
    includeReplayUrls: boolean = false,
    progressCallback?: ExportProgressCallback,
    includeResponseValues: boolean = true,
    includeGeoGebraResponseValues: boolean = false,
    checkCancellation?: () => Promise<void>,
    missingsProfileId?: number
  ) {
    this.logger.log(
      `Memory-efficient CSV export for coding results version ${version}, workspace ${workspace_id} (replay URLs: ${includeReplayUrls}, response values: ${includeResponseValues})`
    );
    this.fileCacheService.clearCaches();
    const v1ExportProfile = await this.loadV1ExportProfile(
      workspace_id,
      version,
      missingsProfileId
    );
    const headers = this.itemBuilderService.getHeadersForVersion(version, includeResponseValues);
    const csvStream = fastCsv.format({
      headers: includeReplayUrls ? [...headers, 'url'] : headers,
      delimiter: ';',
      alwaysWriteHeaders: true
    });

    (async () => {
      try {
        await checkCancellation?.();
        const batchSize = this.getVersionedExportBatchSize();
        let lastId = 0;
        let totalWritten = 0;
        const versionExportOptions = this.getVersionedResponseFilterOptions(version);
        await progressCallback?.(0, { phase: 'counting' });
        const totalRows = await this.countVersionedResponseRows(
          workspace_id,
          version,
          checkCancellation
        );
        await progressCallback?.(totalRows > 0 ? 1 : 0, {
          phase: 'writing',
          processedRows: 0,
          totalRows
        });
        const progressState: VersionedExportProgressState = {
          lastReportedRows: 0,
          lastReportedAt: Date.now()
        };

        let hasMoreRows = true;
        while (hasMoreRows) {
          await checkCancellation?.();
          const rows = await this.responseFilterService.getVersionedResponsesBatchRaw(
            workspace_id,
            lastId,
            batchSize,
            versionExportOptions
          );
          await checkCancellation?.();

          if (!rows.length) {
            hasMoreRows = false;
            continue;
          }

          const variableAnchorMaps = await this.loadVariableAnchorMapsForVersionRows(
            rows,
            workspace_id,
            checkCancellation
          );

          for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
            if (this.shouldYieldExportRow(rowIndex)) {
              await checkCancellation?.();
              await this.yieldToEventLoop();
            }

            const row = rows[rowIndex];
            const item = await this.buildVersionedExportItem(
              row,
              version,
              authToken,
              serverUrl!,
              workspace_id,
              includeReplayUrls,
              includeResponseValues,
              includeGeoGebraResponseValues,
              variableAnchorMaps,
              v1ExportProfile
            );

            if (item !== null) {
              const ok = csvStream.write(item);
              totalWritten += 1;
              await this.reportRowBasedProgress(
                progressCallback,
                totalWritten,
                totalRows,
                progressState
              );

              if (!ok) {
                await new Promise(resolve => {
                  csvStream.once('drain', resolve);
                });
                await checkCancellation?.();
              }
            }
          }

          // Force garbage collection hint after each batch
          if (global.gc) {
            global.gc();
          }

          lastId = rows[rows.length - 1].id;
          await this.reportRowBasedProgress(
            progressCallback,
            totalWritten,
            totalRows,
            progressState,
            true
          );

          await this.yieldToEventLoop();
        }

        await checkCancellation?.();
        await progressCallback?.(100, {
          phase: 'finalizing',
          processedRows: totalWritten,
          totalRows
        });
        this.logger.log(
          `CSV stream finished for version ${version}. Rows written: ${totalWritten}`
        );
        csvStream.end();
      } catch (error) {
        this.logger.error(
          `Error streaming CSV export for version ${version}: ${error.message}`
        );
        csvStream.emit('error', error);
      } finally {
        // Clear caches after export to free memory
        this.fileCacheService.clearCaches();
      }
    })();

    return csvStream;
  }

  /**
   * Export coding results by version as Excel with streaming.
   */
  async getCodingResultsByVersionAsExcel(
    workspace_id: number,
    version: 'v1' | 'v2' | 'v3',
    authToken?: string,
    serverUrl?: string,
    includeReplayUrls: boolean = false,
    progressCallback?: ExportProgressCallback,
    includeResponseValues: boolean = true,
    includeGeoGebraResponseValues: boolean = false,
    checkCancellation?: () => Promise<void>,
    missingsProfileId?: number
  ): Promise<Buffer> {
    this.logger.log(
      `Starting streaming Excel export for coding results version ${version}, workspace ${workspace_id} (replay URLs: ${includeReplayUrls}, response values: ${includeResponseValues})`
    );
    this.fileCacheService.clearCaches();
    const v1ExportProfile = await this.loadV1ExportProfile(
      workspace_id,
      version,
      missingsProfileId
    );

    const chunks: Buffer[] = [];

    // Create a PassThrough stream that collects chunks
    const stream = new PassThrough();

    stream.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    // Use streaming workbook writer for minimal memory usage
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream,
      useStyles: false, // Disable styles to reduce memory
      useSharedStrings: false // Disable shared strings to reduce memory
    });

    const worksheet = workbook.addWorksheet('Coding Results');

    // Define headers based on version (include lower versions)
    let headers = this.itemBuilderService.getHeadersForVersion(version, includeResponseValues);

    // Add URL column if replay URLs are included
    if (includeReplayUrls) {
      headers = [...headers, 'url'];
    }

    worksheet.columns = headers.map(h => ({ header: h, key: h, width: 20 }));

    const batchSize = this.getVersionedExportBatchSize();
    let lastId = 0;
    let totalWritten = 0;

    try {
      await checkCancellation?.();
      const versionExportOptions = this.getVersionedResponseFilterOptions(version);
      await progressCallback?.(0, { phase: 'counting' });
      const totalRows = await this.countVersionedResponseRows(
        workspace_id,
        version,
        checkCancellation
      );
      await progressCallback?.(totalRows > 0 ? 1 : 0, {
        phase: 'writing',
        processedRows: 0,
        totalRows
      });
      const progressState: VersionedExportProgressState = {
        lastReportedRows: 0,
        lastReportedAt: Date.now()
      };

      let hasMoreRows = true;
      while (hasMoreRows) {
        await checkCancellation?.();
        const rows = await this.responseFilterService.getVersionedResponsesBatchRaw(
          workspace_id,
          lastId,
          batchSize,
          versionExportOptions
        );
        await checkCancellation?.();

        if (!rows.length) {
          hasMoreRows = false;
          continue;
        }

        const variableAnchorMaps = await this.loadVariableAnchorMapsForVersionRows(
          rows,
          workspace_id,
          checkCancellation
        );

        for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
          if (this.shouldYieldExportRow(rowIndex)) {
            await checkCancellation?.();
            await this.yieldToEventLoop();
          }

          const row = rows[rowIndex];
          const item = await this.buildVersionedExportItem(
            row,
            version,
            authToken || '',
            serverUrl || '',
            workspace_id,
            includeReplayUrls,
            includeResponseValues,
            includeGeoGebraResponseValues,
            variableAnchorMaps,
            v1ExportProfile
          );

          if (item !== null) {
            worksheet.addRow(item).commit(); // Commit each row immediately
            totalWritten += 1;
            await this.reportRowBasedProgress(
              progressCallback,
              totalWritten,
              totalRows,
              progressState
            );
          }
        }

        // Force garbage collection hint after each batch
        if (global.gc) {
          global.gc();
        }

        lastId = rows[rows.length - 1].id;

        // Log progress every 10 batches
        if (totalWritten % 10000 === 0) {
          this.logger.log(
            `Excel export progress for version ${version}: ${totalWritten} rows written`
          );
        }

        await this.reportRowBasedProgress(
          progressCallback,
          totalWritten,
          totalRows,
          progressState,
          true
        );

        await this.yieldToEventLoop();
      }

      await checkCancellation?.();
      this.logger.log(
        `Excel export completed for version ${version}. Rows written: ${totalWritten}`
      );
      await progressCallback?.(100, {
        phase: 'finalizing',
        processedRows: totalWritten,
        totalRows
      });

      // Set up promise to wait for stream completion BEFORE committing
      const streamComplete = new Promise<void>((resolve, reject) => {
        stream.on('end', resolve);
        stream.on('error', reject);
      });

      // Commit the worksheet and workbook (this triggers data writing)
      await worksheet.commit();
      await workbook.commit();

      // Wait for all data to be written and read
      await streamComplete;
      await checkCancellation?.();

      return Buffer.concat(chunks);
    } catch (error) {
      this.logger.error(
        `Error during Excel export for version ${version}: ${error.message}`
      );
      throw error;
    } finally {
      this.fileCacheService.clearCaches();
    }
  }

  async writeCodingResultsByVersionExcelToFile(
    filePath: string,
    workspace_id: number,
    version: 'v1' | 'v2' | 'v3',
    authToken?: string,
    serverUrl?: string,
    includeReplayUrls: boolean = false,
    progressCallback?: ExportProgressCallback,
    includeResponseValues: boolean = true,
    includeGeoGebraResponseValues: boolean = false,
    checkCancellation?: () => Promise<void>,
    missingsProfileId?: number
  ): Promise<void> {
    this.logger.log(
      `Starting direct-to-file Excel export for coding results version ${version}, workspace ${workspace_id} (replay URLs: ${includeReplayUrls}, response values: ${includeResponseValues})`
    );
    this.fileCacheService.clearCaches();
    const v1ExportProfile = await this.loadV1ExportProfile(
      workspace_id,
      version,
      missingsProfileId
    );

    const outputStream = fs.createWriteStream(filePath);
    const streamComplete = new Promise<void>((resolve, reject) => {
      outputStream.on('finish', resolve);
      outputStream.on('error', reject);
    });
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream: outputStream,
      useStyles: false,
      useSharedStrings: false
    });
    const worksheet = workbook.addWorksheet('Coding Results');

    let headers = this.itemBuilderService.getHeadersForVersion(version, includeResponseValues);

    if (includeReplayUrls) {
      headers = [...headers, 'url'];
    }

    worksheet.columns = headers.map(h => ({ header: h, key: h, width: 20 }));

    const batchSize = this.getVersionedExportBatchSize();
    let lastId = 0;
    let totalWritten = 0;

    try {
      await checkCancellation?.();
      const versionExportOptions = this.getVersionedResponseFilterOptions(version);
      await progressCallback?.(0, { phase: 'counting' });
      const totalRows = await this.countVersionedResponseRows(
        workspace_id,
        version,
        checkCancellation
      );
      await progressCallback?.(totalRows > 0 ? 1 : 0, {
        phase: 'writing',
        processedRows: 0,
        totalRows
      });
      const progressState: VersionedExportProgressState = {
        lastReportedRows: 0,
        lastReportedAt: Date.now()
      };

      let hasMoreRows = true;
      while (hasMoreRows) {
        await checkCancellation?.();
        const rows = await this.responseFilterService.getVersionedResponsesBatchRaw(
          workspace_id,
          lastId,
          batchSize,
          versionExportOptions
        );
        await checkCancellation?.();

        if (!rows.length) {
          hasMoreRows = false;
          continue;
        }

        const variableAnchorMaps = await this.loadVariableAnchorMapsForVersionRows(
          rows,
          workspace_id,
          checkCancellation
        );

        for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
          if (this.shouldYieldExportRow(rowIndex)) {
            await checkCancellation?.();
            await this.yieldToEventLoop();
          }

          const row = rows[rowIndex];
          const item = await this.buildVersionedExportItem(
            row,
            version,
            authToken || '',
            serverUrl || '',
            workspace_id,
            includeReplayUrls,
            includeResponseValues,
            includeGeoGebraResponseValues,
            variableAnchorMaps,
            v1ExportProfile
          );

          if (item !== null) {
            worksheet.addRow(item).commit();
            totalWritten += 1;
            await this.reportRowBasedProgress(
              progressCallback,
              totalWritten,
              totalRows,
              progressState
            );
          }
        }

        if (global.gc) {
          global.gc();
        }

        lastId = rows[rows.length - 1].id;

        if (totalWritten % 10000 === 0) {
          this.logger.log(
            `Direct-to-file Excel export progress for version ${version}: ${totalWritten} rows written`
          );
        }

        await this.reportRowBasedProgress(
          progressCallback,
          totalWritten,
          totalRows,
          progressState,
          true
        );

        await this.yieldToEventLoop();
      }

      await checkCancellation?.();
      await progressCallback?.(100, {
        phase: 'finalizing',
        processedRows: totalWritten,
        totalRows
      });
      await worksheet.commit();
      await workbook.commit();
      await streamComplete;
      await checkCancellation?.();

      this.logger.log(
        `Direct-to-file Excel export completed for version ${version}. Rows written: ${totalWritten}`
      );
    } catch (error) {
      outputStream.destroy(error);
      await streamComplete.catch(() => undefined);
      if (this.isExportCancellationError(error)) {
        this.logger.log(`Direct-to-file Excel export for version ${version} cancelled: ${error.message}`);
      } else {
        this.logger.error(
          `Error during direct-to-file Excel export for version ${version}: ${error.message}`
        );
      }
      throw error;
    } finally {
      this.fileCacheService.clearCaches();
    }
  }

  async getCodingResultsByVersionAsGeoGebraZip(
    workspace_id: number,
    version: 'v1' | 'v2' | 'v3',
    authToken?: string,
    serverUrl?: string,
    includeReplayUrls: boolean = false,
    progressCallback?: ExportProgressCallback,
    checkCancellation?: () => Promise<void>,
    missingsProfileId?: number
  ): Promise<Buffer> {
    this.logger.log(
      `Starting GeoGebra ZIP export for coding results version ${version}, workspace ${workspace_id}`
    );
    const chunks: Buffer[] = [];
    const stream = new PassThrough();

    stream.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    await this.writeCodingResultsByVersionGeoGebraZipToStream(
      stream,
      workspace_id,
      version,
      authToken,
      serverUrl,
      includeReplayUrls,
      progressCallback,
      checkCancellation,
      missingsProfileId
    );

    return Buffer.concat(chunks);
  }

  async writeCodingResultsByVersionGeoGebraZipToFile(
    filePath: string,
    workspace_id: number,
    version: 'v1' | 'v2' | 'v3',
    authToken?: string,
    serverUrl?: string,
    includeReplayUrls: boolean = false,
    progressCallback?: ExportProgressCallback,
    checkCancellation?: () => Promise<void>,
    missingsProfileId?: number
  ): Promise<void> {
    const outputStream = fs.createWriteStream(filePath);

    try {
      await this.writeCodingResultsByVersionGeoGebraZipToStream(
        outputStream,
        workspace_id,
        version,
        authToken,
        serverUrl,
        includeReplayUrls,
        progressCallback,
        checkCancellation,
        missingsProfileId
      );
    } catch (error) {
      outputStream.destroy();
      await fs.promises.unlink(filePath).catch(() => undefined);
      throw error;
    }
  }

  private async writeCodingResultsByVersionGeoGebraZipToStream(
    outputStream: Writable,
    workspace_id: number,
    version: 'v1' | 'v2' | 'v3',
    authToken?: string,
    serverUrl?: string,
    includeReplayUrls: boolean = false,
    progressCallback?: ExportProgressCallback,
    checkCancellation?: () => Promise<void>,
    missingsProfileId?: number
  ): Promise<void> {
    this.logger.log(
      `Starting streaming GeoGebra ZIP export for coding results version ${version}, workspace ${workspace_id}`
    );
    this.fileCacheService.clearCaches();
    const v1ExportProfile = await this.loadV1ExportProfile(
      workspace_id,
      version,
      missingsProfileId
    );

    const zipArchive = archiver('zip', {
      zlib: { level: 9 }
    });
    const workbookStream = new PassThrough();
    const zipComplete = new Promise<void>((resolve, reject) => {
      outputStream.on('finish', resolve);
      outputStream.on('close', resolve);
      outputStream.on('error', reject);
      zipArchive.on('error', reject);
      zipArchive.on('warning', warning => {
        this.logger.warn(
          `GeoGebra ZIP export warning for workspace ${workspace_id}: ${warning.message}`
        );
      });
    });

    zipArchive.pipe(outputStream);
    zipArchive.append(workbookStream, { name: `coding-results-${version}.xlsx` });

    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream: workbookStream,
      useStyles: false,
      useSharedStrings: false
    });
    const worksheet = workbook.addWorksheet('Coding Results');

    let headers = this.itemBuilderService.getHeadersForVersion(version, true);
    if (includeReplayUrls) {
      headers = [...headers, 'url'];
    }
    worksheet.columns = headers.map(h => ({ header: h, key: h, width: h === 'value' ? 35 : 20 }));

    const usedRelativePaths = new Set<string>();
    let geoGebraBytes = 0;
    let geoGebraFileCount = 0;
    const geoGebraExportLimits = this.getGeoGebraExportLimits();
    const batchSize = this.getVersionedExportBatchSize();
    let lastId = 0;
    let totalWritten = 0;

    try {
      await checkCancellation?.();
      const versionExportOptions = this.getVersionedResponseFilterOptions(version);
      await progressCallback?.(0, { phase: 'counting' });
      const totalRows = await this.countVersionedResponseRows(
        workspace_id,
        version,
        checkCancellation
      );
      await progressCallback?.(totalRows > 0 ? 1 : 0, {
        phase: 'writing',
        processedRows: 0,
        totalRows
      });
      const progressState: VersionedExportProgressState = {
        lastReportedRows: 0,
        lastReportedAt: Date.now()
      };

      let hasMoreRows = true;
      while (hasMoreRows) {
        await checkCancellation?.();
        const rows = await this.responseFilterService.getVersionedResponsesBatchRaw(
          workspace_id,
          lastId,
          batchSize,
          versionExportOptions
        );
        await checkCancellation?.();

        if (!rows.length) {
          hasMoreRows = false;
          continue;
        }

        const variableAnchorMaps = await this.loadVariableAnchorMapsForVersionRows(
          rows,
          workspace_id,
          checkCancellation
        );

        for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
          if (this.shouldYieldExportRow(rowIndex)) {
            await checkCancellation?.();
            await this.yieldToEventLoop();
          }

          const row = rows[rowIndex];
          const item = await this.buildVersionedExportItem(
            row,
            version,
            authToken || '',
            serverUrl || '',
            workspace_id,
            includeReplayUrls,
            true,
            true,
            variableAnchorMaps,
            v1ExportProfile
          );

          if (item !== null) {
            const rowData = { ...item } as Record<string, unknown>;
            const geoGebraBuffer = decodeGeoGebraValue(item.value);

            if (geoGebraBuffer) {
              const nextFileCount = geoGebraFileCount + 1;
              if (nextFileCount > geoGebraExportLimits.maxFileCount) {
                throw new Error(
                  `GeoGebra-ZIP-Export abgebrochen: ${nextFileCount} GeoGebra-Dateien überschreiten das Limit von ${geoGebraExportLimits.maxFileCount}.`
                );
              }
              geoGebraBytes += geoGebraBuffer.length;
              if (geoGebraBytes > geoGebraExportLimits.maxBytes) {
                throw new Error(
                  `GeoGebra-ZIP-Export abgebrochen: ${geoGebraBytes} Bytes GeoGebra-Daten überschreiten das Limit von ${geoGebraExportLimits.maxBytes} Bytes.`
                );
              }

              const relativePath = this.createUniqueGeoGebraRelativePath(
                {
                  responseId: row.id,
                  personLogin: item.person_login,
                  personCode: item.person_code,
                  bookletName: item.booklet_name,
                  unitKey: item.unit_key,
                  variableId: item.variable_id
                },
                usedRelativePaths
              );

              rowData.value = {
                text: relativePath.split('/').pop() || relativePath,
                hyperlink: relativePath
              };
              geoGebraFileCount += 1;
              zipArchive.append(geoGebraBuffer, { name: relativePath });
            }

            worksheet.addRow(rowData).commit();
            totalWritten += 1;
            await this.reportRowBasedProgress(
              progressCallback,
              totalWritten,
              totalRows,
              progressState
            );
          }
        }

        if (global.gc) {
          global.gc();
        }

        lastId = rows[rows.length - 1].id;

        await this.reportRowBasedProgress(
          progressCallback,
          totalWritten,
          totalRows,
          progressState,
          true
        );

        await this.yieldToEventLoop();
      }

      if (geoGebraFileCount === 0) {
        throw new Error('GeoGebra-ZIP-Export abgebrochen: Im exportierten Datenbestand wurden keine GeoGebra-Antworten gefunden.');
      }

      await checkCancellation?.();
      await progressCallback?.(100, {
        phase: 'finalizing',
        processedRows: totalWritten,
        totalRows
      });
      await worksheet.commit();
      await workbook.commit();
      await checkCancellation?.();
      await zipArchive.finalize();
      await zipComplete;
      await checkCancellation?.();

      this.logger.log(
        `GeoGebra ZIP export completed for version ${version}. Rows written: ${totalWritten}, GeoGebra files: ${geoGebraFileCount}`
      );
    } catch (error) {
      zipArchive.abort();
      workbookStream.destroy();
      outputStream.destroy();
      this.logger.error(
        `Error during GeoGebra ZIP export for version ${version}: ${error.message}`
      );
      throw error;
    } finally {
      this.fileCacheService.clearCaches();
    }
  }

  private createUniqueGeoGebraRelativePath(
    parts: {
      responseId: number;
      personLogin?: string;
      personCode?: string;
      bookletName?: string;
      unitKey?: string;
      variableId?: string;
    },
    usedRelativePaths: Set<string>
  ): string {
    const baseFileName = buildGeoGebraFileName(parts);
    let relativePath = `geogebra/${baseFileName}`;
    let suffix = 2;

    while (usedRelativePaths.has(relativePath)) {
      relativePath = `geogebra/${baseFileName.replace(/\.ggb$/, `-${suffix}.ggb`)}`;
      suffix += 1;
    }

    usedRelativePaths.add(relativePath);
    return relativePath;
  }
}
