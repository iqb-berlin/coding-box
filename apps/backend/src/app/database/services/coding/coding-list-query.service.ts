import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ResponseEntity } from '../../entities/response.entity';
import { Setting } from '../../entities/setting.entity';
import { statusNumberToString } from '../../utils/response-status-converter';
// eslint-disable-next-line import/no-cycle
import { WorkspaceFilesService } from '../workspace/workspace-files.service';
import { WorkspaceCoreService } from '../workspace/workspace-core.service';
import {
  applyResolvedExclusionsToQuery,
  WorkspaceExclusionService
} from '../workspace/workspace-exclusion.service';
import { CodingItem } from './coding-item-builder.service';
import { CodingFileCacheService } from './coding-file-cache.service';
import {
  getCoveredSourceKeysForManualDerivedVariables,
  isCoveredSourceVariable
} from '../../utils/manual-coding-scope.util';
import {
  CODING_INCOMPLETE_STATUS,
  DERIVE_ERROR_STATUS,
  getDeriveErrorCodingListPairKeys,
  INTENDED_INCOMPLETE_STATUS,
  MANUAL_CODING_DEFAULT_CANDIDATE_STATUSES,
  toManualCodingVariablePairKey
} from '../../utils/manual-coding-candidate.util';
import { isDeriveErrorInManualCodingEnabled } from '../../utils/manual-coding-setting.util';
import { generateReplayUrl } from '../../../utils/replay-url.util';
import { CodingReplayAnchorService } from './coding-replay-anchor.service';
import {
  getCodingResponseValueCandidateSql,
  getCodingVariableIdCandidateSql
} from './coding-response-candidate.util';

const PAGE_MAP_LOOKUP_BATCH_SIZE = 8;

/**
 * Service responsible for querying coding lists and variables.
 *
 * Handles:
 * - Getting complete coding lists with filtering
 * - Getting coding list variables
 * - Sorting and organizing results
 */
@Injectable()
export class CodingListQueryService {
  private readonly logger = new Logger(CodingListQueryService.name);

  constructor(
    @InjectRepository(ResponseEntity)
    private readonly responseRepository: Repository<ResponseEntity>,
    private readonly fileCacheService: CodingFileCacheService,
    private readonly workspaceFilesService: WorkspaceFilesService,
    private readonly workspaceCoreService: WorkspaceCoreService,
    private readonly workspaceExclusionService: WorkspaceExclusionService,
    @Optional() private readonly replayAnchorService?: CodingReplayAnchorService,
    @Optional()
    @InjectRepository(Setting)
    private readonly settingRepository?: Repository<Setting>
  ) { }

  async getValidVariablePairKeys(workspaceId: number): Promise<string[]> {
    const unitVariableMap = await this.workspaceFilesService.getUnitVariableMap(workspaceId);
    return Array.from(unitVariableMap.entries()).flatMap(([unitName, variableIds]) => (
      Array.from(variableIds).map(variableId => `${unitName}\u001F${variableId}`)
    ));
  }

  /**
   * Get the complete coding list for a workspace.
   * Returns all CODING_INCOMPLETE responses that should be coded.
   */
  async getCodingList(
    workspace_id: number,
    authToken: string,
    serverUrl?: string,
    trainingRequired?: boolean
  ): Promise<{
      items: CodingItem[];
      total: number;
    }> {
    try {
      const server = serverUrl;
      const includeDeriveError =
        await isDeriveErrorInManualCodingEnabled(
          this.settingRepository,
          workspace_id
        );
      const candidateStatuses = includeDeriveError ?
        [...MANUAL_CODING_DEFAULT_CANDIDATE_STATUSES, DERIVE_ERROR_STATUS] :
        MANUAL_CODING_DEFAULT_CANDIDATE_STATUSES;

      // 1) Query explicitly selected manual-coding candidate responses.
      const queryBuilder = this.responseRepository
        .createQueryBuilder('response')
        .leftJoinAndSelect('response.unit', 'unit')
        .leftJoinAndSelect('unit.booklet', 'booklet')
        .leftJoinAndSelect('booklet.person', 'person')
        .leftJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
        .where('person.workspace_id = :workspace_id', { workspace_id })
        .andWhere('person.consider = :consider', { consider: true })
        .andWhere('response.status_v1 IN (:...statuses)', {
          statuses: candidateStatuses
        })
        .orderBy('response.id', 'ASC');

      const { globalIgnoredUnits, ignoredBooklets, testletIgnoredUnits } = await this.workspaceExclusionService.resolveExclusionsForQueries(workspace_id);
      applyResolvedExclusionsToQuery(queryBuilder, { globalIgnoredUnits, ignoredBooklets, testletIgnoredUnits });

      const [responses, total] = await queryBuilder.getManyAndCount();

      // 2) Load variable maps from WorkspaceFilesService
      //    unitVariableMap: unitName → Set of valid variable aliases (includes derived vars, excludes BASE/BASE_NO_VALUE)
      //    trainingRequiredMap: unitName → Set of variable aliases that have CODER_TRAINING_REQUIRED property
      const [
        unitVariableMap,
        trainingRequiredMap,
        derivedVariablesBySourceMap,
        manualInstructionMap
      ] = await Promise.all([
        this.workspaceFilesService.getUnitVariableMap(workspace_id),
        this.workspaceFilesService.getCoderTrainingRequiredVariableMap(workspace_id),
        this.workspaceFilesService.getDerivedVariablesBySourceMap(workspace_id),
        this.workspaceFilesService.getManualInstructionVariableMap(workspace_id)
      ]);

      const validVariableSets = new Map<string, Set<string>>();
      unitVariableMap.forEach((variables: Set<string>, unitNameKey: string) => {
        validVariableSets.set(unitNameKey.toUpperCase(), variables);
      });

      const trainingRequiredSets = new Map<string, Set<string>>();
      trainingRequiredMap.forEach((variables: Set<string>, unitNameKey: string) => {
        trainingRequiredSets.set(unitNameKey.toUpperCase(), variables);
      });

      const manualInstructionSets = new Map<string, Set<string>>();
      manualInstructionMap.forEach((variables: Set<string>, unitNameKey: string) => {
        manualInstructionSets.set(unitNameKey.toUpperCase(), variables);
      });
      const deriveErrorPairKeys = new Set(
        includeDeriveError ?
          getDeriveErrorCodingListPairKeys(
            unitVariableMap,
            manualInstructionMap,
            derivedVariablesBySourceMap
          ) :
          []
      );

      // 3) Filter responses:
      //    - Variable must exist in unitVariableMap (valid, non-BASE/BASE_NO_VALUE)
      //    - For INTENDED_INCOMPLETE: exclude source variables already represented by a manual derived variable
      //    - Also exclude variables matching media substrings and empty values
      //    - Apply trainingRequired filter if provided
      const baseFiltered = responses.filter(r => {
        const unitKey = r.unit?.name || '';
        const variableId = r.variableid || '';
        const hasValue = r.value != null && r.value.trim() !== '';
        const responseStatus = Number(r.status_v1);
        const isIncludedDeriveError =
          responseStatus === DERIVE_ERROR_STATUS &&
          deriveErrorPairKeys.has(toManualCodingVariablePairKey(
            unitKey.toUpperCase(),
            variableId
          ));

        if (
          !MANUAL_CODING_DEFAULT_CANDIDATE_STATUSES.includes(responseStatus) &&
          !isIncludedDeriveError
        ) return false;
        if (!hasValue) return false;

        const hasExcludedSubstring = /image|text|audio|frame|video|_0/i.test(variableId);
        if (hasExcludedSubstring) return false;

        const validVars = validVariableSets.get(unitKey.toUpperCase());
        if (!validVars?.has(variableId)) return false;

        if (
          Number(r.status_v1) === INTENDED_INCOMPLETE_STATUS &&
          !manualInstructionSets.get(unitKey.toUpperCase())?.has(variableId)
        ) {
          return false;
        }

        // Apply trainingRequired filter
        if (trainingRequired !== undefined) {
          const isTrainingRequired = trainingRequiredSets.get(unitKey.toUpperCase())?.has(variableId) || false;
          if (isTrainingRequired !== trainingRequired) {
            return false;
          }
        }

        return true;
      });
      const coveredSourceKeys = getCoveredSourceKeysForManualDerivedVariables(
        baseFiltered
          .filter(response => response.status_v1 === CODING_INCOMPLETE_STATUS)
          .map(response => ({
            unitName: response.unit?.name || '',
            variableId: response.variableid || ''
          })),
        derivedVariablesBySourceMap
      );
      const filtered = baseFiltered.filter(response => (
        response.status_v1 !== INTENDED_INCOMPLETE_STATUS ||
        !isCoveredSourceVariable(
          {
            unitName: response.unit?.name || '',
            variableId: response.variableid || ''
          },
          coveredSourceKeys
        )
      ));

      const unitKeys = Array.from(
        new Set(
          filtered
            .map(response => response.unit?.name || '')
            .filter(unitKey => unitKey.length > 0)
        )
      );
      const variablePageMap = await this.loadVariablePageMaps(
        unitKeys,
        workspace_id
      );
      const variableAnchorMap = await this.loadVariableAnchorMaps(
        unitKeys,
        workspace_id
      );

      const result = filtered.map(response => {
        const unit = response.unit;
        const booklet = unit?.booklet;
        const person = booklet?.person;
        const bookletInfo = booklet?.bookletinfo;
        const loginName = person?.login || '';
        const loginCode = person?.code || '';
        const loginGroup = person?.group || '';
        const bookletId = bookletInfo?.name || '';
        const unitKey = unit?.name || '';
        const unitAlias = unit?.alias || '';
        const variableId = response.variableid || '';
        const unitVarPages = variablePageMap.get(unitKey);
        const variablePage = unitVarPages?.get(variableId) || '0';
        const unitVarAnchors = variableAnchorMap.get(unitKey);
        const variableAnchor = unitVarAnchors?.get(variableId) || variableId;

        const url = generateReplayUrl({
          serverUrl: server || '',
          loginName,
          loginCode,
          loginGroup,
          bookletId,
          unitId: unitKey,
          variablePage,
          variableAnchor,
          authToken,
          workspaceId: authToken ? undefined : workspace_id
        });

        return {
          unit_key: unitKey,
          unit_alias: unitAlias,
          person_login: loginName,
          person_code: loginCode,
          person_group: loginGroup,
          booklet_name: bookletId,
          variable_id: variableId,
          variable_page: variablePage,
          variable_anchor: variableAnchor,
          status_v1: statusNumberToString(Number(response.status_v1)) || '',
          url
        };
      });

      // 4) Sort
      const sortedResult = result.sort((a, b) => {
        const unitKeyComparison = a.unit_key.localeCompare(b.unit_key);
        if (unitKeyComparison !== 0) {
          return unitKeyComparison;
        }
        return a.variable_id.localeCompare(b.variable_id);
      });

      this.logger.log(
        `Found ${sortedResult.length} coding items after manual-coding candidate filtering, total raw ${total}`
      );
      return { items: sortedResult, total: sortedResult.length };
    } catch (error) {
      this.logger.error(`Error fetching coding list: ${error.message}`);
      return { items: [], total: 0 };
    }
  }

  private async loadVariablePageMaps(
    unitKeys: string[],
    workspaceId: number
  ): Promise<Map<string, Map<string, string>>> {
    const variablePageMap = new Map<string, Map<string, string>>();

    for (let start = 0; start < unitKeys.length; start += PAGE_MAP_LOOKUP_BATCH_SIZE) {
      const batch = unitKeys.slice(start, start + PAGE_MAP_LOOKUP_BATCH_SIZE);
      await Promise.all(
        batch.map(async unitKey => {
          try {
            variablePageMap.set(
              unitKey,
              await this.fileCacheService.getVariablePageMap(unitKey, workspaceId)
            );
          } catch (error) {
            this.logger.warn(
              `Error loading variable page map for unit ${unitKey}: ${error.message}`
            );
            variablePageMap.set(unitKey, new Map<string, string>());
          }
        })
      );
    }

    return variablePageMap;
  }

  private async loadVariableAnchorMaps(
    unitKeys: string[],
    workspaceId: number
  ): Promise<Map<string, Map<string, string>>> {
    const variableAnchorMap = new Map<string, Map<string, string>>();

    if (!this.replayAnchorService) {
      unitKeys.forEach(unitKey => variableAnchorMap.set(unitKey, new Map()));
      return variableAnchorMap;
    }

    try {
      return await this.replayAnchorService.getVariableAnchorMaps(
        unitKeys,
        workspaceId
      );
    } catch (error) {
      this.logger.warn(
        `Error loading replay anchor maps for workspace ${workspaceId}: ${error.message}`
      );
      unitKeys.forEach(unitKey => variableAnchorMap.set(unitKey, new Map()));
    }

    return variableAnchorMap;
  }

  /**
   * Get all variables that need coding for a workspace.
   * Returns distinct unit/variable pairs.
   */
  async getCodingListVariables(
    workspaceId: number,
    trainingRequired?: boolean
  ): Promise<Array<{ unitName: string; variableId: string }>> {
    const includeDeriveError = await isDeriveErrorInManualCodingEnabled(
      this.settingRepository,
      workspaceId
    );
    const candidateStatuses = includeDeriveError ?
      [...MANUAL_CODING_DEFAULT_CANDIDATE_STATUSES, DERIVE_ERROR_STATUS] :
      MANUAL_CODING_DEFAULT_CANDIDATE_STATUSES;
    const queryBuilder = this.responseRepository
      .createQueryBuilder('response')
      .innerJoin('response.unit', 'unit')
      .innerJoin('unit.booklet', 'booklet')
      .innerJoin('booklet.person', 'person')
      .leftJoin('booklet.bookletinfo', 'bookletinfo')
      .select('unit.name', 'unitName')
      .addSelect('response.variableid', 'variableId')
      .addSelect('response.status_v1', 'statusV1')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      .andWhere(getCodingResponseValueCandidateSql('response'))
      .andWhere('response.status_v1 IN (:...statuses)', {
        statuses: candidateStatuses
      });

    queryBuilder.andWhere(getCodingVariableIdCandidateSql('response'));

    const { globalIgnoredUnits, ignoredBooklets, testletIgnoredUnits } = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    applyResolvedExclusionsToQuery(queryBuilder, { globalIgnoredUnits, ignoredBooklets, testletIgnoredUnits });

    const rawResults = await queryBuilder.getRawMany();

    // Load variable maps from WorkspaceFilesService:
    //   unitVariableMap: includes all valid variables (derived + base, excluding BASE/BASE_NO_VALUE)
    //   trainingRequiredMap: variables with CODER_TRAINING_REQUIRED property
    const [
      unitVariableMap,
      trainingRequiredMap,
      derivedVariablesBySourceMap,
      manualInstructionMap
    ] = await Promise.all([
      this.workspaceFilesService.getUnitVariableMap(workspaceId),
      this.workspaceFilesService.getCoderTrainingRequiredVariableMap(workspaceId),
      this.workspaceFilesService.getDerivedVariablesBySourceMap(workspaceId),
      this.workspaceFilesService.getManualInstructionVariableMap(workspaceId)
    ]);

    const validVariableSets = new Map<string, Set<string>>();
    unitVariableMap.forEach((variables: Set<string>, unitName: string) => {
      validVariableSets.set(unitName.toUpperCase(), variables);
    });

    const trainingRequiredSets = new Map<string, Set<string>>();
    trainingRequiredMap.forEach((variables: Set<string>, unitName: string) => {
      trainingRequiredSets.set(unitName.toUpperCase(), variables);
    });

    const manualInstructionSets = new Map<string, Set<string>>();
    manualInstructionMap.forEach((variables: Set<string>, unitName: string) => {
      manualInstructionSets.set(unitName.toUpperCase(), variables);
    });
    const deriveErrorPairKeys = new Set(
      includeDeriveError ?
        getDeriveErrorCodingListPairKeys(
          unitVariableMap,
          manualInstructionMap,
          derivedVariablesBySourceMap
        ) :
        []
    );

    const baseFilteredResults = rawResults.filter(row => {
      const unitNameUpper = row.unitName?.toUpperCase() || '';
      const variableId: string = row.variableId;
      const responseStatus = Number(row.statusV1);
      const isIncludedDeriveError =
        responseStatus === DERIVE_ERROR_STATUS &&
        deriveErrorPairKeys.has(toManualCodingVariablePairKey(
          unitNameUpper,
          variableId
        ));

      if (
        !MANUAL_CODING_DEFAULT_CANDIDATE_STATUSES.includes(responseStatus) &&
        !isIncludedDeriveError
      ) return false;

      const validVars = validVariableSets.get(unitNameUpper);
      if (!validVars?.has(variableId)) return false;

      if (
        Number(row.statusV1) === INTENDED_INCOMPLETE_STATUS &&
        !manualInstructionSets.get(unitNameUpper)?.has(variableId)
      ) {
        return false;
      }

      if (trainingRequired !== undefined) {
        const isTrainingRequired = trainingRequiredSets.get(unitNameUpper)?.has(variableId) || false;
        if (isTrainingRequired !== trainingRequired) {
          return false;
        }
      }

      return true;
    });
    const coveredSourceKeys = getCoveredSourceKeysForManualDerivedVariables(
      baseFilteredResults
        .filter(row => Number(row.statusV1) === CODING_INCOMPLETE_STATUS)
        .map(row => ({
          unitName: row.unitName,
          variableId: row.variableId
        })),
      derivedVariablesBySourceMap
    );

    // Deduplicate while applying source-variable filters
    const seen = new Set<string>();
    const filteredResults: { unitName: string; variableId: string }[] = [];

    for (const row of baseFilteredResults) {
      const variableId: string = row.variableId;
      const statusV1: number = Number(row.statusV1);

      // For INTENDED_INCOMPLETE rows: skip source variables already covered by derived variables
      if (statusV1 === INTENDED_INCOMPLETE_STATUS) {
        if (isCoveredSourceVariable(row, coveredSourceKeys)) {
          continue;
        }
      }

      const key = `${row.unitName}::${variableId}`;
      if (!seen.has(key)) {
        seen.add(key);
        filteredResults.push({ unitName: row.unitName, variableId });
      }
    }

    this.logger.log(
      `Found ${rawResults.length} manual-coding candidate variable rows, filtered to ${filteredResults.length} valid distinct variables`
    );

    return filteredResults;
  }
}
