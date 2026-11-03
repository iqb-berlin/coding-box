import {
  Inject, Injectable, Logger, Optional
} from '@nestjs/common';
import { EntityManager, In, Repository } from 'typeorm';
import FileUpload from '../../entities/file_upload.entity';
import { TestResultsUploadIssueDto } from '../../../../../../../api-dto/files/test-results-upload-result.dto';
import { CodingFreshnessService } from '../coding/coding-freshness.service';
import { isCodingSchemeFileId } from './workspace-file-write.util';

interface VocsCode {
  id?: unknown;
  label?: unknown;
  manualInstruction?: unknown;
  [key: string]: unknown;
}

interface VocsVariableCoding {
  id?: unknown;
  alias?: unknown;
  label?: unknown;
  page?: unknown;
  codeModel?: unknown;
  manualInstruction?: unknown;
  codes?: VocsCode[];
  [key: string]: unknown;
}

interface ParsedCodingScheme {
  variableCodings?: VocsVariableCoding[];
}

interface CodingSchemeFreshnessImpact {
  autoCodingChanged: boolean;
  manualCodingChanged: boolean;
}

@Injectable()
export class WorkspaceFileFreshnessService {
  private readonly logger = new Logger(WorkspaceFileFreshnessService.name);

  constructor(
    @Optional() @Inject(CodingFreshnessService) private readonly codingFreshnessService?: CodingFreshnessService
  ) {}

  private normalizeCodingSchemeUnitName(fileId: unknown): string {
    return String(fileId || '')
      .trim()
      .toUpperCase()
      .replace(/\.VOCS$/i, '');
  }

  private parseCodingSchemeData(data: unknown): ParsedCodingScheme | null {
    if (data === null || data === undefined) {
      return null;
    }

    try {
      const parsed =
        typeof data === 'string' || Buffer.isBuffer(data) ?
          JSON.parse(Buffer.isBuffer(data) ? data.toString('utf8') : data) :
          data;

      if (!parsed || typeof parsed !== 'object') {
        return null;
      }

      return parsed as ParsedCodingScheme;
    } catch {
      return null;
    }
  }

  private getCodingSchemeVariableMap(
    data: unknown
  ): Map<string, VocsVariableCoding> | null {
    const parsed = this.parseCodingSchemeData(data);
    if (!parsed || !Array.isArray(parsed.variableCodings)) {
      return null;
    }

    const variables = new Map<string, VocsVariableCoding>();
    parsed.variableCodings.forEach(variableCoding => {
      const key = this.getCodingSchemeVariableKey(variableCoding);
      if (key) {
        variables.set(key, variableCoding);
      }
    });
    return variables;
  }

  private getCodingSchemeVariableKey(variableCoding: VocsVariableCoding): string {
    return String(variableCoding.id || variableCoding.alias || '').trim();
  }

  private getCodingSchemeRuleSignature(variableCoding: VocsVariableCoding): string {
    return this.stableStringify(
      this.omitKeysDeep(
        variableCoding,
        new Set(['manualInstruction', 'label', 'page'])
      )
    );
  }

  private getCodingSchemeManualSignature(variableCoding: VocsVariableCoding): string {
    const codes = Array.isArray(variableCoding.codes) ?
      variableCoding.codes.map(code => ({
        id: code.id ?? null,
        label: code.label ?? null,
        manualInstruction: code.manualInstruction ?? null
      })) :
      [];

    return this.stableStringify({
      codeModel: variableCoding.codeModel ?? null,
      label: variableCoding.label ?? null,
      manualInstruction: variableCoding.manualInstruction ?? null,
      page: variableCoding.page ?? null,
      codes
    });
  }

  private omitKeysDeep(value: unknown, omittedKeys: Set<string>): unknown {
    if (Array.isArray(value)) {
      return value.map(item => this.omitKeysDeep(item, omittedKeys));
    }

    if (!value || typeof value !== 'object') {
      return value ?? null;
    }

    const result: Record<string, unknown> = {};
    Object.keys(value as Record<string, unknown>)
      .sort()
      .forEach(key => {
        if (!omittedKeys.has(key)) {
          result[key] = this.omitKeysDeep(
            (value as Record<string, unknown>)[key],
            omittedKeys
          );
        }
      });
    return result;
  }

  private stableStringify(value: unknown): string {
    return JSON.stringify(this.sortObjectKeysDeep(value));
  }

  private sortObjectKeysDeep(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map(item => this.sortObjectKeysDeep(item));
    }

    if (!value || typeof value !== 'object') {
      return value ?? null;
    }

    const result: Record<string, unknown> = {};
    Object.keys(value as Record<string, unknown>)
      .sort()
      .forEach(key => {
        result[key] = this.sortObjectKeysDeep(
          (value as Record<string, unknown>)[key]
        );
      });
    return result;
  }

  private codingSchemeDataToText(data: unknown): string {
    if (data === null || data === undefined) {
      return '';
    }
    if (Buffer.isBuffer(data)) {
      return data.toString('utf8');
    }
    if (typeof data === 'string') {
      return data;
    }
    return this.stableStringify(data);
  }

  private getCodingSchemeFreshnessImpact(
    previousData: unknown,
    nextData: unknown
  ): CodingSchemeFreshnessImpact {
    const previousVariables = previousData === null || previousData === undefined ?
      new Map<string, VocsVariableCoding>() :
      this.getCodingSchemeVariableMap(previousData);
    const nextVariables = this.getCodingSchemeVariableMap(nextData);

    if (!previousVariables || !nextVariables) {
      const changed =
        this.codingSchemeDataToText(previousData) !== this.codingSchemeDataToText(nextData);
      return {
        autoCodingChanged: changed,
        manualCodingChanged: changed
      };
    }

    const allVariableKeys = new Set([
      ...previousVariables.keys(),
      ...nextVariables.keys()
    ]);
    let autoCodingChanged = false;
    let manualCodingChanged = false;

    allVariableKeys.forEach(variableKey => {
      const previousVariable = previousVariables.get(variableKey);
      const nextVariable = nextVariables.get(variableKey);

      if (!previousVariable || !nextVariable) {
        autoCodingChanged = true;
        manualCodingChanged = true;
        return;
      }

      if (
        this.getCodingSchemeRuleSignature(previousVariable) !==
        this.getCodingSchemeRuleSignature(nextVariable)
      ) {
        autoCodingChanged = true;
        manualCodingChanged = true;
        return;
      }

      if (
        this.getCodingSchemeManualSignature(previousVariable) !==
        this.getCodingSchemeManualSignature(nextVariable)
      ) {
        manualCodingChanged = true;
      }
    });

    return { autoCodingChanged, manualCodingChanged };
  }

  async markCodingSchemeFreshnessAfterFileChange(
    workspaceId: number,
    fileId: unknown,
    previousData: unknown,
    nextData: unknown,
    manager?: EntityManager
  ): Promise<TestResultsUploadIssueDto | undefined> {
    if (!this.codingFreshnessService || !isCodingSchemeFileId(fileId)) {
      return undefined;
    }

    const unitName = this.normalizeCodingSchemeUnitName(fileId);
    if (!unitName) {
      return undefined;
    }

    const impact = this.getCodingSchemeFreshnessImpact(previousData, nextData);
    if (!impact.autoCodingChanged && !impact.manualCodingChanged) {
      return undefined;
    }

    try {
      const scope = {
        autoCodingSchemeRefs: impact.autoCodingChanged ? [unitName] : [],
        manualCodingSchemeRefs: impact.manualCodingChanged ? [unitName] : []
      };
      if (manager) {
        await this.codingFreshnessService.markUnitsStaleAfterCodingSchemeChange(
          workspaceId,
          scope,
          manager
        );
      } else {
        await this.codingFreshnessService.markUnitsStaleAfterCodingSchemeChange(
          workspaceId,
          scope
        );
      }
      return undefined;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Could not update coding freshness after coding scheme change ${unitName}: ${detail}`
      );
      return {
        level: 'warning',
        category: 'coding_freshness',
        message: 'Datei wurde gespeichert, aber der Kodierstand konnte nicht zuverlässig aktualisiert werden. Bitte prüfen Sie den Kodierstand erneut.',
        fileName: String(fileId || unitName)
      };
    }
  }

  async collectCodingSchemeChangesForFreshness(
    workspaceId: number,
    entries: Record<string, unknown>[],
    fileUploadRepository: Repository<FileUpload>
  ): Promise<Array<{ fileId: string; previousData: unknown; nextData: unknown }>> {
    if (!workspaceId || entries.length === 0) {
      return [];
    }

    const codingSchemeEntries = entries
      .map(entry => ({
        fileId: String(entry.file_id || '').trim(),
        data: entry.data
      }))
      .filter(entry => isCodingSchemeFileId(entry.fileId));
    if (codingSchemeEntries.length === 0) {
      return [];
    }

    const fileIds = Array.from(new Set(
      codingSchemeEntries.map(entry => entry.fileId)
    ));
    const existingFiles = await fileUploadRepository.find({
      where: {
        workspace_id: workspaceId,
        file_id: In(fileIds)
      }
    });
    const existingDataByFileId = new Map(
      existingFiles.map(file => [String(file.file_id || ''), file.data])
    );

    return codingSchemeEntries.map(entry => ({
      fileId: entry.fileId,
      previousData: existingDataByFileId.get(entry.fileId),
      nextData: entry.data
    }));
  }
}
