import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { InjectRepository } from '@nestjs/typeorm';
import { AxiosError } from 'axios';
import { randomUUID } from 'crypto';
// eslint-disable-next-line import/no-extraneous-dependencies
import * as FormData from 'form-data';
import { In, Repository } from 'typeorm';
import FileUpload from '../../database/entities/file_upload.entity';
import { Setting } from '../../database/entities/setting.entity';
import { WorkspaceFilesService } from '../../database/services/workspace';
import { FileIo } from '../workspace/file-io.interface';
import { TestFilesUploadResultDto } from '../../../../../../api-dto/files/test-files-upload-result.dto';

export interface ContentPoolSettings {
  enabled: boolean;
  baseUrl: string;
  hasApplicationToken: boolean;
}

export interface UpdateContentPoolSettingsInput {
  enabled: boolean;
  baseUrl: string;
  applicationToken?: string;
  clearApplicationToken?: boolean;
}

interface ContentPoolRuntimeSettings extends ContentPoolSettings {
  applicationToken: string;
}

export interface ContentPoolAcpSummary {
  id: string;
  packageId?: string;
  name?: string;
  description?: string;
}

export interface ImportAcpToWorkspaceInput {
  workspaceId: number;
  acpId: string;
  overwriteExisting?: boolean;
  overwriteFileIds?: string[];
}

export interface UploadWorkspaceFilesToAcpInput {
  workspaceId: number;
  acpId: string;
  fileIds: number[];
  changelog?: string;
}

export interface ContentPoolUploadFileResult {
  fileId: number;
  filename: string;
  reason?: string;
}

export interface ContentPoolUploadFilesResult {
  acpId: string;
  total: number;
  replaced: number;
  skipped: number;
  failed: number;
  replacedFiles: ContentPoolUploadFileResult[];
  skippedFiles: ContentPoolUploadFileResult[];
  failedFiles: ContentPoolUploadFileResult[];
  snapshotId?: string;
  versionNumber?: number;
  changelog?: string;
}

export type ContentPoolImportJobStatus =
  'pending' |
  'running' |
  'completed' |
  'failed';

export type ContentPoolImportJobPhase =
  'queued' |
  'authenticating' |
  'checking-acp' |
  'loading-files' |
  'downloading-files' |
  'uploading-files' |
  'completed' |
  'failed';

export type ContentPoolUploadFilesJobPhase =
  'queued' |
  'authenticating' |
  'checking-acp' |
  'loading-files' |
  'replacing-files' |
  'creating-snapshot' |
  'completed' |
  'failed';

export interface ContentPoolImportJobProgress {
  jobId: string;
  status: ContentPoolImportJobStatus;
  phase: ContentPoolImportJobPhase;
  message: string;
  processedFiles: number;
  totalFiles: number;
  progress: number;
  currentFileName?: string;
  result?: TestFilesUploadResultDto;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContentPoolUploadFilesJobProgress {
  jobId: string;
  status: ContentPoolImportJobStatus;
  phase: ContentPoolUploadFilesJobPhase;
  message: string;
  processedFiles: number;
  totalFiles: number;
  progress: number;
  currentFileName?: string;
  result?: ContentPoolUploadFilesResult;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

type ContentPoolImportProgressUpdate = Partial<
Pick<
ContentPoolImportJobProgress,
'phase' |
'message' |
'processedFiles' |
'totalFiles' |
'progress' |
'currentFileName'
>
>;

type ContentPoolUploadProgressUpdate = Partial<
Pick<
ContentPoolUploadFilesJobProgress,
'phase' |
'message' |
'processedFiles' |
'totalFiles' |
'progress' |
'currentFileName'
>
>;

@Injectable()
export class ContentPoolIntegrationService {
  private readonly enabledSettingKey = 'system-content-pool-enabled';

  private readonly baseUrlSettingKey = 'system-content-pool-base-url';

  private readonly applicationTokenSettingKey = 'system-content-pool-application-token';

  private readonly importJobTtlMs = 30 * 60 * 1000;

  private readonly importJobs = new Map<string, ContentPoolImportJobProgress>();

  private readonly uploadFilesJobs = new Map<string, ContentPoolUploadFilesJobProgress>();

  constructor(
    @InjectRepository(Setting)
    private readonly settingRepository: Repository<Setting>,
    @InjectRepository(FileUpload)
    private readonly fileUploadRepository: Repository<FileUpload>,
    private readonly httpService: HttpService,
    private readonly workspaceFilesService: WorkspaceFilesService
  ) {}

  async getSettings(): Promise<ContentPoolSettings> {
    const settings = await this.getRuntimeSettings();

    return {
      enabled: settings.enabled,
      baseUrl: settings.baseUrl,
      hasApplicationToken: settings.hasApplicationToken
    };
  }

  async updateSettings(
    input: UpdateContentPoolSettingsInput
  ): Promise<ContentPoolSettings> {
    const baseUrl = (input.baseUrl || '').trim();
    const tokenInput = (input.applicationToken || '').trim();
    const existingToken = await this.getStoredApplicationToken();
    const applicationToken = input.clearApplicationToken && !tokenInput ?
      '' :
      tokenInput || existingToken;

    if (input.enabled && !baseUrl) {
      throw new BadRequestException(
        'Content-Pool URL darf bei aktiviertem Feature nicht leer sein.'
      );
    }

    if (input.enabled && !applicationToken) {
      throw new BadRequestException(
        'Content-Pool Application-Token darf bei aktiviertem Feature nicht leer sein.'
      );
    }

    if (baseUrl) {
      this.normalizeApiBaseUrl(baseUrl);
    }

    await this.upsertSetting(
      this.enabledSettingKey,
      input.enabled ? 'true' : 'false'
    );
    await this.upsertSetting(this.baseUrlSettingKey, baseUrl);
    if (input.clearApplicationToken || tokenInput) {
      await this.upsertSetting(this.applicationTokenSettingKey, applicationToken);
    }

    return {
      enabled: input.enabled,
      baseUrl,
      hasApplicationToken: !!applicationToken
    };
  }

  async listAccessibleAcps(): Promise<{
    settings: ContentPoolSettings;
    acps: ContentPoolAcpSummary[];
  }> {
    const settings = await this.getRuntimeSettings();
    this.assertFeatureEnabled(settings);

    const apiBaseUrl = this.normalizeApiBaseUrl(settings.baseUrl);
    const acps = await this.fetchAcps(apiBaseUrl, settings.applicationToken);

    return {
      settings: this.toPublicSettings(settings),
      acps
    };
  }

  private async getRuntimeSettings(): Promise<ContentPoolRuntimeSettings> {
    const [enabledSetting, baseUrlSetting, applicationTokenSetting] = await Promise.all([
      this.settingRepository.findOne({
        where: { key: this.enabledSettingKey }
      }),
      this.settingRepository.findOne({
        where: { key: this.baseUrlSettingKey }
      }),
      this.settingRepository.findOne({
        where: { key: this.applicationTokenSettingKey }
      })
    ]);
    const applicationToken = (applicationTokenSetting?.content || '').trim();

    return {
      enabled: enabledSetting?.content === 'true',
      baseUrl: (baseUrlSetting?.content || '').trim(),
      hasApplicationToken: !!applicationToken,
      applicationToken
    };
  }

  private async getStoredApplicationToken(): Promise<string> {
    const tokenSetting = await this.settingRepository.findOne({
      where: { key: this.applicationTokenSettingKey }
    });
    return (tokenSetting?.content || '').trim();
  }

  private toPublicSettings(settings: ContentPoolRuntimeSettings): ContentPoolSettings {
    return {
      enabled: settings.enabled,
      baseUrl: settings.baseUrl,
      hasApplicationToken: settings.hasApplicationToken
    };
  }

  async importAcpFilesToWorkspace(
    input: ImportAcpToWorkspaceInput,
    reportProgress?: (update: ContentPoolImportProgressUpdate) => void
  ): Promise<TestFilesUploadResultDto> {
    reportProgress?.({
      phase: 'authenticating',
      message: 'Content-Pool-Verbindung wird vorbereitet...',
      progress: 5
    });

    const settings = await this.getRuntimeSettings();
    this.assertFeatureEnabled(settings);

    if (!input.acpId || !input.acpId.trim()) {
      throw new BadRequestException('acpId ist erforderlich.');
    }

    const apiBaseUrl = this.normalizeApiBaseUrl(settings.baseUrl);
    reportProgress?.({
      phase: 'checking-acp',
      message: 'ACP-Zugriff wird geprüft...',
      progress: 12
    });
    const acps = await this.fetchAcps(apiBaseUrl, settings.applicationToken);
    const targetAcp = acps.find(acp => acp.id === input.acpId);

    if (!targetAcp) {
      throw new ForbiddenException(
        'Kein Zugriff auf das gewählte ACP im Content Pool.'
      );
    }

    reportProgress?.({
      phase: 'loading-files',
      message: 'Dateiliste des ACP wird geladen...',
      progress: 18
    });
    const acpFiles = await this.fetchAcpFiles(
      apiBaseUrl,
      settings.applicationToken,
      input.acpId
    );
    reportProgress?.({
      phase: 'downloading-files',
      message: 'Dateien werden aus dem Content Pool geladen...',
      processedFiles: 0,
      totalFiles: acpFiles.length,
      progress: acpFiles.length > 0 ? 20 : 100
    });
    const fileIos = await this.downloadAcpFilesAsFileIo(
      apiBaseUrl,
      settings.applicationToken,
      input.acpId,
      acpFiles,
      reportProgress
    );

    if (fileIos.length === 0) {
      return {
        total: 0,
        uploaded: 0,
        failed: 0,
        uploadedFiles: [],
        failedFiles: []
      };
    }

    reportProgress?.({
      phase: 'uploading-files',
      message: 'Dateien werden in die Testdateien-Abteilung übernommen...',
      processedFiles: fileIos.length,
      totalFiles: fileIos.length,
      currentFileName: undefined,
      progress: 92
    });

    return this.workspaceFilesService.uploadTestFiles(
      input.workspaceId,
      fileIos,
      !!input.overwriteExisting,
      input.overwriteFileIds
    );
  }

  startAcpImportToWorkspace(input: ImportAcpToWorkspaceInput): { jobId: string } {
    this.cleanupImportJobs();

    const now = new Date().toISOString();
    const jobId = randomUUID();
    this.importJobs.set(jobId, {
      jobId,
      status: 'pending',
      phase: 'queued',
      message: 'Import wird vorbereitet...',
      processedFiles: 0,
      totalFiles: 0,
      progress: 0,
      createdAt: now,
      updatedAt: now
    });

    this.runAcpImportJob(jobId, input).catch(() => {
      this.updateImportJob(jobId, {
        status: 'failed',
        phase: 'failed',
        message: 'ACP-Import fehlgeschlagen.',
        progress: 100,
        error: 'ACP konnte nicht importiert werden.'
      });
    });

    return { jobId };
  }

  getAcpImportProgress(jobId: string): ContentPoolImportJobProgress {
    const job = this.importJobs.get(jobId);
    if (!job) {
      throw new NotFoundException('Import-Job wurde nicht gefunden.');
    }

    return { ...job };
  }

  async uploadWorkspaceFilesToAcp(
    input: UploadWorkspaceFilesToAcpInput,
    reportProgress?: (update: ContentPoolUploadProgressUpdate) => void
  ): Promise<ContentPoolUploadFilesResult> {
    if (!input.fileIds?.length) {
      throw new BadRequestException('Mindestens eine Datei ist erforderlich.');
    }

    reportProgress?.({
      phase: 'authenticating',
      message: 'Content-Pool-Verbindung wird vorbereitet...',
      progress: 5
    });

    const settings = await this.getRuntimeSettings();
    this.assertFeatureEnabled(settings);

    if (!input.acpId || !input.acpId.trim()) {
      throw new BadRequestException('acpId ist erforderlich.');
    }

    const workspaceFiles = await this.fileUploadRepository.find({
      where: {
        id: In(input.fileIds),
        workspace_id: input.workspaceId
      }
    });
    const workspaceFilesById = new Map(workspaceFiles.map(file => [file.id, file]));
    const orderedWorkspaceFiles = input.fileIds
      .map(fileId => workspaceFilesById.get(fileId))
      .filter((file): file is FileUpload => !!file);

    if (orderedWorkspaceFiles.length !== input.fileIds.length) {
      throw new NotFoundException(
        'Mindestens eine ausgewählte Datei wurde im Workspace nicht gefunden.'
      );
    }

    const apiBaseUrl = this.normalizeApiBaseUrl(settings.baseUrl);

    reportProgress?.({
      phase: 'checking-acp',
      message: 'ACP-Zugriff wird geprüft...',
      progress: 12
    });
    const acps = await this.fetchAcps(apiBaseUrl, settings.applicationToken);
    const targetAcp = acps.find(acp => acp.id === input.acpId);

    if (!targetAcp) {
      throw new ForbiddenException(
        'Kein Zugriff auf das gewählte ACP im Content Pool.'
      );
    }

    reportProgress?.({
      phase: 'loading-files',
      message: 'Dateiliste des ACP wird geladen...',
      progress: 18
    });
    const acpFiles = await this.fetchAcpFiles(
      apiBaseUrl,
      settings.applicationToken,
      input.acpId
    );
    const acpFileByName = new Map(
      acpFiles.map(file => [file.originalName.toLowerCase(), file])
    );

    const result: ContentPoolUploadFilesResult = {
      acpId: input.acpId,
      total: orderedWorkspaceFiles.length,
      replaced: 0,
      skipped: 0,
      failed: 0,
      replacedFiles: [],
      skippedFiles: [],
      failedFiles: []
    };

    let processedFiles = 0;
    const replacementPlan: Array<{
      workspaceFile: FileUpload;
      targetFileName: string;
    }> = [];
    for (const workspaceFile of orderedWorkspaceFiles) {
      if (!this.isCodingSchemeFile(workspaceFile.filename)) {
        processedFiles += 1;
        result.skipped += 1;
        result.skippedFiles.push({
          fileId: workspaceFile.id,
          filename: workspaceFile.filename,
          reason: 'Nur Kodierschemata (.vocs) können im Content Pool ersetzt werden.'
        });
        this.reportUploadFileProgress(
          reportProgress,
          workspaceFile.filename,
          processedFiles,
          orderedWorkspaceFiles.length
        );
        continue;
      }

      const targetFile = acpFileByName.get(workspaceFile.filename.toLowerCase());
      if (!targetFile?.id) {
        processedFiles += 1;
        result.skipped += 1;
        result.skippedFiles.push({
          fileId: workspaceFile.id,
          filename: workspaceFile.filename,
          reason: 'Keine Datei mit gleichem Namen im ACP gefunden.'
        });
        this.reportUploadFileProgress(
          reportProgress,
          workspaceFile.filename,
          processedFiles,
          orderedWorkspaceFiles.length
        );
        continue;
      }

      replacementPlan.push({
        workspaceFile,
        targetFileName: targetFile.originalName || workspaceFile.filename
      });
    }

    if (replacementPlan.length > 0) {
      const changelog = (input.changelog || '').trim() ||
        `Dateien aus Coding-Box ersetzt: ${
          replacementPlan.map(plan => plan.workspaceFile.filename).join(', ')
        }`;

      reportProgress?.({
        phase: 'replacing-files',
        message: 'Kodierschemata werden im Content Pool ersetzt...',
        processedFiles,
        totalFiles: orderedWorkspaceFiles.length,
        currentFileName: undefined,
        progress: this.calculateUploadFilesProgress(
          processedFiles,
          orderedWorkspaceFiles.length
        )
      });

      try {
        const replacement = await this.replaceCodingSchemeFiles(
          apiBaseUrl,
          settings.applicationToken,
          input.acpId,
          replacementPlan,
          changelog
        );
        result.snapshotId = replacement.snapshot?.id ?
          String(replacement.snapshot.id) :
          undefined;
        result.versionNumber = Number.isFinite(replacement.snapshot?.versionNumber) ?
          Number(replacement.snapshot.versionNumber) :
          undefined;
        result.changelog = changelog;

        for (const plan of replacementPlan) {
          processedFiles += 1;
          result.replaced += 1;
          result.replacedFiles.push({
            fileId: plan.workspaceFile.id,
            filename: plan.workspaceFile.filename
          });
          this.reportUploadFileProgress(
            reportProgress,
            plan.workspaceFile.filename,
            processedFiles,
            orderedWorkspaceFiles.length
          );
        }
      } catch (error) {
        for (const plan of replacementPlan) {
          processedFiles += 1;
          result.failed += 1;
          result.failedFiles.push({
            fileId: plan.workspaceFile.id,
            filename: plan.workspaceFile.filename,
            reason: this.extractExceptionMessage(
              error,
              'Datei konnte nicht in den Content Pool übertragen werden.'
            )
          });
          this.reportUploadFileProgress(
            reportProgress,
            plan.workspaceFile.filename,
            processedFiles,
            orderedWorkspaceFiles.length
          );
        }
      }
    }

    return result;
  }

  startUploadWorkspaceFilesToAcp(
    input: UploadWorkspaceFilesToAcpInput
  ): { jobId: string } {
    this.cleanupUploadFilesJobs();

    const now = new Date().toISOString();
    const jobId = randomUUID();
    this.uploadFilesJobs.set(jobId, {
      jobId,
      status: 'pending',
      phase: 'queued',
      message: 'Upload wird vorbereitet...',
      processedFiles: 0,
      totalFiles: input.fileIds?.length || 0,
      progress: 0,
      createdAt: now,
      updatedAt: now
    });

    this.runUploadFilesJob(jobId, input).catch(() => {
      this.updateUploadFilesJob(jobId, {
        status: 'failed',
        phase: 'failed',
        message: 'Upload in den Content Pool fehlgeschlagen.',
        progress: 100,
        error: 'Dateien konnten nicht in den Content Pool übertragen werden.'
      });
    });

    return { jobId };
  }

  getUploadWorkspaceFilesProgress(jobId: string): ContentPoolUploadFilesJobProgress {
    const job = this.uploadFilesJobs.get(jobId);
    if (!job) {
      throw new NotFoundException('Upload-Job wurde nicht gefunden.');
    }

    return { ...job };
  }

  private async runAcpImportJob(
    jobId: string,
    input: ImportAcpToWorkspaceInput
  ): Promise<void> {
    this.updateImportJob(jobId, {
      status: 'running'
    });

    try {
      const result = await this.importAcpFilesToWorkspace(
        input,
        update => this.updateImportJob(jobId, {
          status: 'running',
          ...update
        })
      );

      this.updateImportJob(jobId, {
        status: 'completed',
        phase: 'completed',
        message: 'ACP-Import abgeschlossen.',
        progress: 100,
        result
      });
    } catch (error) {
      this.updateImportJob(jobId, {
        status: 'failed',
        phase: 'failed',
        message: 'ACP-Import fehlgeschlagen.',
        progress: 100,
        error: this.extractExceptionMessage(
          error,
          'ACP konnte nicht importiert werden.'
        )
      });
    }
  }

  private updateImportJob(
    jobId: string,
    update: Partial<ContentPoolImportJobProgress>
  ): void {
    const job = this.importJobs.get(jobId);
    if (!job) {
      return;
    }

    this.importJobs.set(jobId, {
      ...job,
      ...update,
      updatedAt: new Date().toISOString()
    });
  }

  private cleanupImportJobs(): void {
    const now = Date.now();
    for (const [jobId, job] of this.importJobs.entries()) {
      if (now - Date.parse(job.updatedAt) > this.importJobTtlMs) {
        this.importJobs.delete(jobId);
      }
    }
  }

  private async runUploadFilesJob(
    jobId: string,
    input: UploadWorkspaceFilesToAcpInput
  ): Promise<void> {
    this.updateUploadFilesJob(jobId, {
      status: 'running'
    });

    try {
      const result = await this.uploadWorkspaceFilesToAcp(
        input,
        update => this.updateUploadFilesJob(jobId, {
          status: 'running',
          ...update
        })
      );

      this.updateUploadFilesJob(jobId, {
        status: 'completed',
        phase: 'completed',
        message: 'Upload in den Content Pool abgeschlossen.',
        progress: 100,
        result
      });
    } catch (error) {
      this.updateUploadFilesJob(jobId, {
        status: 'failed',
        phase: 'failed',
        message: 'Upload in den Content Pool fehlgeschlagen.',
        progress: 100,
        error: this.extractExceptionMessage(
          error,
          'Dateien konnten nicht in den Content Pool übertragen werden.'
        )
      });
    }
  }

  private updateUploadFilesJob(
    jobId: string,
    update: Partial<ContentPoolUploadFilesJobProgress>
  ): void {
    const job = this.uploadFilesJobs.get(jobId);
    if (!job) {
      return;
    }

    this.uploadFilesJobs.set(jobId, {
      ...job,
      ...update,
      updatedAt: new Date().toISOString()
    });
  }

  private cleanupUploadFilesJobs(): void {
    const now = Date.now();
    for (const [jobId, job] of this.uploadFilesJobs.entries()) {
      if (now - Date.parse(job.updatedAt) > this.importJobTtlMs) {
        this.uploadFilesJobs.delete(jobId);
      }
    }
  }

  private reportUploadFileProgress(
    reportProgress: ((update: ContentPoolUploadProgressUpdate) => void) | undefined,
    fileName: string,
    processedFiles: number,
    totalFiles: number
  ): void {
    reportProgress?.({
      phase: 'replacing-files',
      message: `Datei verarbeitet: ${fileName}`,
      processedFiles,
      totalFiles,
      currentFileName: fileName,
      progress: this.calculateUploadFilesProgress(processedFiles, totalFiles)
    });
  }

  private calculateUploadFilesProgress(
    processedFiles: number,
    totalFiles: number
  ): number {
    if (totalFiles <= 0) {
      return 100;
    }

    return 20 + Math.round((processedFiles / totalFiles) * 70);
  }

  private extractExceptionMessage(error: unknown, fallback: string): string {
    if (error instanceof HttpException) {
      const response = error.getResponse();
      if (typeof response === 'string') {
        return response;
      }

      const payload = response as { message?: string | string[] };
      if (Array.isArray(payload?.message)) {
        return payload.message.join(', ');
      }
      if (typeof payload?.message === 'string') {
        return payload.message;
      }
    }

    if (error instanceof Error && error.message) {
      return error.message;
    }

    return fallback;
  }

  private assertFeatureEnabled(settings: ContentPoolRuntimeSettings): void {
    if (!settings.enabled) {
      throw new ForbiddenException(
        'Die Content-Pool-Integration ist in den Systemeinstellungen deaktiviert.'
      );
    }

    if (!settings.baseUrl) {
      throw new BadRequestException('Keine Content-Pool-URL konfiguriert.');
    }

    if (!settings.applicationToken) {
      throw new BadRequestException(
        'Kein Content-Pool Application-Token konfiguriert.'
      );
    }
  }

  private async upsertSetting(key: string, content: string): Promise<void> {
    const existing = await this.settingRepository.findOne({ where: { key } });
    if (existing) {
      existing.content = content;
      await this.settingRepository.save(existing);
      return;
    }

    await this.settingRepository.save(
      this.settingRepository.create({
        key,
        content
      })
    );
  }

  private normalizeApiBaseUrl(rawBaseUrl: string): string {
    const trimmed = (rawBaseUrl || '').trim();
    if (!trimmed) {
      throw new BadRequestException('Content-Pool-URL ist leer.');
    }

    const lowerTrimmed = trimmed.toLowerCase();
    const withProtocol = lowerTrimmed.startsWith('http://') ||
      lowerTrimmed.startsWith('https://') ?
      trimmed :
      `https://${trimmed}`;
    let normalized = withProtocol;
    while (normalized.endsWith('/')) {
      normalized = normalized.slice(0, -1);
    }

    try {
      // Validate URL
      // eslint-disable-next-line no-new
      new URL(normalized);
    } catch {
      throw new BadRequestException(
        `Ungültige Content-Pool-URL: "${rawBaseUrl}"`
      );
    }

    return normalized.toLowerCase().endsWith('/api') ?
      normalized :
      `${normalized}/api`;
  }

  private getApplicationTokenHeaders(token: string): { 'X-Server-Token': string } {
    return { 'X-Server-Token': token };
  }

  private async fetchAcps(
    apiBaseUrl: string,
    token: string
  ): Promise<ContentPoolAcpSummary[]> {
    try {
      const response = await this.httpService.axiosRef.get(
        `${apiBaseUrl}/server/acp`,
        {
          headers: this.getApplicationTokenHeaders(token)
        }
      );

      if (!Array.isArray(response.data)) {
        return [];
      }

      return response.data.map((acp: unknown) => {
        const source = acp as {
          id?: string;
          packageId?: string;
          name?: string;
          description?: string;
        };

        return {
          id: String(source.id),
          packageId: source.packageId ? String(source.packageId) : undefined,
          name: source.name ? String(source.name) : undefined,
          description: source.description ? String(source.description) : undefined
        };
      });
    } catch (error) {
      return this.throwHttpError(
        error,
        'ACP-Liste aus dem Content Pool konnte nicht geladen werden.'
      );
    }
  }

  private async fetchAcpFiles(
    apiBaseUrl: string,
    token: string,
    acpId: string
  ): Promise<Array<{ id: string; originalName: string }>> {
    try {
      const response = await this.httpService.axiosRef.get(
        `${apiBaseUrl}/server/acp/${encodeURIComponent(acpId)}/files`,
        {
          headers: this.getApplicationTokenHeaders(token)
        }
      );

      if (!Array.isArray(response.data)) {
        return [];
      }

      return response.data.map((file: unknown) => {
        const source = file as { id?: string; originalName?: string };
        return {
          id: String(source.id),
          originalName: String(source.originalName || '')
        };
      });
    } catch (error) {
      return this.throwHttpError(
        error,
        'Dateiliste des gewählten ACP konnte nicht geladen werden.'
      );
    }
  }

  private async downloadAcpFilesAsFileIo(
    apiBaseUrl: string,
    token: string,
    acpId: string,
    files: Array<{ id: string; originalName: string }>,
    reportProgress?: (update: ContentPoolImportProgressUpdate) => void
  ): Promise<FileIo[]> {
    const fileIos: FileIo[] = [];
    let processedFiles = 0;

    for (const file of files) {
      if (!file.id || !file.originalName) {
        processedFiles += 1;
        reportProgress?.({
          phase: 'downloading-files',
          processedFiles,
          totalFiles: files.length,
          progress: this.calculateDownloadProgress(processedFiles, files.length)
        });
        continue;
      }

      reportProgress?.({
        phase: 'downloading-files',
        message: `Datei wird geladen: ${file.originalName}`,
        processedFiles,
        totalFiles: files.length,
        currentFileName: file.originalName,
        progress: this.calculateDownloadProgress(processedFiles, files.length)
      });

      try {
        const response = await this.httpService.axiosRef.get(
          `${apiBaseUrl}/server/acp/${encodeURIComponent(acpId)}/files/${encodeURIComponent(file.id)}/download`,
          {
            headers: this.getApplicationTokenHeaders(token),
            responseType: 'arraybuffer'
          }
        );
        const buffer = Buffer.from(response.data);

        fileIos.push({
          fieldname: 'files',
          originalname: file.originalName,
          encoding: '7bit',
          mimetype: this.inferMimeType(
            file.originalName,
            response.headers?.['content-type']
          ),
          buffer,
          size: buffer.length
        });
        processedFiles += 1;
        reportProgress?.({
          phase: 'downloading-files',
          message: `Datei geladen: ${file.originalName}`,
          processedFiles,
          totalFiles: files.length,
          currentFileName: file.originalName,
          progress: this.calculateDownloadProgress(processedFiles, files.length)
        });
      } catch (error) {
        this.throwHttpError(
          error,
          `Datei "${file.originalName}" konnte nicht aus dem Content Pool geladen werden.`
        );
      }
    }

    return fileIos;
  }

  private calculateDownloadProgress(processedFiles: number, totalFiles: number): number {
    if (totalFiles <= 0) {
      return 100;
    }

    return 20 + Math.round((processedFiles / totalFiles) * 68);
  }

  private inferMimeType(fileName: string, contentType?: string): string {
    const normalizedContentType = (contentType || '').toLowerCase().split(';')[0].trim();
    const extension = fileName.includes('.') ?
      fileName.slice(fileName.lastIndexOf('.')).toLowerCase() :
      '';

    if (extension === '.xml') {
      return 'application/xml';
    }
    if (extension === '.html' || extension === '.htm' || extension === '.xhtml') {
      return 'text/html';
    }
    if (extension === '.zip') {
      return 'application/zip';
    }

    if (
      ['.vocs', '.voud', '.vomd', '.json', '.txt', '.csv'].includes(extension)
    ) {
      return 'application/octet-stream';
    }

    return normalizedContentType || 'application/octet-stream';
  }

  private isCodingSchemeFile(fileName: string): boolean {
    return fileName.toLowerCase().endsWith('.vocs');
  }

  private async replaceCodingSchemeFiles(
    apiBaseUrl: string,
    token: string,
    acpId: string,
    replacementPlan: Array<{ workspaceFile: FileUpload; targetFileName: string }>,
    changelog: string
  ): Promise<{
      snapshot?: {
        id?: string;
        versionNumber?: number;
      };
    }> {
    const formData = new FormData();
    for (const plan of replacementPlan) {
      formData.append('files', this.decodeStoredFileData(plan.workspaceFile.data), {
        filename: plan.targetFileName,
        contentType: this.inferMimeType(plan.targetFileName)
      });
    }
    formData.append('changelog', changelog);

    try {
      const response = await this.httpService.axiosRef.post(
        `${apiBaseUrl}/server/acp/${encodeURIComponent(acpId)}/coding-schemes/replace`,
        formData,
        {
          headers: {
            ...this.getApplicationTokenHeaders(token),
            ...formData.getHeaders()
          },
          maxBodyLength: Infinity
        }
      );
      return response.data || {};
    } catch (error) {
      return this.throwHttpError(
        error,
        'Kodierschemata konnten nicht im Content Pool ersetzt werden.'
      );
    }
  }

  private decodeStoredFileData(data: string): Buffer {
    if (/^[A-Za-z0-9+/]*={0,2}$/.test(data) && data.length % 4 === 0) {
      try {
        return Buffer.from(data, 'base64');
      } catch {
        // fall back to utf8 below
      }
    }

    return Buffer.from(data, 'utf8');
  }

  private throwHttpError(
    error: unknown,
    fallbackMessage: string,
    DefaultErrorType: new (message?: string) => Error = InternalServerErrorException
  ): never {
    if ((error as AxiosError)?.isAxiosError) {
      const axiosError = error as AxiosError<{
        message?: string | string[];
        error?: string;
        error_description?: string;
      }>;
      const status = axiosError.response?.status;
      const responseMessage = this.extractResponseMessage(axiosError.response?.data);
      const details = responseMessage ? ` (${responseMessage})` : '';
      const fullMessage = `${fallbackMessage}${details}`;

      if (status === 400) {
        throw new BadRequestException(fullMessage);
      }
      if (status === 401) {
        throw new UnauthorizedException(fullMessage);
      }
      if (status === 403) {
        throw new ForbiddenException(fullMessage);
      }
      if (status === 404) {
        throw new NotFoundException(fullMessage);
      }
      throw new InternalServerErrorException(fullMessage);
    }

    throw new DefaultErrorType(fallbackMessage);
  }

  private extractResponseMessage(
    payload: unknown
  ): string | undefined {
    const source = payload as {
      message?: string | string[];
      error?: string;
      error_description?: string;
    };
    if (Array.isArray(source?.message)) {
      return source.message.join(', ');
    }
    if (typeof source?.message === 'string') {
      return source.message;
    }
    if (typeof source?.error === 'string') {
      if (typeof source.error_description === 'string') {
        return source.error_description;
      }
      return source.error;
    }
    return undefined;
  }
}
