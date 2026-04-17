import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { InjectRepository } from '@nestjs/typeorm';
import { AxiosError } from 'axios';
import * as FormData from 'form-data';
import { Repository } from 'typeorm';
import FileUpload from '../../database/entities/file_upload.entity';
import { Setting } from '../../database/entities/setting.entity';

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

export interface ReplaceCodingSchemeInput {
  workspaceId: number;
  fileId: number;
  acpId: string;
  username: string;
  password: string;
  changelog?: string;
}

@Injectable()
export class ContentPoolIntegrationService {
  private readonly enabledSettingKey = 'system-content-pool-enabled';

  private readonly baseUrlSettingKey = 'system-content-pool-base-url';

  constructor(
    @InjectRepository(Setting)
    private readonly settingRepository: Repository<Setting>,
    @InjectRepository(FileUpload)
    private readonly fileUploadRepository: Repository<FileUpload>,
    private readonly httpService: HttpService
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

  async replaceCodingSchemeInAcp(input: ReplaceCodingSchemeInput): Promise<{
    acpId: string;
    fileName: string;
    snapshotId?: string;
    versionNumber?: number;
    changelog: string;
  }> {
    const settings = await this.getSettings();
    this.assertFeatureEnabled(settings);

    if (!input.acpId || !input.acpId.trim()) {
      throw new BadRequestException('acpId ist erforderlich.');
    }

    const workspaceFile = await this.fileUploadRepository.findOne({
      where: {
        id: input.fileId,
        workspace_id: input.workspaceId
      }
    });

    if (!workspaceFile) {
      throw new NotFoundException(
        `Datei ${input.fileId} wurde im Workspace ${input.workspaceId} nicht gefunden.`
      );
    }

    if (!workspaceFile.filename.toLowerCase().endsWith('.vocs')) {
      throw new BadRequestException(
        'Es können nur .vocs-Dateien in den Content Pool übertragen werden.'
      );
    }

    const apiBaseUrl = this.normalizeApiBaseUrl(settings.baseUrl);
    const token = await this.authenticate(apiBaseUrl, input.username, input.password);
    const acps = await this.fetchAcps(apiBaseUrl, token);
    const targetAcp = acps.find(acp => acp.id === input.acpId);

    if (!targetAcp) {
      throw new ForbiddenException(
        'Kein Zugriff auf das gewählte ACP im Content Pool.'
      );
    }

    const acpFiles = await this.fetchAcpFiles(apiBaseUrl, token, input.acpId);
    const existingFile = acpFiles.find(file => {
      const originalName = String(file?.originalName || '').toLowerCase();
      return originalName === workspaceFile.filename.toLowerCase();
    });

    if (!existingFile?.id) {
      throw new NotFoundException(
        `Kodierschema "${workspaceFile.filename}" ist im gewählten ACP nicht vorhanden.`
      );
    }

    await this.deleteAcpFile(
      apiBaseUrl,
      token,
      input.acpId,
      String(existingFile.id)
    );
    await this.uploadAcpFile(
      apiBaseUrl,
      token,
      input.acpId,
      workspaceFile,
      String(existingFile.originalName || workspaceFile.filename)
    );

    const changelog = (input.changelog || '').trim() ||
      `Kodierschema aus Coding-Box ersetzt: ${workspaceFile.filename}`;
    const snapshot = await this.createSnapshot(
      apiBaseUrl,
      token,
      input.acpId,
      changelog
    );

    return {
      acpId: input.acpId,
      fileName: workspaceFile.filename,
      snapshotId: snapshot?.id ? String(snapshot.id) : undefined,
      versionNumber: Number.isFinite(snapshot?.versionNumber) ?
        Number(snapshot.versionNumber) :
        undefined,
      changelog
    };
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

    const withProtocol = /^https?:\/\//i.test(trimmed) ?
      trimmed :
      `https://${trimmed}`;
    const normalized = withProtocol.replace(/\/+$/, '');

    try {
      // Validate URL
      // eslint-disable-next-line no-new
      new URL(normalized);
    } catch {
      throw new BadRequestException(
        `Ungültige Content-Pool-URL: "${rawBaseUrl}"`
      );
    }

    return /\/api$/i.test(normalized) ? normalized : `${normalized}/api`;
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
      const response = await this.httpService.axiosRef.post(
        `${apiBaseUrl}/auth/login`,
        {
          username,
          password
        }
      );

      const token = response.data?.accessToken ||
        response.data?.access_token ||
        response.data?.token;

      if (!token) {
        throw new UnauthorizedException(
          'Content-Pool-Login war erfolgreich, aber es wurde kein Token geliefert.'
        );
      }

      return String(token);
    } catch (error) {
      this.throwHttpError(
        error,
        'Authentifizierung am Content Pool fehlgeschlagen',
        UnauthorizedException
      );
    }
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
      this.throwHttpError(
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
      this.throwHttpError(
        error,
        'Dateiliste des gewählten ACP konnte nicht geladen werden.'
      );
    }
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
        'Bestehendes Kodierschema im Content Pool konnte nicht gelöscht werden.'
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
      contentType: 'application/json'
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
        'Neues Kodierschema konnte nicht in den Content Pool hochgeladen werden.'
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
      this.throwHttpError(
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
    message: string,
    defaultErrorType: new (message?: string) => Error = InternalServerErrorException
  ): never {
    if ((error as AxiosError)?.isAxiosError) {
      const axiosError = error as AxiosError<{
        message?: string | string[];
        error?: string;
      }>;
      const status = axiosError.response?.status;
      const responseMessage = this.extractResponseMessage(axiosError.response?.data);
      const details = responseMessage ? ` (${responseMessage})` : '';
      const fullMessage = `${message}${details}`;

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

    throw new defaultErrorType(message);
  }

  private extractResponseMessage(
    payload: unknown
  ): string | undefined {
    const source = payload as { message?: string | string[]; error?: string };
    if (Array.isArray(source?.message)) {
      return source.message.join(', ');
    }
    if (typeof source?.message === 'string') {
      return source.message;
    }
    if (typeof source?.error === 'string') {
      return source.error;
    }
    return undefined;
  }
}
