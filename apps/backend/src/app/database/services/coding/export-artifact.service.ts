import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import type {
  ItemMatrixExportDiagnosticsDto,
  ItemMatrixExportErrorDetailsDto,
  ItemMatrixExportRequest
} from '../../../../../../../api-dto/coding/export-request.dto';
import { CacheService } from '../../../cache/cache.service';
import type { ExportJobResult } from '../../../job-queue/job-queue.service';
import {
  CachedItemMatrixDiagnostics,
  writeIncompleteItemMatrixPackage
} from './item-matrix-export-diagnostics.util';

interface PublishIncompleteItemMatrixArtifactOptions {
  jobId: string;
  matrixPath: string;
  matrixExtension: 'csv' | 'xlsx';
  tempDir: string;
  workspaceId: number;
  userId: number;
  exportType: ItemMatrixExportRequest['exportType'];
  version: NonNullable<ItemMatrixExportRequest['version']>;
  matrixValue: NonNullable<ItemMatrixExportRequest['matrixValue']>;
  missingsProfileId: number;
  diagnostics: ItemMatrixExportDiagnosticsDto;
  checkCancellation: () => Promise<void>;
}

interface PublishExportArtifactOptions {
  jobId: string;
  workingFilePath: string;
  tempDir: string;
  fileName: string;
  workspaceId: number;
  userId: number;
  exportType: string;
  checkCancellation: () => Promise<void>;
}

@Injectable()
export class ExportArtifactService {
  static readonly ttlSeconds = 3600;

  private readonly logger = new Logger(ExportArtifactService.name);

  constructor(private readonly cacheService: CacheService) {}

  static getDiagnosticsCacheKey(jobId: string): string {
    return `item-matrix-diagnostics:${jobId}`;
  }

  static getIncompleteResultCacheKey(jobId: string): string {
    return `item-matrix-incomplete-result:${jobId}`;
  }

  static getExportResultCacheKey(jobId: string): string {
    return `export-result:${jobId}`;
  }

  async publishIncompleteArtifact(
    options: PublishIncompleteItemMatrixArtifactOptions
  ): Promise<ExportJobResult> {
    const createdAt = Date.now();
    const date = new Date(createdAt).toISOString().slice(0, 10);
    const packageWorkingPath = options.matrixPath.replace(
      /\.(csv|xlsx)$/i,
      '-incomplete.zip'
    );
    const packageFileName = `Itemdatensatz-UNVOLLSTAENDIG-${date}.zip`;
    const matrixFileName =
      `Itemdatensatz-UNVOLLSTAENDIG-${date}.${options.matrixExtension}`;
    let packagePath: string | undefined;

    try {
      await options.checkCancellation();
      await writeIncompleteItemMatrixPackage(
        packageWorkingPath,
        options.matrixPath,
        matrixFileName,
        {
          diagnostics: options.diagnostics,
          version: options.version,
          matrixValue: options.matrixValue,
          missingsProfileId: options.missingsProfileId,
          createdAt
        }
      );
      await options.checkCancellation();
      packagePath = this.moveArtifact(packageWorkingPath, options.tempDir);
      await options.checkCancellation();

      const result: ExportJobResult = {
        fileId: options.jobId,
        fileName: packageFileName,
        filePath: packagePath,
        fileSize: fs.statSync(packagePath).size,
        workspaceId: options.workspaceId,
        userId: options.userId,
        exportType: options.exportType,
        createdAt
      };
      const cachedDiagnostics: CachedItemMatrixDiagnostics = {
        diagnostics: options.diagnostics,
        expiresAt:
          Date.now() + ExportArtifactService.ttlSeconds * 1000
      };
      const [resultCached, diagnosticsCached] = await Promise.all([
        this.cacheService.set(
          ExportArtifactService.getIncompleteResultCacheKey(
            options.jobId
          ),
          result,
          ExportArtifactService.ttlSeconds
        ),
        this.cacheService.set(
          ExportArtifactService.getDiagnosticsCacheKey(options.jobId),
          cachedDiagnostics,
          ExportArtifactService.ttlSeconds
        )
      ]);
      if (!resultCached || !diagnosticsCached) {
        throw new Error(
          'Unvollständiger Itemmatrix-Export konnte nicht vollständig veröffentlicht werden.'
        );
      }

      await options.checkCancellation();
      this.deleteFile(options.matrixPath, true);
      return result;
    } catch (error) {
      this.deleteFile(packageWorkingPath);
      this.deleteFile(packagePath);
      await Promise.allSettled([
        this.cacheService.delete(
          ExportArtifactService.getIncompleteResultCacheKey(
            options.jobId
          )
        ),
        this.cacheService.delete(
          ExportArtifactService.getDiagnosticsCacheKey(options.jobId)
        )
      ]);
      throw error;
    }
  }

  async getErrorDetails(
    jobId: string,
    fallbackTotal: number
  ): Promise<ItemMatrixExportErrorDetailsDto> {
    const [cachedDiagnostics, incompleteResult] = await Promise.all([
      this.cacheService.get<CachedItemMatrixDiagnostics>(
        ExportArtifactService.getDiagnosticsCacheKey(jobId)
      ),
      this.getIncompleteArtifact(jobId)
    ]);

    return {
      total: cachedDiagnostics?.diagnostics.total || fallbackTotal,
      groupCount: cachedDiagnostics?.diagnostics.groups.length || 0,
      sampleLimit: cachedDiagnostics?.diagnostics.sampleLimit || 20,
      diagnosticsAvailable: !!cachedDiagnostics,
      incompleteDownloadAvailable: !!incompleteResult,
      ...(cachedDiagnostics ? { expiresAt: cachedDiagnostics.expiresAt } : {})
    };
  }

  async getDiagnostics(
    jobId: string
  ): Promise<ItemMatrixExportDiagnosticsDto | null> {
    const cached = await this.cacheService.get<CachedItemMatrixDiagnostics>(
      ExportArtifactService.getDiagnosticsCacheKey(jobId)
    );
    return cached?.diagnostics || null;
  }

  async getIncompleteArtifact(jobId: string): Promise<ExportJobResult | null> {
    const metadata = await this.cacheService.get<ExportJobResult>(
      ExportArtifactService.getIncompleteResultCacheKey(jobId)
    );
    return metadata?.filePath && fs.existsSync(metadata.filePath) ? metadata : null;
  }

  async publishArtifact(
    options: PublishExportArtifactOptions
  ): Promise<ExportJobResult> {
    const cacheKey = ExportArtifactService.getExportResultCacheKey(
      options.jobId
    );
    let publishedFilePath: string | undefined;

    try {
      await options.checkCancellation();
      publishedFilePath = this.moveArtifact(
        options.workingFilePath,
        options.tempDir
      );
      await options.checkCancellation();

      const result: ExportJobResult = {
        fileId: options.jobId,
        fileName: options.fileName,
        filePath: publishedFilePath,
        fileSize: fs.statSync(publishedFilePath).size,
        workspaceId: options.workspaceId,
        userId: options.userId,
        exportType: options.exportType,
        createdAt: Date.now()
      };
      const cached = await this.cacheService.set(
        cacheKey,
        result,
        ExportArtifactService.ttlSeconds
      );
      if (!cached) {
        throw new Error('Export artifact could not be published');
      }
      await options.checkCancellation();
      return result;
    } catch (error) {
      this.deleteFile(publishedFilePath);
      await this.cacheService.delete(cacheKey);
      throw error;
    }
  }

  async getArtifact(jobId: string): Promise<ExportJobResult | null> {
    const metadata = await this.cacheService.get<ExportJobResult>(
      ExportArtifactService.getExportResultCacheKey(jobId)
    );
    return metadata?.filePath && fs.existsSync(metadata.filePath) ? metadata : null;
  }

  async deleteArtifacts(jobId: string): Promise<void> {
    const resultKeys = [
      ExportArtifactService.getExportResultCacheKey(jobId),
      ExportArtifactService.getIncompleteResultCacheKey(jobId)
    ];
    const results = await Promise.all(resultKeys.map(key => (
      this.cacheService.get<ExportJobResult>(key)
    )));

    new Set(
      results
        .map(metadata => metadata?.filePath)
        .filter((filePath): filePath is string => !!filePath)
    ).forEach(filePath => this.deleteFile(filePath, true));

    const cacheResults = await Promise.all([
      ...resultKeys.map(key => this.cacheService.delete(key)),
      this.cacheService.delete(
        ExportArtifactService.getDiagnosticsCacheKey(jobId)
      )
    ]);
    if (cacheResults.some(deleted => !deleted)) {
      throw new Error('Export artifacts could not be deleted completely');
    }
  }

  cleanupExpiredArtifacts(tempDir: string): void {
    const expiresBefore =
      Date.now() - ExportArtifactService.ttlSeconds * 1000;
    const entries = fs.readdirSync(tempDir, { withFileTypes: true });
    entries.forEach(entry => {
      const filePath = path.join(tempDir, entry.name);
      try {
        if (
          entry.isFile() &&
          /^export_.+\.(csv|xlsx|json|zip)$/i.test(entry.name) &&
          fs.statSync(filePath).mtimeMs < expiresBefore
        ) {
          this.deleteFile(filePath);
        }
      } catch (error) {
        this.logger.warn(
          `Failed to clean up expired export artifact ${filePath}: ${
            (error as Error).message
          }`
        );
      }
    });
  }

  private moveArtifact(workingFilePath: string, tempDir: string): string {
    const publishedFilePath = path.join(
      tempDir,
      path.basename(workingFilePath)
    );
    fs.renameSync(workingFilePath, publishedFilePath);
    return publishedFilePath;
  }

  private deleteFile(filePath?: string, failOnError = false): void {
    if (!filePath) {
      return;
    }
    try {
      fs.unlinkSync(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return;
      }
      this.logger.warn(
        `Failed to delete export artifact ${filePath}: ${(error as Error).message}`
      );
      if (failOnError) {
        throw error;
      }
    }
  }
}
