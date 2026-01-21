import { Injectable, Logger } from '@nestjs/common';
import * as fastCsv from 'fast-csv';
import * as ExcelJS from 'exceljs';
import { CodingResponseFilterService } from './coding-response-filter.service';
import { CodingItemBuilderService, CodingItem } from './coding-item-builder.service';
import { CodingFileCacheService } from './coding-file-cache.service';

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

  constructor(
    private readonly responseFilterService: CodingResponseFilterService,
    private readonly itemBuilderService: CodingItemBuilderService,
    private readonly fileCacheService: CodingFileCacheService
  ) { }

  /**
   * Stream coding list as CSV with memory-efficient batching.
   */
  async getCodingListCsvStream(
    workspace_id: number,
    authToken: string,
    serverUrl?: string
  ) {
    this.logger.log(
      `Memory-efficient CSV export for workspace ${workspace_id}`
    );
    this.fileCacheService.clearCaches();
    const csvStream = fastCsv.format({ headers: true, delimiter: ';' });

    (async () => {
      try {
        const batchSize = 5000;
        let lastId = 0;
        let totalWritten = 0;

        for (; ;) {
          const responses = await this.responseFilterService.getResponsesBatch(
            workspace_id,
            lastId,
            batchSize
          );

          if (!responses.length) break;

          // Process responses in parallel batches for better performance
          const items: CodingItem[] = [];
          const processingPromises = responses.map(response => this.itemBuilderService.buildCodingItem(
            response,
            authToken,
            serverUrl!,
            workspace_id
          )
          );

          const results = await Promise.allSettled(processingPromises);

          for (const result of results) {
            if (result.status === 'fulfilled' && result.value !== null) {
              items.push(result.value);
            }
          }

          // Write items to CSV stream
          for (const item of items) {
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
    serverUrl?: string
  ): Promise<Buffer> {
    this.logger.log(
      `Streaming Excel export for workspace ${workspace_id}`
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
      { header: 'url', key: 'url', width: 60 }
    ];

    try {
      const batchSize = 1000; // Reduced batch size for streaming
      let lastId = 0;
      let totalWritten = 0;

      for (; ;) {
        const responses = await this.responseFilterService.getResponsesBatch(
          workspace_id,
          lastId,
          batchSize
        );

        if (!responses.length) break;

        const processingPromises = responses.map(response => this.itemBuilderService.buildCodingItem(
          response,
          authToken!,
          serverUrl!,
          workspace_id
        ));

        const results = await Promise.allSettled(processingPromises);

        for (const result of results) {
          if (result.status === 'fulfilled' && result.value !== null) {
            worksheet.addRow(result.value).commit();
            totalWritten += 1;
          }
        }

        // Force garbage collection hint after each batch
        if (global.gc) {
          global.gc();
        }

        lastId = responses[responses.length - 1].id;
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
    serverUrl?: string
  ): JsonStream {
    this.logger.log(
      `Memory-efficient JSON stream export for workspace ${workspace_id}`
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
            err => errorListener?.(err)
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
    onError: (error: Error) => void
  ) {
    try {
      const batchSize = 5000;
      let lastId = 0;

      for (; ;) {
        const responses = await this.responseFilterService.getResponsesBatch(
          workspace_id,
          lastId,
          batchSize
        );

        if (!responses.length) break;

        const processingPromises = responses.map(response => this.itemBuilderService.buildCodingItem(
          response,
          authToken,
          serverUrl,
          workspace_id
        )
        );

        const results = await Promise.allSettled(processingPromises);

        for (const result of results) {
          if (result.status === 'fulfilled' && result.value !== null) {
            dataListener(result.value);
          }
        }

        // Force garbage collection hint after each batch
        if (global.gc) {
          global.gc();
        }

        lastId = responses[responses.length - 1].id;
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
    includeReplayUrls: boolean = false
  ) {
    this.logger.log(
      `Memory-efficient CSV export for coding results version ${version}, workspace ${workspace_id} (replay URLs: ${includeReplayUrls})`
    );
    this.fileCacheService.clearCaches();
    const csvStream = fastCsv.format({ headers: true, delimiter: ';' });

    (async () => {
      try {
        const batchSize = 5000;
        let lastId = 0;
        let totalWritten = 0;

        for (; ;) {
          const responses = await this.responseFilterService.getResponsesBatch(
            workspace_id,
            lastId,
            batchSize,
            { version, considerOnly: false }
          );

          if (!responses.length) break;

          // Process responses in parallel batches
          const processingPromises = responses.map(response => this.itemBuilderService.buildCodingItemWithVersions(
            response,
            version,
            authToken,
            serverUrl!,
            workspace_id,
            includeReplayUrls
          ));

          const results = await Promise.allSettled(processingPromises);

          // Write items directly to CSV stream without accumulating
          for (const result of results) {
            if (result.status === 'fulfilled' && result.value !== null) {
              const ok = csvStream.write(result.value);
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
    includeReplayUrls: boolean = false
  ): Promise<Buffer> {
    this.logger.log(
      `Starting streaming Excel export for coding results version ${version}, workspace ${workspace_id} (replay URLs: ${includeReplayUrls})`
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
    let headers = this.itemBuilderService.getHeadersForVersion(version);

    // Add URL column if replay URLs are included
    if (includeReplayUrls) {
      headers = [...headers, 'url'];
    }

    worksheet.columns = headers.map(h => ({ header: h, key: h, width: 20 }));

    const batchSize = 1000; // Reduced batch size for streaming
    let lastId = 0;
    let totalWritten = 0;

    try {
      for (; ;) {
        const responses = await this.responseFilterService.getResponsesBatch(
          workspace_id,
          lastId,
          batchSize,
          { version, considerOnly: false }
        );

        if (!responses.length) break;

        // Process responses in parallel batches
        const processingPromises = responses.map(response => this.itemBuilderService.buildCodingItemWithVersions(
          response,
          version,
          authToken || '',
          serverUrl || '',
          workspace_id,
          includeReplayUrls
        )
        );

        const results = await Promise.allSettled(processingPromises);

        for (const result of results) {
          if (result.status === 'fulfilled' && result.value !== null) {
            worksheet.addRow(result.value).commit(); // Commit each row immediately
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
}
