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
  PsychometricMappingFallbackDiagnostic,
  PsychometricMappingIssueCode,
  PsychometricMappingIssueDiagnostic,
  PsychometricMetadataScope,
  PsychometricMissingDefinition,
  StoredMetadataProfile,
  StoredSimpleValue,
  StoredVocabularyEntry,
  StoredVomd,
  VomdDocument
} from './psychometric-export.types';

export interface PsychometricItemMappingOptions {
  excludedUnitNames?: readonly string[];
  requireItemIds?: boolean;
}

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
    workspaceId: number,
    options: PsychometricItemMappingOptions = {}
  ): Promise<PsychometricItemMapping> {
    const excludedUnitKeys = new Set(
      (options.excludedUnitNames || []).map(normalizePsychometricUnitKey)
    );
    const [unitDetails, vomdDocuments] = await Promise.all([
      this.workspaceFilesService.getUnitVariableDetails(workspaceId),
      this.loadVomdDocuments(workspaceId, excludedUnitKeys)
    ]);
    const items: PsychometricMappedItem[] = [];
    const byLogicalKey = new Map<string, PsychometricMappedItem>();
    const issues: string[] = [];
    const fallbacks: string[] = [];
    const issueDiagnostics: PsychometricMappingIssueDiagnostic[] = [];
    const fallbackDiagnostics: PsychometricMappingFallbackDiagnostic[] = [];
    const addIssue = (diagnostic: PsychometricMappingIssueDiagnostic): void => {
      issues.push(diagnostic.message);
      issueDiagnostics.push(diagnostic);
    };
    const addFallback = (
      diagnostic: PsychometricMappingFallbackDiagnostic
    ): void => {
      fallbacks.push(diagnostic.message);
      fallbackDiagnostics.push(diagnostic);
    };
    const mappingSourceByKey = new Map<string, 'direct' | 'fallback'>();
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
      if (excludedUnitKeys.has(unitKey)) {
        return;
      }
      const documents = documentsByUnit.get(unitKey) || [];
      if (documents.length === 0) {
        const message = `${unit.unitName}: keine VOMD-Datei`;
        addIssue({
          code: 'missing-vomd',
          message,
          unitId: unit.unitName,
          sourceFile: `${unit.unitName}.vomd`,
          suggestedAction: this.getIssueSuggestedAction(
            'missing-vomd',
            unit.unitName
          )
        });
        return;
      }

      documents
        .flatMap(document => document.items.map(vomdItem => ({
          document,
          vomdItem
        }))
        )
        .map(({ document, vomdItem }) => {
          const vomdVariableId = String(vomdItem.variableId || '').trim();
          const explicitItemId = String(vomdItem.id || '').trim();
          const itemId = explicitItemId || vomdVariableId || '?';
          const resolution =
            options.requireItemIds && !explicitItemId ?
              {
                issue:
                  `${unit.unitName}/${vomdVariableId || '?'}: ` +
                  'VOMD-Item ohne ID',
                issueCode: 'missing-item-id' as const
              } :
              this.resolveVomdVariable(
                unit,
                itemId,
                vomdVariableId
              );
          return {
            document,
            vomdItem,
            itemId,
            resolution
          };
        })
        .sort((left, right) => Number(Boolean(left.resolution.fallbackNote)) -
          Number(Boolean(right.resolution.fallbackNote))
        )
        .forEach(({
          document, vomdItem, itemId, resolution
        }) => {
          if (resolution.issue) {
            const issueCode = resolution.issueCode || 'variable-not-found';
            addIssue({
              code: issueCode,
              message: resolution.issue,
              unitId: unit.unitName,
              itemId,
              variableId: String(vomdItem.variableId || '').trim() || undefined,
              sourceFile: document.fileName,
              suggestedAction: this.getIssueSuggestedAction(
                issueCode,
                unit.unitName
              )
            });
            return;
          }

          const variable = resolution.variable;
          if (!variable) {
            return;
          }
          const variableId = String(variable.alias || variable.id).trim();
          const sourceVariableId = String(variable.id || variableId).trim();
          const key = getPsychometricLogicalKey(unit.unitName, variableId);
          const mappingSource = resolution.fallbackNote ?
            'fallback' :
            'direct';
          const existingMappingSource = mappingSourceByKey.get(key);
          if (
            mappingSource === 'fallback' &&
            existingMappingSource === 'direct'
          ) {
            const message =
              `${resolution.fallbackNote}, aber wegen bereits direkter ` +
              'Zuordnung ignoriert';
            addFallback({
              kind: 'ignored',
              message,
              unitId: unit.unitName,
              itemId,
              variableId,
              sourceFile: document.fileName,
              suggestedAction:
                'Redundantes Legacy-VOMD-Item entfernen oder die VOMD-Datei ' +
                'im Quellsystem neu erzeugen.'
            });
            return;
          }
          if (existingMappingSource) {
            const message =
              `${unit.unitName}/${variableId}: mehrere VOMD-Items`;
            addIssue({
              code: 'duplicate-vomd-item',
              message,
              unitId: unit.unitName,
              itemId,
              variableId,
              sourceFile: document.fileName,
              suggestedAction: this.getIssueSuggestedAction(
                'duplicate-vomd-item',
                unit.unitName
              )
            });
            return;
          }
          if (resolution.fallbackNote) {
            const message = `${resolution.fallbackNote} und verwendet`;
            addFallback({
              kind: 'used',
              message,
              unitId: unit.unitName,
              itemId,
              variableId,
              sourceFile: document.fileName,
              suggestedAction:
                `variableId für ${unit.unitName}/${itemId} mit der ` +
                'Unit-/VOCS-Variable abgleichen und in der VOMD-Datei ' +
                'ergänzen oder korrigieren.'
            });
          }
          const mappedItem: PsychometricMappedItem = {
            key,
            unitName: unit.unitName,
            variableId,
            sourceVariableId,
            itemId,
            itemLabel: String(
              vomdItem.description || itemId || variableId
            ),
            variable,
            vomd: document,
            vomdItem
          };
          items.push(mappedItem);
          mappingSourceByKey.set(key, mappingSource);

          [variableId, sourceVariableId].forEach(responseVariableId => {
            const logicalKey = getPsychometricLogicalKey(
              unit.unitName,
              responseVariableId
            );
            const existing = byLogicalKey.get(logicalKey);
            if (existing && existing !== mappedItem) {
              const message =
                `${unit.unitName}/${responseVariableId}: ` +
                'mehrdeutige Variablenzuordnung';
              addIssue({
                code: 'ambiguous-variable-mapping',
                message,
                unitId: unit.unitName,
                itemId,
                variableId: responseVariableId,
                sourceFile: document.fileName,
                suggestedAction: this.getIssueSuggestedAction(
                  'ambiguous-variable-mapping',
                  unit.unitName
                )
              });
            } else {
              byLogicalKey.set(logicalKey, mappedItem);
            }
          });
        });
    });

    return {
      items,
      byLogicalKey,
      issues,
      fallbacks,
      issueDiagnostics,
      fallbackDiagnostics
    };
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
    const mappingFallbackCount = mapping.fallbacks.length;
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
      itemCount,
      mappingIssueCount,
      mappingFallbackCount,
      mappingIssuePreview: mapping.issues.slice(0, 10),
      mappingFallbackPreview: mapping.fallbacks.slice(0, 10)
    };
  }

  private resolveVomdVariable(
    unit: {
      unitName: string;
      variables: PsychometricMappedItem['variable'][];
    },
    itemId: string,
    vomdVariableId: string
  ): {
      variable?: PsychometricMappedItem['variable'];
      issue?: string;
      issueCode?: PsychometricMappingIssueCode;
      fallbackNote?: string;
    } {
    const variableCandidates = this.findVariableCandidates(
      unit.variables,
      vomdVariableId
    );
    if (variableCandidates.length === 1) {
      return { variable: variableCandidates[0] };
    }
    if (variableCandidates.length > 1) {
      return {
        issue: `${unit.unitName}/${itemId}: Variable ${vomdVariableId} ist mehrdeutig`,
        issueCode: 'ambiguous-variable'
      };
    }

    const canTryItemId =
      normalizePsychometricVariableKey(itemId) !==
      normalizePsychometricVariableKey(vomdVariableId);
    const fallbackCandidates = canTryItemId ?
      this.findVariableCandidates(unit.variables, itemId) :
      [];
    if (fallbackCandidates.length === 1) {
      const reason = vomdVariableId ?
        `Variable ${vomdVariableId} nicht gefunden` :
        'variableId fehlt';
      return {
        variable: fallbackCandidates[0],
        fallbackNote:
          `${unit.unitName}/${itemId}: ${reason}; ` +
          `Item-ID ${itemId} als eindeutiger Fallback erkannt`
      };
    }
    if (fallbackCandidates.length > 1) {
      return {
        issue:
          `${unit.unitName}/${itemId}: Item-ID ${itemId} ist als ` +
          'Variablenfallback mehrdeutig',
        issueCode: 'ambiguous-item-fallback'
      };
    }

    return {
      issue: vomdVariableId ?
        `${unit.unitName}/${itemId}: Variable ${vomdVariableId} nicht gefunden` :
        `${unit.unitName}/${itemId}: VOMD-Item ohne variableId`,
      issueCode: vomdVariableId ?
        'variable-not-found' :
        'missing-variable-id'
    };
  }

  private getIssueSuggestedAction(
    code: PsychometricMappingIssueCode,
    unitName: string
  ): string {
    switch (code) {
      case 'missing-vomd':
        return `VOMD-Datei für ${unitName} erzeugen und hochladen oder die ` +
          'Unit als technische Unit ausschließen.';
      case 'missing-item-id':
        return 'Im betroffenen VOMD-Item eine eindeutige Item-ID ergänzen.';
      case 'missing-variable-id':
      case 'variable-not-found':
        return 'variableId im VOMD-Item mit ID oder Alias der Unit-/VOCS-' +
          'Variable abgleichen und korrigieren.';
      case 'ambiguous-variable':
      case 'ambiguous-item-fallback':
      case 'ambiguous-variable-mapping':
        return 'Doppelte Variablen-IDs oder -Aliasse bereinigen und im ' +
          'VOMD-Item eine eindeutige variableId setzen.';
      case 'duplicate-vomd-item':
        return 'Veraltete oder doppelte VOMD-Items entfernen und die ' +
          'VOMD-Datei im Quellsystem neu erzeugen.';
      default:
        return 'VOMD- und Unit-/VOCS-Metadaten prüfen und eindeutig zuordnen.';
    }
  }

  private findVariableCandidates(
    variables: PsychometricMappedItem['variable'][],
    identifier: string
  ): PsychometricMappedItem['variable'][] {
    const normalizedIdentifier = normalizePsychometricVariableKey(identifier);
    if (!normalizedIdentifier) {
      return [];
    }
    return variables.filter(variable => [variable.alias, variable.id]
      .map(value => normalizePsychometricVariableKey(value))
      .includes(normalizedIdentifier)
    );
  }

  private async loadVomdDocuments(
    workspaceId: number,
    excludedUnitKeys: ReadonlySet<string> = new Set()
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
    ).filter(
      file => !excludedUnitKeys.has(
        normalizePsychometricUnitKey(file.file_id || file.filename)
      )
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
