import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Like, Repository } from 'typeorm';
import * as cheerio from 'cheerio';
import { parseStringPromise } from 'xml2js';
import { VariableInfo } from '@iqbspecs/variable-info/variable-info.interface';
import { getErrorMessage, getErrorStack } from '../../../utils/error.util';
import FileUpload from '../../entities/file_upload.entity';
import { UnitVariableDetailsDto, VariableDetailDto, VariableValueInfo } from '../../../models/unit-variable-details.dto';
import { CacheService } from '../../../cache/cache.service';
import { isExcludedByResolvedExclusions, normalizeExclusionUnitId, WorkspaceExclusionService } from './workspace-exclusion.service';
import { getManualCodingScopeKey } from '../../utils/manual-coding-scope.util';
import { hasVisibleManualInstruction } from '../../../utils/manual-instruction.util';
import { isExportWorkerProcess } from '../../../export-worker/export-worker-role';
import { WorkspaceFileMetadataReader, DerivedVariableMetadataSnapshot } from './workspace-file-metadata-reader.token';

type WorkspaceUnitVisibility = {
  globalIgnoredUnits: Set<string>;
  visibleUnitIds: Set<string> | null;
};

type UnitVariableType =
  | 'string'
  | 'integer'
  | 'number'
  | 'boolean'
  | 'attachment'
  | 'json'
  | 'no-value';

interface ParsedVariableElement {
  $?: {
    id?: string;
    alias?: string;
    type?: UnitVariableType;
    multiple?: string | boolean;
    nullable?: string | boolean;
  };
  Values?: unknown;
  ValuePositionLabels?: unknown;
}

@Injectable()
export class WorkspaceFileMetadataService implements OnModuleInit, WorkspaceFileMetadataReader {
  constructor(
    @InjectRepository(FileUpload) private readonly fileUploadRepository: Repository<FileUpload>,
    private readonly cacheService: CacheService,
    private readonly workspaceExclusionService: WorkspaceExclusionService
  ) {}

  private readonly logger = new Logger(WorkspaceFileMetadataService.name);

  private readonly detailedUnitCacheLogging =
    process.env.DEBUG_UNIT_CACHE === 'true';

  private readonly unitVariableCacheVersion = 'v2';

  private readonly unitVariableCacheRefreshes = new Map<number, Promise<void>>();

  private getCacheKey(workspaceId: number, type: string): string {
    return `workspace_files:${this.unitVariableCacheVersion}:${type}:${workspaceId}`;
  }

  private logUnitCacheDebug(message: string): void {
    if (this.detailedUnitCacheLogging) {
      this.logger.debug(message);
    }
  }

  private isDerivedSourceType(sourceType: string | undefined): boolean {
    return !!sourceType && sourceType !== 'BASE' && sourceType !== 'BASE_NO_VALUE';
  }

  private toRedisMap(map: Map<string, Set<string>>): Record<string, string[]> {
    return Object.fromEntries(
      Array.from(map.entries()).map(([k, v]) => [k, Array.from(v)])
    );
  }

  private fromRedisMap(
    data: Record<string, string[]> | null
  ): Map<string, Set<string>> {
    if (!data) return new Map();
    return new Map(Object.entries(data).map(([k, v]) => [k, new Set(v)]));
  }

  private normalizeFileUnitId(value: string | null | undefined): string {
    return normalizeExclusionUnitId(value).replace(/\.VOCS$/i, '');
  }

  async getWorkspaceUnitVisibility(
    workspaceId: number
  ): Promise<WorkspaceUnitVisibility> {
    if (!this.workspaceExclusionService) {
      return { globalIgnoredUnits: new Set(), visibleUnitIds: null };
    }

    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    const globalIgnoredUnits = new Set(
      exclusions.globalIgnoredUnits.map(unitId => this.normalizeFileUnitId(unitId))
    );
    const hasContextualExclusions =
      exclusions.ignoredBooklets.length > 0 ||
      exclusions.testletIgnoredUnits.length > 0;

    if (!hasContextualExclusions) {
      return { globalIgnoredUnits, visibleUnitIds: null };
    }

    const bookletFiles = await this.fileUploadRepository.find({
      where: { workspace_id: workspaceId, file_type: 'Booklet' }
    });

    if (!bookletFiles || bookletFiles.length === 0) {
      return { globalIgnoredUnits, visibleUnitIds: null };
    }

    const visibleUnitIds = new Set<string>();
    for (const bookletFile of bookletFiles) {
      try {
        const bookletId = String(bookletFile.file_id || '');
        const $ = cheerio.load(bookletFile.data, { xmlMode: true });
        $('Unit, unit').each((_, element) => {
          const unitId = $(element).attr('id');
          const normalizedUnitId = this.normalizeFileUnitId(unitId);
          if (!normalizedUnitId || globalIgnoredUnits.has(normalizedUnitId)) {
            return;
          }
          if (!isExcludedByResolvedExclusions(exclusions, bookletId, unitId)) {
            visibleUnitIds.add(normalizedUnitId);
          }
        });
      } catch (error) {
        this.logger.warn(
          `Could not parse booklet ${bookletFile.file_id} for unit visibility in workspace ${workspaceId}: ${getErrorMessage(error)}`
        );
      }
    }

    return { globalIgnoredUnits, visibleUnitIds };
  }

  isUnitVisibleInWorkspace(
    unitId: string | null | undefined,
    visibility: WorkspaceUnitVisibility
  ): boolean {
    const normalizedUnitId = this.normalizeFileUnitId(unitId);
    if (!normalizedUnitId) {
      return false;
    }
    if (visibility.globalIgnoredUnits.has(normalizedUnitId)) {
      return false;
    }
    if (visibility.visibleUnitIds !== null) {
      return visibility.visibleUnitIds.has(normalizedUnitId);
    }
    return true;
  }

  private normalizeFileIdForLookup(fileId: unknown): string | null {
    const normalized = String(fileId || '')
      .trim()
      .toUpperCase()
      .replace(/\.XML$/i, '');
    return normalized || null;
  }

  async getVariableInfoForScheme(
    workspaceId: number,
    schemeFileId: string,
    manager?: EntityManager
  ): Promise<VariableInfo[]> {
    try {
      const expectedUnitId = this.normalizeFileUnitId(schemeFileId);
      const repository = manager?.getRepository(FileUpload) ||
        this.fileUploadRepository;
      const unitFiles = await repository.find({
        where: {
          workspace_id: workspaceId,
          file_type: 'Unit',
          file_id_normalized: expectedUnitId
        },
        select: ['file_id', 'data']
      });

      if (!unitFiles || unitFiles.length === 0) {
        this.logger.warn(`No Unit files found in workspace ${workspaceId}`);
        return [];
      }

      const filteredUnitFiles = unitFiles.filter(
        file => this.normalizeFileIdForLookup(file.file_id) === expectedUnitId &&
          !file.file_id.toUpperCase().includes('VOCS')
      );

      if (filteredUnitFiles.length === 0) {
        this.logger.warn(
          `No Unit files with file_id ${schemeFileId} (without VOCS) found in workspace ${workspaceId}`
        );
        return [];
      }

      const variableInfoArray: VariableInfo[] = [];

      for (const unitFile of filteredUnitFiles) {
        try {
          const xmlContent = unitFile.data.toString();
          const parsedXml = await parseStringPromise(xmlContent, {
            explicitArray: false
          });

          if (
            parsedXml.Unit &&
            parsedXml.Unit.BaseVariables &&
            parsedXml.Unit.BaseVariables.Variable
          ) {
            const baseVariables = Array.isArray(
              parsedXml.Unit.BaseVariables.Variable
            ) ?
              parsedXml.Unit.BaseVariables.Variable :
              [parsedXml.Unit.BaseVariables.Variable];

            for (const variable of baseVariables) {
              if (variable.$ && variable.$.alias && variable.$.type) {
                const variableInfo: VariableInfo = {
                  id: variable.$.id,
                  alias: variable.$.alias,
                  type: variable.$.type,
                  multiple:
                    variable.$.multiple === 'true' ||
                    variable.$.multiple === true,
                  nullable:
                    variable.$.nullable !== 'false' &&
                    variable.$.nullable !== false, // Default to true if not specified
                  values: variable.$.values ?
                    variable.$.values.split('|') :
                    undefined,
                  valuesComplete:
                    variable.$.valuesComplete === 'true' ||
                    variable.$.valuesComplete === true,
                  page: variable.$.page,
                  format: '',
                  valuePositionLabels: []
                };

                variableInfoArray.push(variableInfo);
              }
            }
          }
        } catch (e) {
          this.logger.error(
            `Error parsing XML for unit file ${unitFile.file_id}: ${getErrorMessage(e)}`
          );
        }
      }

      return variableInfoArray;
    } catch (error) {
      this.logger.error(
        `Error retrieving variable info: ${getErrorMessage(error)}`,
        getErrorStack(error)
      );
      return [];
    }
  }

  async onModuleInit(): Promise<void> {
    if (isExportWorkerProcess()) {
      this.logger.log('Skipping unit variable cache startup refresh in export worker');
      return;
    }

    this.logger.log(
      'Initializing WorkspaceFileMetadataService - refreshing unit variable cache for all workspaces'
    );

    try {
      const workspacesWithUnits: {
        workspaceId?: number | string | null;
        workspace_id?: number | string | null;
        [key: string]: number | string | null | undefined;
      }[] =
        await this.fileUploadRepository
          .createQueryBuilder('file')
          .select('DISTINCT file.workspace_id', 'workspaceId')
          .where('file.file_type = :fileType', { fileType: 'Unit' })
          .getRawMany();

      for (const workspace of workspacesWithUnits) {
        const rawWorkspaceId = workspace.workspaceId ?? workspace.workspace_id;
        const workspaceId = Number(rawWorkspaceId);
        if (
          rawWorkspaceId == null ||
          !Number.isInteger(workspaceId) ||
          workspaceId < 1
        ) {
          this.logger.error(
            `Skipping unit variable cache refresh for invalid workspace id: ${rawWorkspaceId}`
          );
          continue;
        }

        await this.refreshUnitVariableCache(workspaceId);
      }
      this.logger.log(
        `Successfully initialized unit variable cache for ${workspacesWithUnits.length} workspaces`
      );
    } catch (error) {
      this.logger.error(
        `Error initializing unit variable cache: ${getErrorMessage(error)}`,
        getErrorStack(error)
      );
    }
  }

  async refreshUnitVariableCache(workspaceId: number): Promise<void> {
    const activeRefresh = this.unitVariableCacheRefreshes.get(workspaceId);
    if (activeRefresh) {
      await activeRefresh;
      return;
    }

    const refresh = this.refreshUnitVariableCacheInternal(workspaceId);
    this.unitVariableCacheRefreshes.set(workspaceId, refresh);

    try {
      await refresh;
    } finally {
      this.unitVariableCacheRefreshes.delete(workspaceId);
    }
  }

  private async refreshUnitVariableCacheInternal(
    workspaceId: number,
    manager?: EntityManager
  ): Promise<void> {
    this.logger.log(
      `Refreshing unit variable cache for workspace ${workspaceId}`
    );

    const derivedMetadataCompleteKey = this.getCacheKey(
      workspaceId,
      'derived_variable_metadata_complete'
    );
    let derivedMetadataComplete = true;

    try {
      await this.cacheService.set(derivedMetadataCompleteKey, false);

      const repository = manager?.getRepository(FileUpload) ||
        this.fileUploadRepository;
      const unitFiles = await repository.find({
        where: { workspace_id: workspaceId, file_type: 'Unit' }
      });

      const codingSchemes = await repository.find({
        where: {
          workspace_id: workspaceId,
          file_type: 'Resource',
          file_id: Like('%.VOCS')
        }
      });

      // Create a map of unitId to parsed coding scheme for quick lookup
      // Also track which variables have INTENDED_INCOMPLETE code type in their scheme
      const codingSchemeMap = new Map<string, Map<string, string>>();
      // Maps unitId → Map<schemeId, alias> for translating scheme IDs to response variableids
      const schemeIdToAliasMap = new Map<string, Map<string, string>>();
      // Maps unitId → Map<alias, schemeId> for resolving XML aliases back to VOCS IDs
      const schemeAliasToIdMap = new Map<string, Map<string, string>>();
      const intendedIncompleteByUnit = new Map<string, Set<string>>();
      const manualInstructionByUnit = new Map<string, Set<string>>();
      const trainingRequiredByUnit = new Map<string, Set<string>>();
      const derivedSourcesByUnit = new Map<
        string,
        Array<{ derivedId: string; derivedAlias?: string; sourceIds: string[] }>
      >();
      for (const scheme of codingSchemes) {
        try {
          const unitId = scheme.file_id.replace('.VOCS', '');
          const parsedScheme = JSON.parse(scheme.data) as {
            variableCodings?: {
              id: string;
              alias?: string;
              sourceType?: string;
              deriveSources?: string[];
              processing?: string[];
              codes?: Array<{ type?: string; manualInstruction?: string | null }>;
            }[];
          };
          if (
            parsedScheme.variableCodings &&
            Array.isArray(parsedScheme.variableCodings)
          ) {
            const variableSourceTypes = new Map<string, string>();
            const idToAlias = new Map<string, string>();
            const aliasToId = new Map<string, string>();
            // Collect scheme variable IDs (not aliases!) that have INTENDED_INCOMPLETE code type.
            // These will be translated to aliases during unit XML parsing below.
            const intendedIncompleteSchemeIds = new Set<string>();
            // Collect scheme variable IDs that have CODER_TRAINING_REQUIRED processing property.
            const trainingRequiredSchemeIds = new Set<string>();
            const manualInstructionSchemeIds = new Set<string>();
            const derivedSourceEntries: Array<{
              derivedId: string;
              derivedAlias?: string;
              sourceIds: string[];
            }> = [];
            for (const vc of parsedScheme.variableCodings) {
              if (vc.id && vc.sourceType) {
                variableSourceTypes.set(vc.id, vc.sourceType);
              }
              // Map scheme id → alias for response variableid resolution
              if (vc.id && vc.alias) {
                idToAlias.set(vc.id, vc.alias);
                aliasToId.set(vc.alias, vc.id);
              }
              // Track variables where any code has type INTENDED_INCOMPLETE
              if (vc.id && vc.codes && Array.isArray(vc.codes)) {
                const hasIntendedIncomplete = vc.codes.some(
                  code => code.type === 'INTENDED_INCOMPLETE'
                );
                if (hasIntendedIncomplete) {
                  intendedIncompleteSchemeIds.add(vc.id);
                }
                const hasManualInstruction = vc.codes.some(
                  code => hasVisibleManualInstruction(code)
                );
                if (hasManualInstruction) {
                  manualInstructionSchemeIds.add(vc.id);
                }
              }
              // Track variables with CODER_TRAINING_REQUIRED
              if (vc.id && vc.processing && Array.isArray(vc.processing)) {
                if (vc.processing.includes('CODER_TRAINING_REQUIRED')) {
                  trainingRequiredSchemeIds.add(vc.id);
                }
              }
              if (
                vc.id &&
                this.isDerivedSourceType(vc.sourceType) &&
                Array.isArray(vc.deriveSources) &&
                vc.deriveSources.length > 0
              ) {
                derivedSourceEntries.push({
                  derivedId: vc.id,
                  derivedAlias: vc.alias,
                  sourceIds: vc.deriveSources
                    .map(sourceId => String(sourceId || '').trim())
                    .filter(sourceId => sourceId.length > 0)
                });
              }
            }
            codingSchemeMap.set(unitId, variableSourceTypes);
            schemeIdToAliasMap.set(unitId, idToAlias);
            schemeAliasToIdMap.set(unitId, aliasToId);
            if (intendedIncompleteSchemeIds.size > 0) {
              this.logUnitCacheDebug(
                `Coding scheme for unit "${unitId}" has INTENDED_INCOMPLETE code type for scheme IDs: [${Array.from(intendedIncompleteSchemeIds).join(', ')}]`
              );
              // Store by unitId so we can resolve to aliases during XML parsing
              intendedIncompleteByUnit.set(unitId, intendedIncompleteSchemeIds);
            }
            if (trainingRequiredSchemeIds.size > 0) {
              this.logUnitCacheDebug(
                `Coding scheme for unit "${unitId}" has CODER_TRAINING_REQUIRED for scheme IDs: [${Array.from(trainingRequiredSchemeIds).join(', ')}]`
              );
              trainingRequiredByUnit.set(unitId, trainingRequiredSchemeIds);
            }
            if (manualInstructionSchemeIds.size > 0) {
              manualInstructionByUnit.set(unitId, manualInstructionSchemeIds);
            }
            if (derivedSourceEntries.length > 0) {
              derivedSourcesByUnit.set(unitId, derivedSourceEntries);
            }
          }
        } catch (error) {
          derivedMetadataComplete = false;
          this.logger.error(
            `Error parsing coding scheme ${scheme.file_id}: ${getErrorMessage(error)}`,
            getErrorStack(error)
          );
        }
      }

      const unitVariables: Map<string, Set<string>> = new Map();
      // This will hold the final alias-keyed map (replaces the scheme-ID-keyed intendedIncompleteByUnit).
      // Built during XML parsing where we can translate id → alias.
      const intendedIncompleteAliasByUnit = new Map<string, Set<string>>();
      // Tracks derived variable aliases per unit for derivedVariableCache
      const derivedVariablesByUnit = new Map<string, Set<string>>();
      const derivedVariablesBySource = new Map<string, Set<string>>();
      // Maps unitId → alias-keyed set of variables with CODER_TRAINING_REQUIRED
      const trainingRequiredAliasByUnit = new Map<string, Set<string>>();
      const manualInstructionAliasByUnit = new Map<string, Set<string>>();

      for (const unitFile of unitFiles) {
        try {
          const xmlContent = unitFile.data.toString();
          const parsedXml = await parseStringPromise(xmlContent, {
            explicitArray: false
          });

          if (
            parsedXml.Unit &&
            parsedXml.Unit.Metadata &&
            parsedXml.Unit.Metadata.Id
          ) {
            const unitName = parsedXml.Unit.Metadata.Id;
            const idToAlias = schemeIdToAliasMap.get(unitName);
            const aliasToId = schemeAliasToIdMap.get(unitName);
            const variables = new Set<string>();
            // Scheme IDs that have INTENDED_INCOMPLETE code type (from the .VOCS file)
            const schemeIdsWithIntendedIncomplete =
              intendedIncompleteByUnit.get(unitName);
            // Scheme IDs that have CODER_TRAINING_REQUIRED processing property
            const schemeIdsWithTrainingRequired =
              trainingRequiredByUnit.get(unitName);
            const schemeIdsWithManualInstructions =
              manualInstructionByUnit.get(unitName);
            // Aliases that map to those scheme IDs — keyed by alias (= response variableid)
            const aliasesWithIntendedIncomplete = new Set<string>();
            // Aliases that map to scheme IDs with CODER_TRAINING_REQUIRED
            const aliasesWithTrainingRequired = new Set<string>();
            const aliasesWithManualInstructions = new Set<string>();
            // Derived variable aliases for this unit
            const derivedAliases = new Set<string>();
            const xmlIdToAlias = new Map<string, string>();

            if (
              parsedXml.Unit.BaseVariables &&
              parsedXml.Unit.BaseVariables.Variable
            ) {
              const baseVariables = Array.isArray(
                parsedXml.Unit.BaseVariables.Variable
              ) ?
                parsedXml.Unit.BaseVariables.Variable :
                [parsedXml.Unit.BaseVariables.Variable];

              for (const variable of baseVariables) {
                if (variable.$.alias && variable.$.type !== 'no-value') {
                  if (variable.$.id) {
                    xmlIdToAlias.set(variable.$.id, variable.$.alias);
                  }
                  // Use $.id to look up source type in scheme (scheme uses id), fall back to alias
                  const schemeKey = variable.$.id ||
                    aliasToId?.get(variable.$.alias) ||
                    variable.$.alias;
                  const unitSourceTypes = codingSchemeMap.get(unitName);
                  const sourceType = unitSourceTypes?.get(schemeKey);
                  if (sourceType !== 'BASE_NO_VALUE') {
                    variables.add(variable.$.alias);
                    if (this.isDerivedSourceType(sourceType)) {
                      derivedAliases.add(variable.$.alias);
                    }
                  }
                  // Check if this variable's scheme ID has INTENDED_INCOMPLETE code type
                  if (schemeIdsWithIntendedIncomplete?.has(schemeKey)) {
                    aliasesWithIntendedIncomplete.add(variable.$.alias);
                    this.logUnitCacheDebug(
                      `Base variable "${variable.$.alias}" (schemeId="${schemeKey}") in unit "${unitName}" has INTENDED_INCOMPLETE in scheme`
                    );
                  }
                  // Check CODER_TRAINING_REQUIRED
                  if (schemeIdsWithTrainingRequired?.has(schemeKey)) {
                    aliasesWithTrainingRequired.add(variable.$.alias);
                  }
                  if (schemeIdsWithManualInstructions?.has(schemeKey)) {
                    aliasesWithManualInstructions.add(variable.$.alias);
                  }
                }
              }
            }

            // Also include derived variables so that newly added derived vars
            // with CODING_INCOMPLETE status appear in manual coding
            if (
              parsedXml.Unit.DerivedVariables &&
              parsedXml.Unit.DerivedVariables.Variable
            ) {
              const derivedVariables = Array.isArray(
                parsedXml.Unit.DerivedVariables.Variable
              ) ?
                parsedXml.Unit.DerivedVariables.Variable :
                [parsedXml.Unit.DerivedVariables.Variable];

              this.logUnitCacheDebug(
                `Unit "${unitName}" has ${derivedVariables.length} DerivedVariables in XML`
              );

              for (const variable of derivedVariables) {
                const alias = variable.$?.alias;
                const id = variable.$?.id;
                const type = variable.$?.type;
                const schemeKey = id || aliasToId?.get(alias) || alias;
                const unitSourceTypes = codingSchemeMap.get(unitName);
                const sourceType = unitSourceTypes?.get(schemeKey);

                this.logUnitCacheDebug(
                  `DerivedVariable id="${id}" alias="${alias}" type="${type}" schemeKey="${schemeKey}" sourceType="${sourceType}" in unit "${unitName}"`
                );

                if (!alias) {
                  this.logUnitCacheDebug('Skipped derived variable: no alias');
                  continue;
                }
                if (id) {
                  xmlIdToAlias.set(id, alias);
                }
                if (type === 'no-value') {
                  this.logUnitCacheDebug('Skipped derived variable: type is no-value');
                  continue;
                }
                if (sourceType === 'BASE_NO_VALUE') {
                  this.logUnitCacheDebug(
                    'Excluded derived variable from cache: sourceType is BASE_NO_VALUE'
                  );
                } else if (sourceType === 'BASE') {
                  this.logUnitCacheDebug(
                    'Excluded derived variable from cache: sourceType is BASE'
                  );
                } else {
                  variables.add(alias);
                  derivedAliases.add(alias);
                  this.logUnitCacheDebug(
                    `Added derived variable to unitVariableMap (sourceType="${sourceType ?? 'undefined/no scheme'}")`
                  );
                }
                // Check if this derived variable's scheme ID has INTENDED_INCOMPLETE code type
                if (schemeIdsWithIntendedIncomplete?.has(schemeKey)) {
                  aliasesWithIntendedIncomplete.add(alias);
                  this.logUnitCacheDebug(
                    `Derived variable "${alias}" (schemeId="${schemeKey}") in unit "${unitName}" has INTENDED_INCOMPLETE in scheme`
                  );
                }
                // Check CODER_TRAINING_REQUIRED
                if (schemeIdsWithTrainingRequired?.has(schemeKey)) {
                  aliasesWithTrainingRequired.add(alias);
                }
                if (schemeIdsWithManualInstructions?.has(schemeKey)) {
                  aliasesWithManualInstructions.add(alias);
                }
              }
            } else {
              this.logUnitCacheDebug(
                `Unit "${unitName}" has NO DerivedVariables in XML`
              );
            }

            unitVariables.set(unitName, variables);

            // Additionally, include any variables from the coding scheme that are NOT in the unit XML yet.
            // This covers newly created derived variables that exist in the VOCS but haven't been
            // written back to the unit XML. Use the alias (= response variableid) as the key.
            const schemeVarTypes = codingSchemeMap.get(unitName);
            if (schemeVarTypes) {
              for (const [schemeId, sourceType] of schemeVarTypes.entries()) {
                // Resolve to alias — alias is what response.variableid contains
                const resolvedAlias = idToAlias?.get(schemeId) ?? schemeId;
                if (
                  this.isDerivedSourceType(sourceType) &&
                  !variables.has(resolvedAlias)
                ) {
                  variables.add(resolvedAlias);
                  derivedAliases.add(resolvedAlias);
                  this.logUnitCacheDebug(
                    `Unit "${unitName}": added scheme-only variable alias="${resolvedAlias}" (schemeId="${schemeId}", sourceType="${sourceType}") to unitVariableMap`
                  );
                  // Also check INTENDED_INCOMPLETE for this scheme-only variable
                  if (schemeIdsWithIntendedIncomplete?.has(schemeId)) {
                    aliasesWithIntendedIncomplete.add(resolvedAlias);
                    this.logUnitCacheDebug(
                      `Scheme-only variable alias="${resolvedAlias}" in unit "${unitName}" has INTENDED_INCOMPLETE in scheme`
                    );
                  }
                  // Also check CODER_TRAINING_REQUIRED for this scheme-only variable
                  if (schemeIdsWithTrainingRequired?.has(schemeId)) {
                    aliasesWithTrainingRequired.add(resolvedAlias);
                  }
                  if (schemeIdsWithManualInstructions?.has(schemeId)) {
                    aliasesWithManualInstructions.add(resolvedAlias);
                  }
                }
              }
            }

            const derivedSourceEntries = derivedSourcesByUnit.get(unitName) || [];
            const resolveVariableAlias = (idOrAlias: string | undefined): string | null => {
              const key = String(idOrAlias || '').trim();
              if (!key) {
                return null;
              }
              return idToAlias?.get(key) ?? xmlIdToAlias.get(key) ?? key;
            };

            derivedSourceEntries.forEach(entry => {
              const derivedAlias = resolveVariableAlias(entry.derivedAlias || entry.derivedId);
              if (!derivedAlias || !derivedAliases.has(derivedAlias)) {
                return;
              }

              entry.sourceIds.forEach(sourceId => {
                const sourceAlias = resolveVariableAlias(sourceId);
                if (!sourceAlias) {
                  return;
                }

                const sourceKey = getManualCodingScopeKey(unitName, sourceAlias);
                const derivedAliasesForSource =
                  derivedVariablesBySource.get(sourceKey) || new Set<string>();
                derivedAliasesForSource.add(derivedAlias);
                derivedVariablesBySource.set(sourceKey, derivedAliasesForSource);
              });
            });

            if (aliasesWithIntendedIncomplete.size > 0) {
              intendedIncompleteAliasByUnit.set(
                unitName,
                aliasesWithIntendedIncomplete
              );
            }
            if (aliasesWithTrainingRequired.size > 0) {
              trainingRequiredAliasByUnit.set(
                unitName,
                aliasesWithTrainingRequired
              );
            }
            if (aliasesWithManualInstructions.size > 0) {
              manualInstructionAliasByUnit.set(
                unitName,
                aliasesWithManualInstructions
              );
            }
            if (derivedAliases.size > 0) {
              derivedVariablesByUnit.set(unitName, derivedAliases);
            }
          }
        } catch (e) {
          derivedMetadataComplete = false;
          this.logger.warn(
            `Error parsing unit file ${unitFile.file_id}: ${
              (e as Error).message
            }`
          );
        }
      }

      await this.cacheService.set(
        this.getCacheKey(workspaceId, 'unit_variables'),
        this.toRedisMap(unitVariables)
      );
      await this.cacheService.set(
        this.getCacheKey(workspaceId, 'intended_incomplete'),
        this.toRedisMap(intendedIncompleteAliasByUnit)
      );
      await this.cacheService.set(
        this.getCacheKey(workspaceId, 'training_required'),
        this.toRedisMap(trainingRequiredAliasByUnit)
      );
      await this.cacheService.set(
        this.getCacheKey(workspaceId, 'derived_variables'),
        this.toRedisMap(derivedVariablesByUnit)
      );
      await this.cacheService.set(
        this.getCacheKey(workspaceId, 'derived_variables_by_source'),
        this.toRedisMap(derivedVariablesBySource)
      );
      await this.cacheService.set(
        this.getCacheKey(workspaceId, 'manual_instruction_variables'),
        this.toRedisMap(manualInstructionAliasByUnit)
      );
      await this.cacheService.set(
        derivedMetadataCompleteKey,
        derivedMetadataComplete
      );

      this.logger.log(
        `Cached ${unitVariables.size} units with their variables for workspace ${workspaceId} to Redis`
      );
      this.logger.log(
        `Unit variable cache summary for workspace ${workspaceId}: ` +
        `${intendedIncompleteAliasByUnit.size} units with intended-incomplete variables, ` +
        `${trainingRequiredAliasByUnit.size} units with training-required variables, ` +
        `${manualInstructionAliasByUnit.size} units with manual instructions, ` +
        `${derivedVariablesByUnit.size} units with derived variables, ` +
        `${derivedVariablesBySource.size} source variables for derived variables`
      );
      this.logUnitCacheDebug(
        `intendedIncompleteSchemeCache (by alias) for workspace ${workspaceId}: ` +
          `${intendedIncompleteAliasByUnit.size} units with INTENDED_INCOMPLETE codes. ${Array.from(
            intendedIncompleteAliasByUnit.entries()
          )
            .map(([u, vars]) => `${u}: [${Array.from(vars).join(', ')}]`)
            .join(' | ')}`
      );
    } catch (error) {
      this.logger.error(
        `Error refreshing unit variable cache for workspace ${workspaceId}: ${getErrorMessage(error)}`,
        getErrorStack(error)
      );
      try {
        await this.cacheService.set(derivedMetadataCompleteKey, false);
      } catch (cacheError) {
        this.logger.error(
          `Could not mark derived-variable metadata as unavailable for workspace ${workspaceId}: ${getErrorMessage(cacheError)}`,
          getErrorStack(cacheError)
        );
      }
    }
  }

  async getUnitVariableMap(
    workspaceId: number,
    manager?: EntityManager
  ): Promise<Map<string, Set<string>>> {
    const cacheKey = this.getCacheKey(workspaceId, 'unit_variables');
    const cached =
      await this.cacheService.get<Record<string, string[]>>(cacheKey);
    if (!cached) {
      if (manager) {
        await this.refreshUnitVariableCacheInternal(workspaceId, manager);
      } else {
        await this.refreshUnitVariableCache(workspaceId);
      }
      return this.fromRedisMap(
        await this.cacheService.get<Record<string, string[]>>(cacheKey)
      );
    }
    return this.fromRedisMap(cached);
  }

  async getIntendedIncompleteSchemeVariableMap(
    workspaceId: number
  ): Promise<Map<string, Set<string>>> {
    const cacheKey = this.getCacheKey(workspaceId, 'intended_incomplete');
    const cached =
      await this.cacheService.get<Record<string, string[]>>(cacheKey);
    if (!cached) {
      await this.refreshUnitVariableCache(workspaceId);
      return this.fromRedisMap(
        await this.cacheService.get<Record<string, string[]>>(cacheKey)
      );
    }
    return this.fromRedisMap(cached);
  }

  async getDerivedVariableMap(
    workspaceId: number,
    manager?: EntityManager
  ): Promise<Map<string, Set<string>>> {
    const cacheKey = this.getCacheKey(workspaceId, 'derived_variables');
    const cached =
      await this.cacheService.get<Record<string, string[]>>(cacheKey);
    if (!cached) {
      if (manager) {
        await this.refreshUnitVariableCacheInternal(workspaceId, manager);
      } else {
        await this.refreshUnitVariableCache(workspaceId);
      }
      return this.fromRedisMap(
        await this.cacheService.get<Record<string, string[]>>(cacheKey)
      );
    }
    return this.fromRedisMap(cached);
  }

  async getDerivedVariablesBySourceMap(
    workspaceId: number,
    manager?: EntityManager
  ): Promise<Map<string, Set<string>>> {
    const cacheKey = this.getCacheKey(workspaceId, 'derived_variables_by_source');
    const cached =
      await this.cacheService.get<Record<string, string[]>>(cacheKey);
    if (!cached) {
      if (manager) {
        await this.refreshUnitVariableCacheInternal(workspaceId, manager);
      } else {
        await this.refreshUnitVariableCache(workspaceId);
      }
      return this.fromRedisMap(
        await this.cacheService.get<Record<string, string[]>>(cacheKey)
      );
    }
    return this.fromRedisMap(cached);
  }

  async getDerivedVariableMetadata(
    workspaceId: number,
    manager?: EntityManager
  ): Promise<DerivedVariableMetadataSnapshot> {
    const metadataCompleteKey = this.getCacheKey(
      workspaceId,
      'derived_variable_metadata_complete'
    );
    const derivedVariableKey = this.getCacheKey(
      workspaceId,
      'derived_variables'
    );
    const derivedVariablesBySourceKey = this.getCacheKey(
      workspaceId,
      'derived_variables_by_source'
    );

    const readMetadata = async () => Promise.all([
      this.cacheService.get<boolean>(metadataCompleteKey),
      this.cacheService.get<Record<string, string[]>>(derivedVariableKey),
      this.cacheService.get<Record<string, string[]>>(
        derivedVariablesBySourceKey
      )
    ]);

    let [
      metadataComplete,
      derivedVariableData,
      derivedVariablesBySourceData
    ] = await readMetadata();

    if (
      metadataComplete == null ||
      (
        metadataComplete === true &&
        (!derivedVariableData || !derivedVariablesBySourceData)
      )
    ) {
      if (manager) {
        await this.refreshUnitVariableCacheInternal(workspaceId, manager);
      } else {
        await this.refreshUnitVariableCache(workspaceId);
      }
      [
        metadataComplete,
        derivedVariableData,
        derivedVariablesBySourceData
      ] = await readMetadata();
    }

    const metadataAvailable =
      metadataComplete === true &&
      !!derivedVariableData &&
      !!derivedVariablesBySourceData;

    return {
      metadataAvailable,
      derivedVariableMap: metadataAvailable ?
        this.fromRedisMap(derivedVariableData) :
        new Map(),
      derivedVariablesBySourceMap: metadataAvailable ?
        this.fromRedisMap(derivedVariablesBySourceData) :
        new Map()
    };
  }

  async getManualInstructionVariableMap(
    workspaceId: number
  ): Promise<Map<string, Set<string>>> {
    const cacheKey = this.getCacheKey(workspaceId, 'manual_instruction_variables');
    const cached =
      await this.cacheService.get<Record<string, string[]>>(cacheKey);
    if (!cached) {
      await this.refreshUnitVariableCache(workspaceId);
      return this.fromRedisMap(
        await this.cacheService.get<Record<string, string[]>>(cacheKey)
      );
    }
    return this.fromRedisMap(cached);
  }

  async getCoderTrainingRequiredVariableMap(
    workspaceId: number
  ): Promise<Map<string, Set<string>>> {
    const cacheKey = this.getCacheKey(workspaceId, 'training_required');
    const cached =
      await this.cacheService.get<Record<string, string[]>>(cacheKey);
    if (!cached) {
      await this.refreshUnitVariableCache(workspaceId);
      return this.fromRedisMap(
        await this.cacheService.get<Record<string, string[]>>(cacheKey)
      );
    }
    return this.fromRedisMap(cached);
  }

  async getUnitVariableDetails(
    workspaceId: number
  ): Promise<UnitVariableDetailsDto[]> {
    this.logger.log(
      `Getting detailed unit variable information for workspace ${workspaceId}`
    );

    try {
      const unitFiles = await this.fileUploadRepository.find({
        where: { workspace_id: workspaceId, file_type: 'Unit' }
      });

      const codingSchemes = await this.fileUploadRepository.find({
        where: {
          workspace_id: workspaceId,
          file_type: 'Resource',
          file_id: Like('%.VOCS')
        }
      });

      const codingSchemeMap = new Map<string, string>();
      const codingSchemeVariablesMap = new Map<string, Map<string, string>>();
      const codingSchemeAliasToIdMap = new Map<string, Map<string, string>>();
      const codingSchemeIdToAliasMap = new Map<string, Map<string, string>>();
      const codingSchemeVariableTypesMap = new Map<
        string,
        Map<string, UnitVariableType>
      >();
      const codingSchemeCodesMap = new Map<
        string,
        Map<
          string,
          Array<{
            id: string | number;
            label: string;
            score?: number;
            manualInstruction?: string;
            type?: string;
          }>
        >
      >();
      const codingSchemeManualInstructionsMap = new Map<
        string,
        Map<string, boolean>
      >();
      const codingSchemeClosedCodingMap = new Map<
        string,
        Map<string, boolean>
      >();
      const codingSchemeTrainingRequiredMap = new Map<
        string,
        Map<string, boolean>
      >();
      const codingSchemeProcessingMap = new Map<
        string,
        Map<string, string[]>
      >();

      for (const scheme of codingSchemes) {
        try {
          const unitId = scheme.file_id.replace('.VOCS', '');
          codingSchemeMap.set(unitId, scheme.file_id);

          const parsedScheme = JSON.parse(scheme.data) as {
            variableCodings?: {
              id: string;
              alias?: string;
              sourceType?: string;
              type?: UnitVariableType;
              processing?: string[];
              codes?: Array<{
                id: number | string;
                label?: string;
                score?: number;
                manualInstruction?: string;
                type?: string;
              }>;
            }[];
          };
          if (
            parsedScheme.variableCodings &&
            Array.isArray(parsedScheme.variableCodings)
          ) {
            const variableSourceTypes = new Map<string, string>();
            const variableAliasToId = new Map<string, string>();
            const variableIdToAlias = new Map<string, string>();
            const variableTypes = new Map<string, UnitVariableType>();
            const variableCodes = new Map<
              string,
              Array<{
                id: string | number;
                label: string;
                score?: number;
                manualInstruction?: string;
                type?: string;
              }>
            >();
            const variableManualInstructions = new Map<string, boolean>();
            const variableClosedCoding = new Map<string, boolean>();
            const variableTrainingRequired = new Map<string, boolean>();
            const variableProcessing = new Map<string, string[]>();

            for (const vc of parsedScheme.variableCodings) {
              if (vc.id && vc.sourceType) {
                variableSourceTypes.set(vc.id, vc.sourceType);
              }
              if (vc.id && vc.alias) {
                variableAliasToId.set(vc.alias, vc.id);
                variableIdToAlias.set(vc.id, vc.alias);
              }
              if (vc.id && vc.type) {
                variableTypes.set(vc.id, vc.type);
              }
              if (vc.id && vc.processing && Array.isArray(vc.processing)) {
                variableProcessing.set(vc.id, [...vc.processing]);
                if (vc.processing.includes('CODER_TRAINING_REQUIRED')) {
                  variableTrainingRequired.set(vc.id, true);
                }
              }

              if (vc.id && vc.codes && Array.isArray(vc.codes)) {
                const codes = vc.codes
                  .filter(code => code.id !== undefined)
                  .map(code => ({
                    id: code.id,
                    label: code.label || String(code.id),
                    score: code.score,
                    manualInstruction: code.manualInstruction,
                    type: code.type
                  }));
                if (codes.length > 0) {
                  variableCodes.set(vc.id, codes);
                }

                // Check if any code has manual instruction (similar to isManual() in codebook-generator)
                const hasManualInstruction = vc.codes.some(
                  code => hasVisibleManualInstruction(code)
                );
                if (hasManualInstruction) {
                  variableManualInstructions.set(vc.id, true);
                }

                // Check if any code is closed coding (similar to isClosed() in codebook-generator)
                const hasClosedCoding = vc.codes.some(
                  code => code.type === 'RESIDUAL_AUTO' ||
                    code.type === 'INTENDED_INCOMPLETE'
                );
                if (hasClosedCoding) {
                  variableClosedCoding.set(vc.id, true);
                }
              }
            }
            codingSchemeVariablesMap.set(unitId, variableSourceTypes);
            codingSchemeAliasToIdMap.set(unitId, variableAliasToId);
            codingSchemeIdToAliasMap.set(unitId, variableIdToAlias);
            codingSchemeVariableTypesMap.set(unitId, variableTypes);
            codingSchemeCodesMap.set(unitId, variableCodes);
            codingSchemeManualInstructionsMap.set(
              unitId,
              variableManualInstructions
            );
            codingSchemeClosedCodingMap.set(unitId, variableClosedCoding);
            codingSchemeTrainingRequiredMap.set(
              unitId,
              variableTrainingRequired
            );
            codingSchemeProcessingMap.set(unitId, variableProcessing);
          }
        } catch (error) {
          this.logger.error(
            `Error parsing coding scheme ${scheme.file_id}: ${getErrorMessage(error)}`,
            getErrorStack(error)
          );
        }
      }

      const unitVariableDetails: UnitVariableDetailsDto[] = [];
      const visibility = await this.getWorkspaceUnitVisibility(workspaceId);

      for (const unitFile of unitFiles) {
        try {
          const xmlContent = unitFile.data.toString();
          const parsedXml = await parseStringPromise(xmlContent, {
            explicitArray: false
          });

          if (
            parsedXml.Unit &&
            parsedXml.Unit.Metadata &&
            parsedXml.Unit.Metadata.Id
          ) {
            const unitName = parsedXml.Unit.Metadata.Id;
            if (!this.isUnitVisibleInWorkspace(unitName, visibility)) {
              continue;
            }
            const variables: VariableDetailDto[] = [];
            const seenSchemeIds = new Set<string>();
            const seenAliases = new Set<string>();

            // Process BaseVariables
            if (
              parsedXml.Unit.BaseVariables &&
              parsedXml.Unit.BaseVariables.Variable
            ) {
              const baseVariables = Array.isArray(
                parsedXml.Unit.BaseVariables.Variable
              ) ?
                parsedXml.Unit.BaseVariables.Variable :
                [parsedXml.Unit.BaseVariables.Variable];

              for (const variable of baseVariables) {
                if (variable.$.alias && variable.$.type !== 'no-value') {
                  const variableAlias = variable.$.alias;
                  const unitAliasToId =
                    codingSchemeAliasToIdMap.get(unitName);
                  const variableId = variable.$.id ||
                    unitAliasToId?.get(variableAlias) ||
                    variableAlias;
                  const unitSourceTypes =
                    codingSchemeVariablesMap.get(unitName);
                  const sourceType = unitSourceTypes?.get(variableId);

                  // Skip variables with BASE_NO_VALUE sourceType in coding scheme
                  // If no coding scheme exists, sourceType is undefined and variable is included
                  if (sourceType === 'BASE_NO_VALUE') {
                    continue;
                  }

                  const hasCodingScheme = codingSchemeMap.has(unitName);
                  const unitCodes = codingSchemeCodesMap.get(unitName);
                  const variableCodes = unitCodes?.get(variableId);
                  const unitManualInstructions =
                    codingSchemeManualInstructionsMap.get(unitName);
                  const hasManualInstruction =
                    unitManualInstructions?.get(variableId) || false;
                  const unitClosedCoding =
                    codingSchemeClosedCodingMap.get(unitName);
                  const hasClosedCoding =
                    unitClosedCoding?.get(variableId) || false;
                  const unitTrainingRequired =
                    codingSchemeTrainingRequiredMap.get(unitName);
                  const coderTrainingRequired =
                    unitTrainingRequired?.get(variableId) || false;
                  const processing =
                    codingSchemeProcessingMap.get(unitName)?.get(variableId);
                  const isDerived = this.isDerivedSourceType(sourceType);
                  const variableMetadata = this.extractVariableMetadata(
                    variable
                  );
                  variables.push({
                    id: variableId,
                    alias: variableAlias,
                    type: variable.$.type as UnitVariableType,
                    multiple: variableMetadata.multiple,
                    nullable: variableMetadata.nullable,
                    hasCodingScheme,
                    codingSchemeRef: hasCodingScheme ?
                      codingSchemeMap.get(unitName) :
                      undefined,
                    sourceType,
                    processing,
                    codes: variableCodes,
                    values: variableMetadata.values,
                    valuesComplete: variableMetadata.valuesComplete,
                    valuePositionLabels:
                      variableMetadata.valuePositionLabels,
                    isDerived,
                    hasManualInstruction,
                    hasClosedCoding,
                    coderTrainingRequired
                  });
                  seenSchemeIds.add(variableId);
                  seenAliases.add(variableAlias);
                }
              }
            }

            // Process DerivedVariables (derived variables are not BASE_NO_VALUE and not BASE type)
            if (
              parsedXml.Unit.DerivedVariables &&
              parsedXml.Unit.DerivedVariables.Variable
            ) {
              const derivedVariables = Array.isArray(
                parsedXml.Unit.DerivedVariables.Variable
              ) ?
                parsedXml.Unit.DerivedVariables.Variable :
                [parsedXml.Unit.DerivedVariables.Variable];

              for (const variable of derivedVariables) {
                if (variable.$.alias && variable.$.type !== 'no-value') {
                  const variableAlias = variable.$.alias;
                  const unitAliasToId =
                    codingSchemeAliasToIdMap.get(unitName);
                  const variableId = variable.$.id ||
                    unitAliasToId?.get(variableAlias) ||
                    variableAlias;
                  const unitSourceTypes =
                    codingSchemeVariablesMap.get(unitName);
                  const sourceType = unitSourceTypes?.get(variableId);

                  // Skip variables with BASE_NO_VALUE sourceType in coding scheme
                  // Skip variables with BASE sourceType (include only derived variables)
                  if (sourceType === 'BASE_NO_VALUE' || sourceType === 'BASE') {
                    continue;
                  }

                  const hasCodingScheme = codingSchemeMap.has(unitName);
                  const unitCodes = codingSchemeCodesMap.get(unitName);
                  const variableCodes = unitCodes?.get(variableId);
                  const unitManualInstructions =
                    codingSchemeManualInstructionsMap.get(unitName);
                  const hasManualInstruction =
                    unitManualInstructions?.get(variableId) || false;
                  const unitClosedCoding =
                    codingSchemeClosedCodingMap.get(unitName);
                  const hasClosedCoding =
                    unitClosedCoding?.get(variableId) || false;
                  const unitTrainingRequired =
                    codingSchemeTrainingRequiredMap.get(unitName);
                  const coderTrainingRequired =
                    unitTrainingRequired?.get(variableId) || false;
                  const processing =
                    codingSchemeProcessingMap.get(unitName)?.get(variableId);
                  const variableMetadata = this.extractVariableMetadata(
                    variable
                  );
                  variables.push({
                    id: variableId,
                    alias: variableAlias,
                    type: variable.$.type as UnitVariableType,
                    multiple: variableMetadata.multiple,
                    nullable: variableMetadata.nullable,
                    hasCodingScheme,
                    codingSchemeRef: hasCodingScheme ?
                      codingSchemeMap.get(unitName) :
                      undefined,
                    sourceType,
                    processing,
                    codes: variableCodes,
                    values: variableMetadata.values,
                    valuesComplete: variableMetadata.valuesComplete,
                    valuePositionLabels:
                      variableMetadata.valuePositionLabels,
                    isDerived: true,
                    hasManualInstruction,
                    hasClosedCoding,
                    coderTrainingRequired
                  });
                  seenSchemeIds.add(variableId);
                  seenAliases.add(variableAlias);
                }
              }
            }

            const unitSourceTypes = codingSchemeVariablesMap.get(unitName);
            const unitIdToAlias = codingSchemeIdToAliasMap.get(unitName);
            const unitVariableTypes = codingSchemeVariableTypesMap.get(unitName);
            if (unitSourceTypes) {
              for (const [schemeId, sourceType] of unitSourceTypes.entries()) {
                if (!this.isDerivedSourceType(sourceType)) {
                  continue;
                }
                const variableAlias = unitIdToAlias?.get(schemeId) || schemeId;
                if (
                  seenSchemeIds.has(schemeId) ||
                  seenAliases.has(variableAlias)
                ) {
                  continue;
                }

                const unitCodes = codingSchemeCodesMap.get(unitName);
                const variableCodes = unitCodes?.get(schemeId);
                const unitManualInstructions =
                  codingSchemeManualInstructionsMap.get(unitName);
                const hasManualInstruction =
                  unitManualInstructions?.get(schemeId) || false;
                const unitClosedCoding =
                  codingSchemeClosedCodingMap.get(unitName);
                const hasClosedCoding =
                  unitClosedCoding?.get(schemeId) || false;
                const unitTrainingRequired =
                  codingSchemeTrainingRequiredMap.get(unitName);
                const coderTrainingRequired =
                  unitTrainingRequired?.get(schemeId) || false;
                const processing =
                  codingSchemeProcessingMap.get(unitName)?.get(schemeId);

                variables.push({
                  id: schemeId,
                  alias: variableAlias,
                  type: unitVariableTypes?.get(schemeId) || 'string',
                  hasCodingScheme: true,
                  codingSchemeRef: codingSchemeMap.get(unitName),
                  sourceType,
                  processing,
                  codes: variableCodes,
                  isDerived: true,
                  hasManualInstruction,
                  hasClosedCoding,
                  coderTrainingRequired
                });
                seenSchemeIds.add(schemeId);
                seenAliases.add(variableAlias);
              }
            }

            // Only include units with at least one variable
            if (variables.length > 0) {
              unitVariableDetails.push({
                unitName,
                unitId: unitName,
                variables
              });
            }
          }
        } catch (e) {
          this.logger.warn(
            `Error parsing unit file ${unitFile.file_id}: ${
              (e as Error).message
            }`
          );
        }
      }

      this.logger.log(
        `Retrieved ${unitVariableDetails.length} units with variables for workspace ${workspaceId}`
      );
      return unitVariableDetails;
    } catch (error) {
      this.logger.error(
        `Error getting unit variable details for workspace ${workspaceId}: ${getErrorMessage(error)}`,
        getErrorStack(error)
      );
      return [];
    }
  }

  private extractVariableMetadata(
    variable: ParsedVariableElement
  ): Pick<
    VariableDetailDto,
    | 'multiple'
    | 'nullable'
    | 'values'
    | 'valuesComplete'
    | 'valuePositionLabels'
  > {
    return {
      multiple: this.parseOptionalBoolean(variable.$?.multiple),
      nullable: this.parseOptionalBoolean(variable.$?.nullable),
      values: this.extractVariableValues(variable.Values),
      valuesComplete: this.extractValuesComplete(variable.Values),
      valuePositionLabels: this.extractValuePositionLabels(
        variable.ValuePositionLabels
      )
    };
  }

  private extractVariableValues(
    valuesElement: unknown
  ): VariableValueInfo[] | undefined {
    const valuesRecord = this.asRecord(valuesElement);
    const valueItems = this.toArray(valuesRecord?.Value)
      .map(valueElement => {
        const valueRecord = this.asRecord(valueElement);
        const rawValue = this.readXmlText(valueRecord?.value);
        const label = this.readXmlText(valueRecord?.label) || rawValue;

        if (rawValue === undefined) {
          return undefined;
        }

        return {
          value: rawValue,
          label: label || rawValue
        };
      })
      .filter((value): value is VariableValueInfo => Boolean(value));

    return valueItems.length > 0 ? valueItems : undefined;
  }

  private extractValuesComplete(valuesElement: unknown): boolean | undefined {
    const valuesRecord = this.asRecord(valuesElement);
    const attributes = this.asRecord(valuesRecord?.$);
    const complete = attributes?.complete;

    return typeof complete === 'string' || typeof complete === 'boolean' ?
      this.parseOptionalBoolean(complete) :
      undefined;
  }

  private extractValuePositionLabels(
    labelsElement: unknown
  ): string[] | undefined {
    const labelsRecord = this.asRecord(labelsElement);
    const labels = this.toArray(labelsRecord?.ValuePositionLabel)
      .map(label => this.readXmlText(label))
      .filter((label): label is string => Boolean(label));

    return labels.length > 0 ? labels : undefined;
  }

  private parseOptionalBoolean(value?: string | boolean): boolean | undefined {
    if (value === undefined) {
      return undefined;
    }

    if (typeof value === 'boolean') {
      return value;
    }

    return value === 'true' || value === '1';
  }

  private toArray(value: unknown): unknown[] {
    if (value === undefined || value === null) {
      return [];
    }

    return Array.isArray(value) ? value : [value];
  }

  private asRecord(value: unknown): Record<string, unknown> | undefined {
    return typeof value === 'object' && value !== null ?
      value as Record<string, unknown> :
      undefined;
  }

  private readXmlText(value: unknown): string | undefined {
    if (Array.isArray(value)) {
      return this.readXmlText(value[0]);
    }

    const record = this.asRecord(value);
    if (record && record._ !== undefined) {
      return this.readXmlText(record._);
    }

    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      return String(value);
    }

    return undefined;
  }

  async invalidateMetadataCache(workspaceId: number): Promise<void> {
    await Promise.all([
      'unit_variables', 'intended_incomplete', 'training_required', 'derived_variables',
      'derived_variables_by_source', 'derived_variable_metadata_complete', 'manual_instruction_variables'
    ].map(type => this.cacheService.delete(this.getCacheKey(workspaceId, type))));
  }
}
