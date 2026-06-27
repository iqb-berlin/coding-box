import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fastCsv from 'fast-csv';
import * as ExcelJS from 'exceljs';
import * as AdmZip from 'adm-zip';
// eslint-disable-next-line import/no-cycle
import {
  CodingResponseFilterService,
  ResponseFilterOptions
} from './coding-response-filter.service';
import {
  CodingItemBuilderService,
  CodingItem,
  CodingVariableAnchorMaps
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

interface JsonStream {
  on(event: 'data', listener: (item: CodingItem) => void): void;
  on(event: 'end', listener: () => void): void;
  on(event: 'error', listener: (error: Error) => void): void;
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

  constructor(
    private readonly responseFilterService: CodingResponseFilterService,
    private readonly itemBuilderService: CodingItemBuilderService,
    private readonly fileCacheService: CodingFileCacheService,
    private readonly workspaceFilesService: WorkspaceFilesService,
    @Optional() private readonly configService?: ConfigService,
    @Optional() private readonly replayAnchorService?: CodingReplayAnchorService
  ) { }

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
        const batchSize = 500;
        let lastId = 0;
        let totalWritten = 0;

        for (; ;) {
          await checkCancellation?.();
          const responses = await this.responseFilterService.getResponsesBatch(
            workspace_id,
            lastId,
            batchSize,
            filterOptions
          );
          await checkCancellation?.();

          if (!responses.length) break;

          const variableAnchorMaps = await this.loadVariableAnchorMapsForResponses(
            responses,
            workspace_id,
            checkCancellation
          );

          // Process responses
          const items: CodingItem[] = [];

          for (const response of responses) {
            await checkCancellation?.();
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
          for (const item of items) {
            await checkCancellation?.();
            const ok = csvStream.write(item);
            totalWritten += 1;

            if (!ok) {
              await new Promise(resolve => {
                csvStream.once('drain', resolve);
              });
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

          await new Promise(resolve => {
            setImmediate(resolve);
          });
        }

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

    const { PassThrough } = await import('stream');
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
      const batchSize = 1000; // Reduced batch size for streaming
      let lastId = 0;
      let totalWritten = 0;

      for (; ;) {
        await checkCancellation?.();
        const responses = await this.responseFilterService.getResponsesBatch(
          workspace_id,
          lastId,
          batchSize,
          filterOptions
        );
        await checkCancellation?.();

        if (!responses.length) break;

        const variableAnchorMaps = await this.loadVariableAnchorMapsForResponses(
          responses,
          workspace_id,
          checkCancellation
        );

        for (const response of responses) {
          await checkCancellation?.();
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

        await new Promise(resolve => {
          setImmediate(resolve);
        });
      }

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

      return Buffer.concat(chunks);
    } catch (error) {
      this.logger.error(`Error creating Excel export: ${error.message}`);
      throw error;
    } finally {
      // Clear caches after export to free memory
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
      const batchSize = 5000;
      let lastId = 0;
      let totalWritten = 0;

      for (; ;) {
        await checkCancellation?.();
        const responses = await this.responseFilterService.getResponsesBatch(
          workspace_id,
          lastId,
          batchSize,
          filterOptions
        );
        await checkCancellation?.();

        if (!responses.length) break;

        const variableAnchorMaps = await this.loadVariableAnchorMapsForResponses(
          responses,
          workspace_id,
          checkCancellation
        );

        for (const response of responses) {
          await checkCancellation?.();
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

        await new Promise(resolve => {
          setImmediate(resolve);
        });
      }

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
    progressCallback?: (percentage: number) => Promise<void>,
    includeResponseValues: boolean = true,
    includeGeoGebraResponseValues: boolean = false,
    checkCancellation?: () => Promise<void>
  ) {
    this.logger.log(
      `Memory-efficient CSV export for coding results version ${version}, workspace ${workspace_id} (replay URLs: ${includeReplayUrls}, response values: ${includeResponseValues})`
    );
    this.fileCacheService.clearCaches();
    const headers = this.itemBuilderService.getHeadersForVersion(version, includeResponseValues);
    const csvStream = fastCsv.format({
      headers: includeReplayUrls ? [...headers, 'url'] : headers,
      delimiter: ';',
      alwaysWriteHeaders: true
    });

    (async () => {
      try {
        await checkCancellation?.();
        const totalRows = await this.responseFilterService.countResponses(workspace_id, {
          version,
          validCodingVariablesOnly: true,
          givenResponsesOnly: true
        });
        await checkCancellation?.();
        const batchSize = 500;
        let lastId = 0;
        let totalWritten = 0;

        // Progress base: 0-10% (setup), 10-90% (processing), 90-100% (writing/finalize) - managed by caller usually, but here we cover the processing part.
        // Let's assume this function covers a significant portion. The caller might scale it.
        // We will report 0-100% of *this* process.

        for (; ;) {
          await checkCancellation?.();
          const responses = await this.responseFilterService.getResponsesBatch(
            workspace_id,
            lastId,
            batchSize,
            {
              version,
              validCodingVariablesOnly: true,
              givenResponsesOnly: true
            }
          );
          await checkCancellation?.();

          if (!responses.length) break;

          const variableAnchorMaps = await this.loadVariableAnchorMapsForResponses(
            responses,
            workspace_id,
            checkCancellation
          );

          for (const response of responses) {
            await checkCancellation?.();
            const item = await this.itemBuilderService.buildCodingItemWithVersions(
              response,
              version,
              authToken,
              serverUrl!,
              workspace_id,
              includeReplayUrls,
              includeResponseValues,
              includeGeoGebraResponseValues,
              variableAnchorMaps
            );

            if (item !== null) {
              const ok = csvStream.write(item);
              totalWritten += 1;

              if (!ok) {
                await new Promise(resolve => {
                  csvStream.once('drain', resolve);
                });
              }
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

          await new Promise(resolve => {
            setImmediate(resolve);
          });
        }

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
    progressCallback?: (percentage: number) => Promise<void>,
    includeResponseValues: boolean = true,
    includeGeoGebraResponseValues: boolean = false,
    checkCancellation?: () => Promise<void>
  ): Promise<Buffer> {
    this.logger.log(
      `Starting streaming Excel export for coding results version ${version}, workspace ${workspace_id} (replay URLs: ${includeReplayUrls}, response values: ${includeResponseValues})`
    );
    this.fileCacheService.clearCaches();

    const { PassThrough } = await import('stream');
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

    const batchSize = 500;
    let lastId = 0;
    let totalWritten = 0;

    try {
      await checkCancellation?.();
      const totalRows = await this.responseFilterService.countResponses(workspace_id, {
        version,
        validCodingVariablesOnly: true,
        givenResponsesOnly: true
      });
      await checkCancellation?.();

      for (; ;) {
        await checkCancellation?.();
        const responses = await this.responseFilterService.getResponsesBatch(
          workspace_id,
          lastId,
          batchSize,
          {
            version,
            validCodingVariablesOnly: true,
            givenResponsesOnly: true
          }
        );
        await checkCancellation?.();

        if (!responses.length) break;

        const variableAnchorMaps = await this.loadVariableAnchorMapsForResponses(
          responses,
          workspace_id,
          checkCancellation
        );

        for (const response of responses) {
          await checkCancellation?.();
          const item = await this.itemBuilderService.buildCodingItemWithVersions(
            response,
            version,
            authToken || '',
            serverUrl || '',
            workspace_id,
            includeReplayUrls,
            includeResponseValues,
            includeGeoGebraResponseValues,
            variableAnchorMaps
          );

          if (item !== null) {
            worksheet.addRow(item).commit(); // Commit each row immediately
            totalWritten += 1;
          }
        }

        // Force garbage collection hint after each batch
        if (global.gc) {
          global.gc();
        }

        lastId = responses[responses.length - 1].id;

        // Log progress every 10 batches
        if (totalWritten % 10000 === 0) {
          this.logger.log(
            `Excel export progress for version ${version}: ${totalWritten} rows written`
          );
        }

        if (progressCallback && totalRows > 0) {
          const percentage = Math.min(100, Math.round((totalWritten / totalRows) * 100));
          await progressCallback(percentage);
        }

        await new Promise(resolve => {
          setImmediate(resolve);
        });
      }

      this.logger.log(
        `Excel export completed for version ${version}. Rows written: ${totalWritten}`
      );

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

  async getCodingResultsByVersionAsGeoGebraZip(
    workspace_id: number,
    version: 'v1' | 'v2' | 'v3',
    authToken?: string,
    serverUrl?: string,
    includeReplayUrls: boolean = false,
    progressCallback?: (percentage: number) => Promise<void>,
    checkCancellation?: () => Promise<void>
  ): Promise<Buffer> {
    this.logger.log(
      `Starting GeoGebra ZIP export for coding results version ${version}, workspace ${workspace_id}`
    );
    this.fileCacheService.clearCaches();

    const { PassThrough } = await import('stream');
    const chunks: Buffer[] = [];
    const stream = new PassThrough();

    stream.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream,
      useStyles: false,
      useSharedStrings: false
    });
    const worksheet = workbook.addWorksheet('Coding Results');

    let headers = this.itemBuilderService.getHeadersForVersion(version, true);
    if (includeReplayUrls) {
      headers = [...headers, 'url'];
    }
    worksheet.columns = headers.map(h => ({ header: h, key: h, width: h === 'value' ? 35 : 20 }));

    const geoGebraFiles: Array<{ relativePath: string; buffer: Buffer }> = [];
    const usedRelativePaths = new Set<string>();
    let geoGebraBytes = 0;
    const geoGebraExportLimits = this.getGeoGebraExportLimits();
    const batchSize = 500;
    let lastId = 0;
    let totalWritten = 0;

    try {
      await checkCancellation?.();
      const totalRows = await this.responseFilterService.countResponses(workspace_id, {
        version,
        validCodingVariablesOnly: true,
        givenResponsesOnly: true
      });
      await checkCancellation?.();

      for (; ;) {
        await checkCancellation?.();
        const responses = await this.responseFilterService.getResponsesBatch(
          workspace_id,
          lastId,
          batchSize,
          {
            version,
            validCodingVariablesOnly: true,
            givenResponsesOnly: true
          }
        );
        await checkCancellation?.();

        if (!responses.length) break;

        const variableAnchorMaps = await this.loadVariableAnchorMapsForResponses(
          responses,
          workspace_id,
          checkCancellation
        );

        for (const response of responses) {
          await checkCancellation?.();
          const item = await this.itemBuilderService.buildCodingItemWithVersions(
            response,
            version,
            authToken || '',
            serverUrl || '',
            workspace_id,
            includeReplayUrls,
            true,
            true,
            variableAnchorMaps
          );

          if (item !== null) {
            const rowData = { ...item } as Record<string, unknown>;
            const geoGebraBuffer = decodeGeoGebraValue(item.value);

            if (geoGebraBuffer) {
              const nextFileCount = geoGebraFiles.length + 1;
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
                  responseId: response.id,
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
              geoGebraFiles.push({ relativePath, buffer: geoGebraBuffer });
            }

            worksheet.addRow(rowData).commit();
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

        await new Promise(resolve => {
          setImmediate(resolve);
        });
      }

      if (geoGebraFiles.length === 0) {
        throw new Error('GeoGebra-ZIP-Export abgebrochen: Im exportierten Datenbestand wurden keine GeoGebra-Antworten gefunden.');
      }

      const streamComplete = new Promise<void>((resolve, reject) => {
        stream.on('end', resolve);
        stream.on('error', reject);
      });

      await worksheet.commit();
      await workbook.commit();
      await streamComplete;

      const workbookBuffer = Buffer.concat(chunks);
      const zip = new AdmZip();
      zip.addFile(`coding-results-${version}.xlsx`, workbookBuffer);
      for (const file of geoGebraFiles) {
        await checkCancellation?.();
        zip.addFile(file.relativePath, file.buffer);
      }

      this.logger.log(
        `GeoGebra ZIP export completed for version ${version}. Rows written: ${totalWritten}, GeoGebra files: ${geoGebraFiles.length}`
      );

      return zip.toBuffer();
    } catch (error) {
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
