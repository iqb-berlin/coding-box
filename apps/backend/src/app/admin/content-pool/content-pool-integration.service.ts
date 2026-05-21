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
  username: string;
  password: string;
  overwriteExisting?: boolean;
  overwriteFileIds?: string[];
}

export interface UploadWorkspaceFilesToAcpInput {
  workspaceId: number;
  acpId: string;
  username: string;
  password: string;
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

interface ContentPoolOidcConfig {
  enabled?: boolean;
  issuerUrl?: string;
  clientId?: string;
  scope?: string;
}

@Injectable()
export class ContentPoolIntegrationService {
  private readonly enabledSettingKey = 'system-content-pool-enabled';

  private readonly baseUrlSettingKey = 'system-content-pool-base-url';

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
    const [enabledSetting, baseUrlSetting] = await Promise.all([
      this.settingRepository.findOne({
        where: { key: this.enabledSettingKey }
      }),
      this.settingRepository.findOne({
        where: { key: this.baseUrlSettingKey }
      })
    ]);

    return {
      enabled: enabledSetting?.content === 'true',
      baseUrl: (baseUrlSetting?.content || '').trim()
    };
  }

  async updateSettings(input: ContentPoolSettings): Promise<ContentPoolSettings> {
    const baseUrl = (input.baseUrl || '').trim();

    if (input.enabled && !baseUrl) {
      throw new BadRequestException(
        'Content-Pool URL darf bei aktiviertem Feature nicht leer sein.'
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

    return {
      enabled: input.enabled,
      baseUrl
    };
  }

  async listAccessibleAcps(
    username: string,
    password: string
  ): Promise<{ settings: ContentPoolSettings; acps: ContentPoolAcpSummary[] }> {
    const settings = await this.getSettings();
    this.assertFeatureEnabled(settings);

    const apiBaseUrl = this.normalizeApiBaseUrl(settings.baseUrl);
    const token = await this.authenticate(apiBaseUrl, username, password);
    const acps = await this.fetchAcps(apiBaseUrl, token);

    return { settings, acps };
  }

  async importAcpFilesToWorkspace(
    input: ImportAcpToWorkspaceInput,
    reportProgress?: (update: ContentPoolImportProgressUpdate) => void
  ): Promise<TestFilesUploadResultDto> {
    reportProgress?.({
      phase: 'authenticating',
      message: 'Authentifizierung am Content Pool...',
      progress: 5
    });

    const settings = await this.getSettings();
    this.assertFeatureEnabled(settings);

    if (!input.acpId || !input.acpId.trim()) {
      throw new BadRequestException('acpId ist erforderlich.');
    }

    const apiBaseUrl = this.normalizeApiBaseUrl(settings.baseUrl);
    const token = await this.authenticate(apiBaseUrl, input.username, input.password);
    reportProgress?.({
      phase: 'checking-acp',
      message: 'ACP-Zugriff wird geprüft...',
      progress: 12
    });
    const acps = await this.fetchAcps(apiBaseUrl, token);
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
    const acpFiles = await this.fetchAcpFiles(apiBaseUrl, token, input.acpId);
    reportProgress?.({
      phase: 'downloading-files',
      message: 'Dateien werden aus dem Content Pool geladen...',
      processedFiles: 0,
      totalFiles: acpFiles.length,
      progress: acpFiles.length > 0 ? 20 : 100
    });
    const fileIos = await this.downloadAcpFilesAsFileIo(
      apiBaseUrl,
      token,
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
      message: 'Authentifizierung am Content Pool...',
      progress: 5
    });

    const settings = await this.getSettings();
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
    const token = await this.authenticate(apiBaseUrl, input.username, input.password);

    reportProgress?.({
      phase: 'checking-acp',
      message: 'ACP-Zugriff wird geprüft...',
      progress: 12
    });
    const acps = await this.fetchAcps(apiBaseUrl, token);
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
    const acpFiles = await this.fetchAcpFiles(apiBaseUrl, token, input.acpId);
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
    for (const workspaceFile of orderedWorkspaceFiles) {
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

      reportProgress?.({
        phase: 'replacing-files',
        message: `Datei wird ersetzt: ${workspaceFile.filename}`,
        processedFiles,
        totalFiles: orderedWorkspaceFiles.length,
        currentFileName: workspaceFile.filename,
        progress: this.calculateUploadFilesProgress(
          processedFiles,
          orderedWorkspaceFiles.length
        )
      });

      try {
        await this.deleteAcpFile(apiBaseUrl, token, input.acpId, targetFile.id);
        await this.uploadAcpFile(
          apiBaseUrl,
          token,
          input.acpId,
          workspaceFile,
          targetFile.originalName || workspaceFile.filename
        );
        result.replaced += 1;
        result.replacedFiles.push({
          fileId: workspaceFile.id,
          filename: workspaceFile.filename
        });
      } catch (error) {
        result.failed += 1;
        result.failedFiles.push({
          fileId: workspaceFile.id,
          filename: workspaceFile.filename,
          reason: this.extractExceptionMessage(
            error,
            'Datei konnte nicht in den Content Pool übertragen werden.'
          )
        });
      }

      processedFiles += 1;
      this.reportUploadFileProgress(
        reportProgress,
        workspaceFile.filename,
        processedFiles,
        orderedWorkspaceFiles.length
      );
    }

    if (result.replaced > 0) {
      const changelog = (input.changelog || '').trim() ||
        `Dateien aus Coding-Box ersetzt: ${
          result.replacedFiles.map(file => file.filename).join(', ')
        }`;

      reportProgress?.({
        phase: 'creating-snapshot',
        message: 'ACP-Snapshot wird erstellt...',
        processedFiles,
        totalFiles: orderedWorkspaceFiles.length,
        currentFileName: undefined,
        progress: 94
      });
      const snapshot = await this.createSnapshot(
        apiBaseUrl,
        token,
        input.acpId,
        changelog
      );

      result.snapshotId = snapshot?.id ? String(snapshot.id) : undefined;
      result.versionNumber = Number.isFinite(snapshot?.versionNumber) ?
        Number(snapshot.versionNumber) :
        undefined;
      result.changelog = changelog;
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

  private assertFeatureEnabled(settings: ContentPoolSettings): void {
    if (!settings.enabled) {
      throw new ForbiddenException(
        'Die Content-Pool-Integration ist in den Systemeinstellungen deaktiviert.'
      );
    }

    if (!settings.baseUrl) {
      throw new BadRequestException('Keine Content-Pool-URL konfiguriert.');
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

  private async authenticate(
    apiBaseUrl: string,
    username: string,
    password: string
  ): Promise<string> {
    if (!username || !password) {
      throw new BadRequestException(
        'Benutzername und Passwort für den Content Pool sind erforderlich.'
      );
    }

    try {
      return await this.authenticateWithPasswordLogin(
        apiBaseUrl,
        username,
        password
      );
    } catch (error) {
      if (this.shouldTryOidcAuthentication(error)) {
        try {
          return await this.authenticateWithOidcPasswordGrant(
            apiBaseUrl,
            username,
            password
          );
        } catch (oidcError) {
          return this.throwHttpError(
            oidcError,
            'Authentifizierung am Content Pool über Keycloak fehlgeschlagen',
            UnauthorizedException
          );
        }
      }

      return this.throwHttpError(
        error,
        'Authentifizierung am Content Pool fehlgeschlagen',
        UnauthorizedException
      );
    }
  }

  private async authenticateWithPasswordLogin(
    apiBaseUrl: string,
    username: string,
    password: string
  ): Promise<string> {
    const response = await this.httpService.axiosRef.post(
      `${apiBaseUrl}/auth/login`,
      {
        username,
        password
      }
    );

    return this.extractContentPoolAccessToken(response.data);
  }

  private async authenticateWithOidcPasswordGrant(
    apiBaseUrl: string,
    username: string,
    password: string
  ): Promise<string> {
    const configResponse = await this.httpService.axiosRef.get(
      `${apiBaseUrl}/auth/oidc-config`
    );
    const oidcConfig = configResponse.data as ContentPoolOidcConfig;

    if (!oidcConfig?.enabled || !oidcConfig.issuerUrl || !oidcConfig.clientId) {
      throw new UnauthorizedException(
        'Keycloak-Anmeldung ist im Content Pool nicht konfiguriert.'
      );
    }

    let issuerUrl = oidcConfig.issuerUrl;
    while (issuerUrl.endsWith('/')) {
      issuerUrl = issuerUrl.slice(0, -1);
    }

    const tokenRequest = new URLSearchParams({
      grant_type: 'password',
      client_id: oidcConfig.clientId,
      username,
      password,
      scope: oidcConfig.scope || 'openid profile email'
    });

    const tokenResponse = await this.httpService.axiosRef.post(
      `${issuerUrl}/protocol/openid-connect/token`,
      tokenRequest.toString(),
      {
        headers: {
          'content-type': 'application/x-www-form-urlencoded'
        }
      }
    );

    const oidcToken = tokenResponse.data?.id_token ||
      tokenResponse.data?.access_token;

    if (!oidcToken) {
      throw new UnauthorizedException(
        'Keycloak-Login war erfolgreich, aber es wurde kein Token geliefert.'
      );
    }

    const callbackResponse = await this.httpService.axiosRef.post(
      `${apiBaseUrl}/auth/oidc-callback`,
      { idToken: oidcToken }
    );

    return this.extractContentPoolAccessToken(callbackResponse.data);
  }

  private extractContentPoolAccessToken(data: unknown): string {
    const source = data as {
      accessToken?: string;
      access_token?: string;
      token?: string;
    };
    const token = source?.accessToken || source?.access_token || source?.token;

    if (!token) {
      throw new UnauthorizedException(
        'Content-Pool-Login war erfolgreich, aber es wurde kein Token geliefert.'
      );
    }

    return String(token);
  }

  private shouldTryOidcAuthentication(error: unknown): boolean {
    const status = (error as AxiosError)?.response?.status;
    return Boolean((error as AxiosError)?.isAxiosError) &&
      (status === 401 || status === 404);
  }

  private async fetchAcps(
    apiBaseUrl: string,
    token: string
  ): Promise<ContentPoolAcpSummary[]> {
    try {
      const response = await this.httpService.axiosRef.get(
        `${apiBaseUrl}/acp`,
        {
          headers: { Authorization: `Bearer ${token}` }
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
        `${apiBaseUrl}/acp/${encodeURIComponent(acpId)}/files`,
        {
          headers: { Authorization: `Bearer ${token}` }
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
          `${apiBaseUrl}/acp/${encodeURIComponent(acpId)}/files/${encodeURIComponent(file.id)}/download`,
          {
            headers: { Authorization: `Bearer ${token}` },
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

  private async deleteAcpFile(
    apiBaseUrl: string,
    token: string,
    acpId: string,
    fileId: string
  ): Promise<void> {
    try {
      await this.httpService.axiosRef.delete(
        `${apiBaseUrl}/acp/${encodeURIComponent(acpId)}/files/${encodeURIComponent(fileId)}`,
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );
    } catch (error) {
      this.throwHttpError(
        error,
        'Bestehende Datei im Content Pool konnte nicht gelöscht werden.'
      );
    }
  }

  private async uploadAcpFile(
    apiBaseUrl: string,
    token: string,
    acpId: string,
    workspaceFile: FileUpload,
    targetFileName: string
  ): Promise<void> {
    const formData = new FormData();
    formData.append('files', this.decodeStoredFileData(workspaceFile.data), {
      filename: targetFileName,
      contentType: this.inferMimeType(targetFileName)
    });

    try {
      await this.httpService.axiosRef.post(
        `${apiBaseUrl}/acp/${encodeURIComponent(acpId)}/files/upload`,
        formData,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            ...formData.getHeaders()
          },
          maxBodyLength: Infinity
        }
      );
    } catch (error) {
      this.throwHttpError(
        error,
        'Neue Datei konnte nicht in den Content Pool hochgeladen werden.'
      );
    }
  }

  private async createSnapshot(
    apiBaseUrl: string,
    token: string,
    acpId: string,
    changelog: string
  ): Promise<{ id?: string; versionNumber?: number }> {
    try {
      const response = await this.httpService.axiosRef.post(
        `${apiBaseUrl}/acp/${encodeURIComponent(acpId)}/snapshots`,
        { changelog },
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );
      return response.data || {};
    } catch (error) {
      return this.throwHttpError(
        error,
        'Snapshot im Content Pool konnte nicht erstellt werden.'
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
