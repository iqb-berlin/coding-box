import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import {
  PsychometricDomainCandidatesDto,
  PsychometricDomainFieldSelection,
  PsychometricDomainSelection
} from '../../../../../../../api-dto/coding/psychometric-discrimination.dto';
import FileUpload from '../../entities/file_upload.entity';
import { WorkspaceFilesService } from '../workspace/workspace-files.service';
import { MissingsProfilesService } from './missings-profiles.service';
import {
  getPsychometricLogicalKey,
  normalizePsychometricUnitKey,
  normalizePsychometricVariableKey
} from './psychometric-key.util';
import {
  LanguageCodedText,
  MetadataScalarValue,
  PsychometricItemMapping,
  PsychometricMappedItem,
  PsychometricMetadataScope,
  PsychometricMissingDefinition,
  StoredMetadataProfile,
  StoredSimpleValue,
  StoredVocabularyEntry,
  StoredVomd,
  VomdDocument
} from './psychometric-export.types';

@Injectable()
export class PsychometricMetadataResolver {
  constructor(
    @InjectRepository(FileUpload)
    private readonly fileUploadRepository: Repository<FileUpload>,
    private readonly workspaceFilesService: WorkspaceFilesService,
    private readonly missingsProfilesService: MissingsProfilesService
  ) {}

  async getDomainCandidates(
    workspaceId: number
  ): Promise<PsychometricDomainCandidatesDto> {
    const mapping = await this.buildItemMapping(workspaceId);
    return this.getDomainCandidatesForMapping(mapping);
  }

  async buildItemMapping(
    workspaceId: number
  ): Promise<PsychometricItemMapping> {
    const [unitDetails, vomdDocuments] = await Promise.all([
      this.workspaceFilesService.getUnitVariableDetails(workspaceId),
      this.loadVomdDocuments(workspaceId)
    ]);
    const items: PsychometricMappedItem[] = [];
    const byLogicalKey = new Map<string, PsychometricMappedItem>();
    const issues: string[] = [];
    const unitDetailsByKey = new Map(
      unitDetails.map(unit => [
        normalizePsychometricUnitKey(unit.unitName),
        unit
      ])
    );
    const documentsByUnit = new Map<string, VomdDocument[]>();
    vomdDocuments.forEach(document => {
      const documents = documentsByUnit.get(document.unitKey) || [];
      documents.push(document);
      documentsByUnit.set(document.unitKey, documents);
    });

    unitDetailsByKey.forEach((unit, unitKey) => {
      const documents = documentsByUnit.get(unitKey) || [];
      if (documents.length === 0) {
        issues.push(`${unit.unitName}: keine VOMD-Datei`);
        return;
      }

      documents
        .flatMap(document => document.items.map(vomdItem => ({
          document,
          vomdItem
        }))
        )
        .forEach(({ document, vomdItem }) => {
          const vomdVariableId = String(vomdItem.variableId || '').trim();
          const itemId = String(vomdItem.id || vomdVariableId || '?');
          if (!vomdVariableId) {
            issues.push(
              `${unit.unitName}/${itemId}: VOMD-Item ohne variableId`
            );
            return;
          }

          const normalizedVomdVariableId =
            normalizePsychometricVariableKey(vomdVariableId);
          const variableCandidates = unit.variables.filter(variable => [variable.alias, variable.id]
            .map(value => normalizePsychometricVariableKey(value))
            .includes(normalizedVomdVariableId)
          );
          if (variableCandidates.length === 0) {
            issues.push(
              `${unit.unitName}/${itemId}: Variable ${vomdVariableId} nicht gefunden`
            );
            return;
          }
          if (variableCandidates.length > 1) {
            issues.push(
              `${unit.unitName}/${itemId}: Variable ${vomdVariableId} ist mehrdeutig`
            );
            return;
          }

          const variable = variableCandidates[0];
          const variableId = String(variable.alias || variable.id).trim();
          const sourceVariableId = String(variable.id || variableId).trim();
          const key = getPsychometricLogicalKey(unit.unitName, variableId);
          if (items.some(item => item.key === key)) {
            issues.push(`${unit.unitName}/${variableId}: mehrere VOMD-Items`);
            return;
          }
          const mappedItem: PsychometricMappedItem = {
            key,
            unitName: unit.unitName,
            variableId,
            sourceVariableId,
            itemId: String(vomdItem.id || variableId),
            itemLabel: String(
              vomdItem.description || vomdItem.id || variableId
            ),
            variable,
            vomd: document,
            vomdItem
          };
          items.push(mappedItem);

          [variableId, sourceVariableId].forEach(responseVariableId => {
            const logicalKey = getPsychometricLogicalKey(
              unit.unitName,
              responseVariableId
            );
            const existing = byLogicalKey.get(logicalKey);
            if (existing && existing !== mappedItem) {
              issues.push(
                `${unit.unitName}/${responseVariableId}: mehrdeutige Variablenzuordnung`
              );
            } else {
              byLogicalKey.set(logicalKey, mappedItem);
            }
          });
        });
    });

    return { items, byLogicalKey, issues };
  }

  assignDomains(
    mapping: PsychometricItemMapping,
    selection: PsychometricDomainSelection
  ): void {
    if (selection.mode === 'workspace') {
      mapping.items.forEach(item => {
        item.domain = {
          id: 'WORKSPACE',
          label: 'Gesamter Workspace'
        };
      });
      return;
    }

    const { candidates } = this.getDomainCandidatesForMapping(mapping);
    const selectedCandidate = candidates.find(
      candidate => candidate.scope === selection.scope &&
        candidate.profileId === selection.profileId &&
        candidate.entryId === selection.entryId
    );
    if (!selectedCandidate?.selectable) {
      throw new BadRequestException(
        'Das ausgewählte VOMD-Domänenfeld ist nicht vollständig und einwertig'
      );
    }

    mapping.items.forEach(item => {
      const profiles =
        selection.scope === 'UNIT' ?
          item.vomd.profiles :
          item.vomdItem.profiles || [];
      const values = this.getSelectedMetadataValues(profiles, selection);
      if (values.length !== 1) {
        throw new BadRequestException(
          `Domänenwert für ${item.unitName}/${item.variableId} ist nicht eindeutig`
        );
      }
      item.domain = values[0];
    });
  }

  async loadMissingDefinitions(
    workspaceId: number,
    requestedProfileId?: number
  ): Promise<PsychometricMissingDefinition[]> {
    const profileId =
      await this.missingsProfilesService.resolveMissingsProfileId(
        workspaceId,
        requestedProfileId
      );
    const profile =
      await this.missingsProfilesService.getMissingsProfileDetails(
        workspaceId,
        profileId
      );
    if (!profile) {
      throw new BadRequestException(
        `Missing-Profil ${profileId} wurde nicht gefunden`
      );
    }

    return profile.parseMissings().map(missing => ({
      id: missing.id,
      code: Number(missing.code),
      score: missing.score === null ? null : Number(missing.score),
      label: missing.label
    }));
  }

  private getDomainCandidatesForMapping(
    mapping: PsychometricItemMapping
  ): PsychometricDomainCandidatesDto {
    const itemCount = mapping.items.length;
    const mappingIssueCount = mapping.issues.length;
    const candidates = new Map<
    string,
    {
      scope: PsychometricMetadataScope;
      profileId: string;
      entryId: string;
      label: string;
      valuesByItem: Map<string, MetadataScalarValue[]>;
    }
    >();

    mapping.items.forEach(item => {
      this.addCandidateEntries(candidates, item, 'UNIT', item.vomd.profiles);
      this.addCandidateEntries(
        candidates,
        item,
        'ITEM',
        item.vomdItem.profiles || []
      );
    });

    const domainCandidates = Array.from(candidates.values())
      .map(candidate => {
        const values = mapping.items.map(
          item => candidate.valuesByItem.get(item.key) || []
        );
        const coverage = values.filter(
          itemValues => itemValues.length > 0
        ).length;
        const singleValued = values.every(
          itemValues => itemValues.length <= 1
        );

        return {
          scope: candidate.scope,
          profileId: candidate.profileId,
          entryId: candidate.entryId,
          label: candidate.label,
          coverage,
          itemCount,
          singleValued,
          selectable:
            itemCount > 0 &&
            coverage === itemCount &&
            singleValued &&
            mappingIssueCount === 0
        };
      })
      .sort(
        (left, right) => left.scope.localeCompare(right.scope) ||
          left.label.localeCompare(right.label, 'de', {
            numeric: true,
            sensitivity: 'base'
          })
      );

    return {
      candidates: domainCandidates,
      mappingIssueCount
    };
  }

  private async loadVomdDocuments(
    workspaceId: number
  ): Promise<VomdDocument[]> {
    const files = await this.fileUploadRepository.find({
      where: [
        {
          workspace_id: workspaceId,
          file_type: 'Resource',
          filename: ILike('%.vomd')
        },
        {
          workspace_id: workspaceId,
          file_type: 'Resource',
          file_id: ILike('%.vomd')
        }
      ],
      select: ['id', 'file_id', 'filename', 'data']
    });
    const uniqueFiles = Array.from(
      new Map(files.map(file => [file.id, file])).values()
    );

    return uniqueFiles.map(file => {
      let parsed: StoredVomd;
      try {
        parsed = JSON.parse(String(file.data || '')) as StoredVomd;
      } catch (error) {
        throw new BadRequestException(
          `VOMD-Datei '${file.filename}' ist kein gültiges JSON: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }

      return {
        fileName: file.filename,
        unitKey: normalizePsychometricUnitKey(file.file_id || file.filename),
        profiles: this.getCurrentMetadataProfiles(parsed.profiles),
        items: (Array.isArray(parsed.items) ? parsed.items : []).map(
          item => ({
            ...item,
            profiles: this.getCurrentMetadataProfiles(item.profiles)
          })
        )
      };
    });
  }

  private getCurrentMetadataProfiles(
    profiles: StoredMetadataProfile[] | undefined
  ): StoredMetadataProfile[] {
    return (Array.isArray(profiles) ? profiles : []).filter(
      profile => profile.isCurrent !== false
    );
  }

  private addCandidateEntries(
    candidates: Map<
    string,
    {
      scope: PsychometricMetadataScope;
      profileId: string;
      entryId: string;
      label: string;
      valuesByItem: Map<string, MetadataScalarValue[]>;
    }
    >,
    item: PsychometricMappedItem,
    scope: PsychometricMetadataScope,
    profiles: StoredMetadataProfile[]
  ): void {
    profiles.forEach(profile => {
      const profileId = String(profile.profileId || '').trim();
      if (!profileId) {
        return;
      }
      (profile.entries || []).forEach(entry => {
        const entryId = String(entry.id || '').trim();
        if (!entryId) {
          return;
        }
        const key = this.getDomainFieldKey({
          mode: 'vomd-field',
          scope,
          profileId,
          entryId
        });
        const candidate = candidates.get(key) || {
          scope,
          profileId,
          entryId,
          label: this.getLocalizedText(entry.label) || entryId,
          valuesByItem: new Map<string, MetadataScalarValue[]>()
        };
        candidate.valuesByItem.set(
          item.key,
          this.normalizeMetadataValue(entry.value)
        );
        candidates.set(key, candidate);
      });
    });
  }

  private getSelectedMetadataValues(
    profiles: StoredMetadataProfile[],
    selection: PsychometricDomainFieldSelection
  ): MetadataScalarValue[] {
    const profile = profiles.find(
      item => item.profileId === selection.profileId
    );
    const entry = (profile?.entries || []).find(
      item => item.id === selection.entryId
    );
    return this.normalizeMetadataValue(entry?.value);
  }

  private normalizeMetadataValue(value: unknown): MetadataScalarValue[] {
    if (value === null || value === undefined) {
      return [];
    }

    if (Array.isArray(value)) {
      if (
        value.every(
          item => this.isRecord(item) &&
            typeof item.lang === 'string' &&
            typeof item.value === 'string'
        )
      ) {
        const label = this.getLocalizedText(value as LanguageCodedText[]);
        return label ? [{ id: label, label }] : [];
      }

      return value.flatMap(item => this.normalizeMetadataValue(item));
    }

    if (this.isRecord(value)) {
      if (value.id !== undefined) {
        const vocabularyValue = value as unknown as StoredVocabularyEntry;
        const id = String(vocabularyValue.id || '').trim();
        return id ?
          [
            {
              id,
              label: this.getLocalizedText(vocabularyValue.label) || id
            }
          ] :
          [];
      }
      if (value.raw !== undefined) {
        const simpleValue = value as StoredSimpleValue;
        const id = String(simpleValue.raw ?? '').trim();
        return id ?
          [
            {
              id,
              label: this.getLocalizedText(simpleValue.asText) || id
            }
          ] :
          [];
      }
    }

    const normalized = String(value).trim();
    return normalized ? [{ id: normalized, label: normalized }] : [];
  }

  private getLocalizedText(values?: LanguageCodedText[]): string {
    if (!Array.isArray(values) || values.length === 0) {
      return '';
    }
    const preferred = values.find(value => value.lang === 'de') || values[0];
    return String(preferred?.value || '').trim();
  }

  private getDomainFieldKey(
    selection: PsychometricDomainFieldSelection
  ): string {
    return [selection.scope, selection.profileId, selection.entryId].join(
      '\u001F'
    );
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }
}
