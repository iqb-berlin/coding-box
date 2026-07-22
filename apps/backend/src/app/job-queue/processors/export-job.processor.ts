import { Processor, Process } from '@nestjs/bull';
import {
  Injectable, Logger, Inject, forwardRef
} from '@nestjs/common';
import { Job } from 'bull';
import * as path from 'path';
import * as fs from 'fs';
import { pipeline } from 'stream/promises';
import {
  ExportJobData,
  ExportJobProgress,
  ExportJobProgressPhase,
  ExportJobResult,
  JobQueueService
} from '../job-queue.service';
import {
  CodingExportOrchestratorService, CodingExportService,
  CodingPsychometricExportService
} from '../../database/services/coding';
import { WorkspaceTestResultsService } from '../../database/services/test-results';
import { CacheService } from '../../cache/cache.service';
import { ExportJobCancelledException } from '../exceptions/export-job-cancelled.exception';
import { parseExportRequest } from '../../../../../../api-dto/coding/export-request.dto';

@Injectable()
@Processor('data-export')
export class ExportJobProcessor {
  private readonly logger = new Logger(ExportJobProcessor.name);

  constructor(
    @Inject(forwardRef(() => CodingExportService))
    private codingExportService: CodingExportService,
    @Inject(forwardRef(() => CodingExportOrchestratorService))
    private codingExportOrchestratorService: CodingExportOrchestratorService,
    @Inject(forwardRef(() => WorkspaceTestResultsService))
    private workspaceTestResultsService: WorkspaceTestResultsService,
    private cacheService: CacheService,
    private jobQueueService: JobQueueService,
    private codingPsychometricExportService: CodingPsychometricExportService
  ) { }

  private async checkCancellation(
    job: Job<ExportJobData>,
    filePath?: string
  ): Promise<void> {
    if (
      job.data.isCancelled ||
      (await this.jobQueueService.isExportJobCancelled(job.id.toString()))
    ) {
      this.logger.log(`Export job ${job.id} cancellation detected`);
      this.cleanupPartialExportFile(filePath);
      throw new ExportJobCancelledException(job.id);
    }
  }

  private cleanupPartialExportFile(filePath?: string): void {
    if (!filePath || !fs.existsSync(filePath)) {
      return;
    }

    try {
      fs.unlinkSync(filePath);
      this.logger.log(`Cleaned up partial export file: ${filePath}`);
    } catch (cleanupError) {
      this.logger.warn(
        `Failed to clean up partial file ${filePath}: ${cleanupError.message}`
      );
    }
  }

  private createCancelledResult(job: Job<ExportJobData>): ExportJobResult {
    return {
      fileId: job.id.toString(),
      fileName: '',
      filePath: '',
      fileSize: 0,
      workspaceId: job.data.workspaceId,
      userId: job.data.userId,
      exportType: job.data.exportType,
      createdAt: Date.now()
    };
  }

  private clampProgress(percentage: number): number {
    return Math.max(0, Math.min(100, Math.round(percentage)));
  }

  private async updateJobProgress(
    job: Job<ExportJobData>,
    percentage: number,
    details: {
      phase?: ExportJobProgressPhase;
      processedRows?: number;
      totalRows?: number;
      message?: string;
    } = {}
  ): Promise<void> {
    const progress: ExportJobProgress = {
      percentage: this.clampProgress(percentage)
    };

    if (details.phase) {
      progress.phase = details.phase;
    }
    if (typeof details.processedRows === 'number') {
      progress.processedRows = Math.max(0, Math.round(details.processedRows));
    }
    if (typeof details.totalRows === 'number') {
      progress.totalRows = Math.max(0, Math.round(details.totalRows));
    }
    if (details.message) {
      progress.message = details.message;
    }

    await job.progress(progress);
  }

  private async writeStreamToFile(
    stream: NodeJS.ReadableStream,
    filePath: string,
    options: {
      prependUtf8Bom?: boolean;
      checkCancellation?: () => Promise<void>;
      cancellationSignal?: AbortSignal;
    } = {}
  ): Promise<void> {
    const writeStream = fs.createWriteStream(filePath);
    let cancellationTimer: ReturnType<typeof setInterval> | undefined;

    try {
      if (options.prependUtf8Bom) {
        writeStream.write('\uFEFF');
      }

      if (options.checkCancellation) {
        cancellationTimer = setInterval(() => {
          options.checkCancellation?.().catch(error => {
            (
              stream as NodeJS.ReadableStream & {
                destroy?: (error?: Error) => void;
              }
            ).destroy?.(error);
            writeStream.destroy(error);
          });
        }, 1000);
      }

      await pipeline(stream, writeStream, {
        signal: options.cancellationSignal
      });
    } catch (error) {
      if (options.cancellationSignal?.aborted && options.checkCancellation) {
        await options.checkCancellation();
      }

      throw error;
    } finally {
      if (cancellationTimer) {
        clearInterval(cancellationTimer);
      }
    }
  }

  @Process({ concurrency: 1 })
  async process(job: Job<ExportJobData>): Promise<ExportJobResult> {
    this.logger.log(
      `Processing export job ${job.id} for workspace ${job.data.workspaceId}, type: ${job.data.exportType}`
    );
    const startedAt = Date.now();

    parseExportRequest(job.data);

    const jobId = job.id.toString();
    const cancellationSignal =
      this.jobQueueService.createExportJobCancellationSignal(jobId);
    let filePath: string | undefined;

    try {
      await this.checkCancellation(job);
      await this.updateJobProgress(job, 10, { phase: 'preparing' });
      const tempDir = path.join(process.cwd(), 'temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      const isCsv =
        job.data.exportType === 'detailed' ||
        job.data.exportType === 'by-variable-compact' ||
        (job.data.exportType === 'results-by-version' &&
          job.data.format !== 'excel') ||
        (job.data.exportType === 'coding-list' &&
          job.data.format !== 'excel' &&
          job.data.format !== 'json') ||
        (job.data.exportType === 'item-matrix' &&
          job.data.format !== 'excel') ||
        (job.data.exportType === 'psychometrics' &&
          job.data.format !== 'excel');
      let fileExt = isCsv ? 'csv' : 'xlsx';
      if (job.data.exportType === 'coding-list' && job.data.format === 'json') {
        fileExt = 'json';
      }
      if (
        job.data.exportType === 'results-by-version' &&
        job.data.format === 'excel' &&
        job.data.includeGeoGebraFiles
      ) {
        fileExt = 'zip';
      }
      const fileName = `export_${job.id}_${Date.now()}.${fileExt}`;
      filePath = path.join(tempDir, fileName);
      this.logger.log(`Generating export file: ${filePath}`);
      await this.checkCancellation(job, filePath);

      await this.updateJobProgress(job, 20, { phase: 'preparing' });
      const checkCancellation = async (): Promise<void> => {
        await this.checkCancellation(job, filePath);
      };

      const generationStartedAt = Date.now();

      // eslint-disable-next-line default-case
      switch (job.data.exportType) {
        case 'results-by-version': {
          const version = job.data.version || 'v2';
          const onProgress = async (
            percentage: number,
            details?: {
              phase?: ExportJobProgressPhase;
              processedRows?: number;
              totalRows?: number;
            }
          ) => {
            // Map 0-100% of sub-task to 20-90% of overall job
            const jobProgress = 20 + Math.round((percentage / 100) * 70);
            await this.updateJobProgress(job, jobProgress, {
              phase: details?.phase || 'writing',
              processedRows: details?.processedRows,
              totalRows: details?.totalRows
            });
            await checkCancellation();
          };

          if (job.data.format === 'excel') {
            const excelOptions = {
              workspaceId: job.data.workspaceId,
              version,
              authToken: job.data.authToken || '',
              serverUrl: job.data.serverUrl || '',
              includeReplayUrl: job.data.includeReplayUrl || false,
              onProgress,
              includeResponseValues: job.data.includeResponseValues !== false,
              includeGeoGebraResponseValues:
                job.data.includeGeoGebraResponseValues === true,
              includeGeoGebraFiles: job.data.includeGeoGebraFiles === true,
              missingsProfileId: job.data.missingsProfileId,
              checkCancellation
            };
            await this.codingExportOrchestratorService.exportResultsByVersionAsExcelToFile(
              filePath,
              excelOptions
            );
          } else {
            // CSV Stream
            const stream =
              await this.codingExportOrchestratorService.exportResultsByVersionAsCsv(
                {
                  workspaceId: job.data.workspaceId,
                  version,
                  authToken: job.data.authToken || '',
                  serverUrl: job.data.serverUrl || '',
                  includeReplayUrl: job.data.includeReplayUrl || false,
                  onProgress,
                  includeResponseValues:
                    job.data.includeResponseValues !== false,
                  includeGeoGebraResponseValues:
                    job.data.includeGeoGebraResponseValues === true,
                  missingsProfileId: job.data.missingsProfileId,
                  checkCancellation
                }
              );

            await this.writeStreamToFile(stream, filePath, {
              prependUtf8Bom: true,
              checkCancellation,
              cancellationSignal
            });
          }
          break;
        }

        case 'coding-list': {
          const onProgress = async (percentage: number) => {
            const jobProgress = 20 + Math.round((percentage / 100) * 70);
            await this.updateJobProgress(job, jobProgress, {
              phase: 'writing'
            });
            await checkCancellation();
          };

          if (job.data.format === 'excel') {
            await this.codingExportService.exportCodingListForJobAsExcelToFile(
              filePath,
              job.data.workspaceId,
              job.data.authToken || '',
              job.data.serverUrl || '',
              onProgress,
              job.data.trainingRequired,
              checkCancellation
            );
          } else if (job.data.format === 'json') {
            const stream =
              await this.codingExportService.exportCodingListForJobAsJson(
                job.data.workspaceId,
                job.data.authToken || '',
                job.data.serverUrl || '',
                onProgress,
                job.data.trainingRequired,
                checkCancellation
              );

            await this.writeStreamToFile(stream, filePath, {
              checkCancellation,
              cancellationSignal
            });
          } else {
            // CSV
            const stream =
              await this.codingExportService.exportCodingListForJobAsCsv(
                job.data.workspaceId,
                job.data.authToken || '',
                job.data.serverUrl || '',
                onProgress,
                job.data.trainingRequired,
                checkCancellation
              );

            await this.writeStreamToFile(stream, filePath, {
              prependUtf8Bom: true,
              checkCancellation,
              cancellationSignal
            });
          }
          break;
        }

        case 'item-matrix': {
          const onProgress = async (percentage: number) => {
            const jobProgress = 20 + Math.round((percentage / 100) * 70);
            await this.updateJobProgress(job, jobProgress, {
              phase: 'writing'
            });
            await checkCancellation();
          };

          if (job.data.format === 'excel') {
            await this.codingExportOrchestratorService.exportItemMatrixAsExcelToFile(
              filePath,
              {
                workspaceId: job.data.workspaceId,
                missingsProfileId: job.data.missingsProfileId,
                matrixValue: job.data.matrixValue || 'score',
                version: job.data.version || 'v2',
                notReachedScope: job.data.notReachedScope || 'unit',
                recodeTrailingOmissions:
                  job.data.recodeTrailingOmissions || false,
                items: job.data.items,
                onProgress,
                checkCancellation
              }
            );
          } else {
            const stream =
              await this.codingExportOrchestratorService.exportItemMatrixAsCsv({
                workspaceId: job.data.workspaceId,
                missingsProfileId: job.data.missingsProfileId,
                matrixValue: job.data.matrixValue || 'score',
                version: job.data.version || 'v2',
                notReachedScope: job.data.notReachedScope || 'unit',
                recodeTrailingOmissions:
                  job.data.recodeTrailingOmissions || false,
                items: job.data.items,
                onProgress,
                checkCancellation
              });

            await this.writeStreamToFile(stream, filePath, {
              prependUtf8Bom: true,
              checkCancellation,
              cancellationSignal
            });
          }
          break;
        }

        case 'psychometrics': {
          const onProgress = async (
            percentage: number,
            details?: {
              processedRows?: number;
              totalRows?: number;
            }
          ) => {
            const jobProgress = 20 + Math.round((percentage / 100) * 70);
            await this.updateJobProgress(job, jobProgress, {
              phase: 'writing',
              processedRows: details?.processedRows,
              totalRows: details?.totalRows
            });
            await checkCancellation();
          };
          const exportOptions = {
            workspaceId: job.data.workspaceId,
            version: job.data.version || 'v2',
            partWholeCorrection: job.data.partWholeCorrection !== false,
            missingsProfileId: job.data.missingsProfileId,
            domain: job.data.domain || { mode: 'workspace' as const },
            maxCategoryCount: job.data.maxCategoryCount ?? 10,
            onProgress,
            checkCancellation
          };

          if (job.data.format === 'excel') {
            await this.codingPsychometricExportService.writePsychometricsExcelToFile(
              filePath,
              exportOptions
            );
          } else {
            const stream =
              await this.codingPsychometricExportService.exportPsychometricsAsCsv(
                exportOptions
              );
            await this.writeStreamToFile(stream, filePath, {
              prependUtf8Bom: true,
              checkCancellation,
              cancellationSignal
            });
          }
          break;
        }

        case 'aggregated':
          await this.codingExportService.exportCodingResultsAggregatedToFile(
            filePath,
            job.data.workspaceId,
            job.data.outputCommentsInsteadOfCodes || false,
            job.data.includeReplayUrl || false,
            job.data.anonymizeCoders || false,
            job.data.usePseudoCoders || false,
            job.data.doubleCodingMethod || 'most-frequent',
            job.data.includeComments || false,
            job.data.includeModalValue || false,
            job.data.authToken || '',
            undefined, // req is not available in background job
            job.data.excludeAutoCoded || false,
            checkCancellation,
            job.data.jobDefinitionIds,
            job.data.coderTrainingIds,
            job.data.coderIds,
            job.data.serverUrl || '',
            job.data.includeResponseValues || false
          );
          break;

        case 'by-coder':
          await this.codingExportService.exportCodingResultsByCoderToFile(
            filePath,
            job.data.workspaceId,
            job.data.outputCommentsInsteadOfCodes || false,
            job.data.includeReplayUrl || false,
            job.data.anonymizeCoders || false,
            job.data.usePseudoCoders || false,
            job.data.authToken || '',
            undefined, // req is not available in background job
            job.data.excludeAutoCoded || false,
            checkCancellation,
            job.data.jobDefinitionIds,
            job.data.coderTrainingIds,
            job.data.coderIds,
            job.data.serverUrl || ''
          );
          break;

        case 'by-variable':
          await this.codingExportService.exportCodingResultsByVariableToFile(
            filePath,
            job.data.workspaceId,
            job.data.includeModalValue || false,
            job.data.includeDoubleCoded || false,
            job.data.includeComments || false,
            job.data.outputCommentsInsteadOfCodes || false,
            job.data.includeReplayUrl || false,
            job.data.anonymizeCoders || false,
            job.data.usePseudoCoders || false,
            job.data.authToken || '',
            undefined, // req is not available in background job
            job.data.excludeAutoCoded || false,
            checkCancellation,
            job.data.jobDefinitionIds,
            job.data.coderTrainingIds,
            job.data.coderIds,
            job.data.serverUrl || ''
          );
          break;

        case 'by-variable-compact':
          await this.writeStreamToFile(
            this.codingExportService.exportCodingResultsByVariableCompactAsCsvStream(
              job.data.workspaceId,
              job.data.includeModalValue || false,
              job.data.includeDoubleCoded || false,
              job.data.includeComments || false,
              job.data.outputCommentsInsteadOfCodes || false,
              job.data.includeReplayUrl || false,
              job.data.anonymizeCoders || false,
              job.data.usePseudoCoders || false,
              job.data.authToken || '',
              undefined, // req is not available in background job
              job.data.excludeAutoCoded || false,
              checkCancellation,
              job.data.jobDefinitionIds,
              job.data.coderTrainingIds,
              job.data.coderIds,
              job.data.serverUrl || ''
            ),
            filePath,
            {
              prependUtf8Bom: true,
              checkCancellation,
              cancellationSignal
            }
          );
          break;

        case 'detailed':
          await this.codingExportOrchestratorService.exportDetailedToFile(
            filePath,
            {
              workspaceId: job.data.workspaceId,
              outputCommentsInsteadOfCodes:
                job.data.outputCommentsInsteadOfCodes || false,
              includeReplayUrl: job.data.includeReplayUrl || false,
              anonymizeCoders: job.data.anonymizeCoders || false,
              usePseudoCoders: job.data.usePseudoCoders || false,
              authToken: job.data.authToken || '',
              excludeAutoCoded: job.data.excludeAutoCoded || false,
              checkCancellation,
              jobDefinitionIds: job.data.jobDefinitionIds,
              coderTrainingIds: job.data.coderTrainingIds,
              coderIds: job.data.coderIds,
              serverUrl: job.data.serverUrl || '',
              includeResponseValues: job.data.includeResponseValues || false
            }
          );
          break;

        case 'coding-times':
          await this.codingExportService.exportCodingTimesReportToFile(
            filePath,
            job.data.workspaceId,
            job.data.anonymizeCoders || false,
            job.data.usePseudoCoders || false,
            job.data.excludeAutoCoded || false,
            checkCancellation,
            job.data.jobDefinitionIds,
            job.data.coderTrainingIds,
            job.data.coderIds
          );
          break;

        case 'test-results':
          filePath = filePath.replace(/\.xlsx$/, '.csv');
          await this.workspaceTestResultsService.exportTestResultsToFile(
            job.data.workspaceId,
            filePath,
            job.data.testResultFilters,
            async progress => {
              const jobProgress = 20 + Math.round((progress / 100) * 70);
              await this.updateJobProgress(job, jobProgress, {
                phase: 'writing'
              });
              await this.checkCancellation(job, filePath);
            }
          );
          break;

        case 'test-logs':
          filePath = filePath.replace(/\.xlsx$/, '.csv');
          await this.workspaceTestResultsService.exportTestLogsToFile(
            job.data.workspaceId,
            filePath,
            job.data.testResultFilters,
            async progress => {
              const jobProgress = 20 + Math.round((progress / 100) * 70);
              await this.updateJobProgress(job, jobProgress, {
                phase: 'writing'
              });
              await this.checkCancellation(job, filePath);
            }
          );
          break;

        // no default - exportType is validated at the start of the method
      }

      await this.checkCancellation(job, filePath);
      const generationFinishedAt = Date.now();

      await this.updateJobProgress(job, 90, { phase: 'finalizing' });

      const fileWriteFinishedAt = Date.now();

      await this.checkCancellation(job, filePath);

      const stats = fs.statSync(filePath);
      const fileSize = stats.size;
      const finalFileName =
        job.data.exportType === 'item-matrix' ?
          `Itemdatensatz-${new Date().toISOString().slice(0, 10)}.${fileExt}` :
          path.basename(filePath);

      this.logger.log(
        `Export file generated successfully: ${finalFileName} (${fileSize} bytes) ` +
        `in ${fileWriteFinishedAt - startedAt}ms ` +
        `(generation: ${generationFinishedAt - generationStartedAt}ms, ` +
        `file write: ${fileWriteFinishedAt - generationFinishedAt}ms)`
      );

      // Cache file metadata in Redis with 1 hour TTL
      const metadata: ExportJobResult = {
        fileId: job.id.toString(),
        fileName: finalFileName,
        filePath,
        fileSize,
        workspaceId: job.data.workspaceId,
        userId: job.data.userId,
        exportType: job.data.exportType,
        createdAt: Date.now()
      };

      await this.cacheService.set(
        `export-result:${job.id}`,
        metadata,
        3600 // 1 hour TTL
      );

      await this.updateJobProgress(job, 100, { phase: 'completed' });

      this.logger.log(
        `Job ${job.id} completed successfully in ${Date.now() - startedAt}ms`
      );
      return metadata;
    } catch (error) {
      if (error instanceof ExportJobCancelledException) {
        this.logger.log(
          `Export job ${job.id} was cancelled after ${Date.now() - startedAt}ms`
        );
        this.cleanupPartialExportFile(filePath);
        return this.createCancelledResult(job);
      }
      this.logger.error(
        `Error processing export job ${job.id}: ${error.message}`,
        error.stack
      );
      this.cleanupPartialExportFile(filePath);
      throw error;
    } finally {
      this.jobQueueService.clearExportJobCancellationSignal(jobId);
    }
  }
}
