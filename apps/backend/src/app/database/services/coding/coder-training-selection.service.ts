import {
  BadRequestException,
  Inject,
  Injectable, Logger
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Brackets,
  In,
  Repository
} from 'typeorm';
import { ChunkEntity } from '../../entities/chunk.entity';
import { CoderTrainingBundle } from '../../entities/coder-training-bundle.entity';
import { CoderTrainingVariable } from '../../entities/coder-training-variable.entity';
import type { CaseSelectionMode, ReferenceMode } from '../../entities/coder-training.entity';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';
import { JobDefinitionVariable, JobDefinitionVariableBundle } from '../../entities/job-definition.entity';
import { ResponseEntity } from '../../entities/response.entity';
import { VariableBundle } from '../../entities/variable-bundle.entity';
import {
  DERIVE_ERROR_STATUS,
  MANUAL_CODING_DEFAULT_CANDIDATE_STATUSES
} from '../../utils/manual-coding-candidate.util';
import {
  WorkspaceExclusionService,
  applyResolvedExclusionsToQuery
} from '../workspace/workspace-exclusion.service';
import { WORKSPACE_FILE_METADATA_READER, WorkspaceFileMetadataReader } from '../workspace/workspace-file-metadata-reader.token';
import {
  buildAggregationGroups,
  deduplicateManualCodingResponses
} from './aggregation-metrics.util';
import {
  CoderTrainingResponse, TrainingBundleConfig, TrainingPackage, TrainingResponseIdsMap, TrainingVariableConfig
} from './coder-training.types';
import { CoderTrainingSamplingService } from './coder-training-sampling.service';
import { makeTrainingVariableKey } from './coder-training.util';
import { CodingJobService } from './coding-job.service';

@Injectable()
export class CoderTrainingSelectionService {
  private readonly logger = new Logger('CoderTrainingService');

  constructor(
    @InjectRepository(CodingJobUnit)
    private codingJobUnitRepository: Repository<CodingJobUnit>,
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    @InjectRepository(VariableBundle)
    private variableBundleRepository: Repository<VariableBundle>,
    @InjectRepository(ChunkEntity)
    private chunkRepository: Repository<ChunkEntity>,
    private codingJobService: CodingJobService,
    @Inject(WORKSPACE_FILE_METADATA_READER) private workspaceFilesService: WorkspaceFileMetadataReader,
    private workspaceExclusionService: WorkspaceExclusionService,
    private readonly sampling: CoderTrainingSamplingService
  ) {}

  /**
   * Get response IDs used in the given trainings, grouped by variable.
   * Both unit name and unit alias are exposed as keys so reference training filters
   * match whichever unit identifier the current training configuration uses.
   */
  async getTrainingResponseIds(
    workspaceId: number,
    trainingIds: number[]
  ): Promise<TrainingResponseIdsMap> {
    if (trainingIds.length === 0) {
      return {};
    }

    this.logger.log(`Getting response IDs for trainings ${trainingIds.join(', ')} in workspace ${workspaceId}`);

    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    const query = this.codingJobUnitRepository
      .createQueryBuilder('cju')
      .innerJoin('cju.coding_job', 'cj')
      .select('cju.unit_name', 'unitName')
      .addSelect('cju.unit_alias', 'unitAlias')
      .addSelect('cju.variable_id', 'variableId')
      .addSelect('cju.response_id', 'responseId')
      .where('cj.workspace_id = :workspaceId', { workspaceId })
      .andWhere('cj.training_id IN (:...trainingIds)', { trainingIds })
      .distinct(true);
    applyResolvedExclusionsToQuery(query, exclusions, {
      unitNameExpression: 'cju.unit_name',
      bookletNameExpression: 'cju.booklet_name',
      parameterPrefix: 'trainingResponseIds'
    });
    const rows = await query.getRawMany<{
      unitName?: string | null;
      unitAlias?: string | null;
      unitKey?: string | null;
      variableId: string;
      responseId: number;
    }>();

    const result: TrainingResponseIdsMap = {};
    for (const row of rows) {
      const unitKeys = new Set([row.unitName, row.unitAlias, row.unitKey].filter((key): key is string => !!key));
      for (const unitKey of unitKeys) {
        const key = `${unitKey}:${row.variableId}`;
        if (!result[key]) {
          result[key] = [];
        }
        if (!result[key].includes(row.responseId)) {
          result[key].push(row.responseId);
        }
      }
    }

    this.logger.log(`Found response IDs for ${Object.keys(result).length} variable configs`);
    return result;
  }

  getValidatedBundleIds(
    assignedVariableBundles: JobDefinitionVariableBundle[] = []
  ): number[] {
    const invalidBundleIds = assignedVariableBundles
      .map(bundle => bundle?.id)
      .filter(id => !Number.isInteger(id));

    if (invalidBundleIds.length > 0) {
      throw new BadRequestException(
        `Invalid variable bundle IDs: ${invalidBundleIds.map(id => String(id)).join(', ')}`
      );
    }

    return assignedVariableBundles.map(bundle => bundle.id);
  }

  async getWorkspaceVariableBundlesById(
    workspaceId: number,
    bundleIds: number[]
  ): Promise<Map<number, VariableBundle>> {
    const uniqueBundleIds = Array.from(new Set(bundleIds));
    if (uniqueBundleIds.length === 0) {
      return new Map();
    }

    const variableBundles = await this.variableBundleRepository.find({
      where: {
        id: In(uniqueBundleIds),
        workspace_id: workspaceId
      }
    });
    const variableBundlesById = new Map(variableBundles.map(bundle => [bundle.id, bundle]));
    const missingBundleIds = uniqueBundleIds.filter(id => !variableBundlesById.has(id));

    if (missingBundleIds.length > 0) {
      throw new BadRequestException(
        `Unknown variable bundle IDs for workspace ${workspaceId}: ${missingBundleIds.join(', ')}`
      );
    }

    return variableBundlesById;
  }

  private async resolveBundleVariableSelections(
    workspaceId: number,
    assignedVariableBundles: JobDefinitionVariableBundle[] = []
  ): Promise<JobDefinitionVariable[]> {
    const bundleIds = this.getValidatedBundleIds(assignedVariableBundles);
    const fetchedBundleById = await this.getWorkspaceVariableBundlesById(workspaceId, bundleIds);
    const variablesByKey = new Map<string, JobDefinitionVariable>();

    const addBundleVariable = (
      variable: JobDefinitionVariable,
      bundleSampleCount?: number
    ) => {
      if (!variable.unitName || !variable.variableId) {
        return;
      }

      const key = makeTrainingVariableKey(variable.unitName, variable.variableId);
      const existing = variablesByKey.get(key);
      variablesByKey.set(key, {
        unitName: variable.unitName,
        variableId: variable.variableId,
        sampleCount: existing?.sampleCount || variable.sampleCount || bundleSampleCount || 10,
        includeDeriveError: existing?.includeDeriveError === true || variable.includeDeriveError === true ?
          true :
          undefined
      });
    };

    assignedVariableBundles.forEach(bundle => {
      const configuredBundleVariablesByKey = new Map(
        (bundle.variables || []).map(variable => [
          makeTrainingVariableKey(variable.unitName, variable.variableId),
          variable
        ])
      );
      const bundleVariables = fetchedBundleById.get(bundle.id)?.variables || [];
      bundleVariables.forEach(variable => {
        const configuredVariable = configuredBundleVariablesByKey.get(
          makeTrainingVariableKey(variable.unitName, variable.variableId)
        );
        addBundleVariable({
          unitName: variable.unitName,
          variableId: variable.variableId,
          sampleCount: configuredVariable?.sampleCount,
          includeDeriveError: configuredVariable?.includeDeriveError
        }, bundle.sampleCount);
      });
    });

    return Array.from(variablesByKey.values());
  }

  async buildTrainingVariableSelections(
    workspaceId: number,
    variableConfigs: TrainingVariableConfig[] = [],
    assignedVariables: JobDefinitionVariable[] = [],
    assignedVariableBundles: JobDefinitionVariableBundle[] = []
  ): Promise<JobDefinitionVariable[]> {
    const bundleVariables = await this.resolveBundleVariableSelections(workspaceId, assignedVariableBundles);
    const fallbackVariables = [...assignedVariables, ...bundleVariables];
    const assignedVariablesByKey = new Map<string, JobDefinitionVariable>();
    fallbackVariables.forEach(variable => {
      assignedVariablesByKey.set(
        makeTrainingVariableKey(variable.unitName, variable.variableId),
        variable
      );
    });

    const selectionsByKey = new Map<string, JobDefinitionVariable>();
    variableConfigs.forEach(config => {
      const key = makeTrainingVariableKey(config.unitId, config.variableId);
      const assignedVariable = assignedVariablesByKey.get(key);
      selectionsByKey.set(key, {
        unitName: config.unitId,
        variableId: config.variableId,
        sampleCount: config.sampleCount || assignedVariable?.sampleCount || 10,
        includeDeriveError: config.includeDeriveError === true || assignedVariable?.includeDeriveError === true ?
          true :
          undefined
      });
    });

    fallbackVariables.forEach(variable => {
      const key = makeTrainingVariableKey(variable.unitName, variable.variableId);
      if (!selectionsByKey.has(key)) {
        selectionsByKey.set(key, {
          unitName: variable.unitName,
          variableId: variable.variableId,
          sampleCount: variable.sampleCount || 10,
          includeDeriveError: variable.includeDeriveError === true ? true : undefined
        });
      }
    });

    return Array.from(selectionsByKey.values());
  }

  mapTrainingVariableSelectionsToConfigs(
    variables: JobDefinitionVariable[] = []
  ): TrainingVariableConfig[] {
    return variables.map(variable => ({
      variableId: variable.variableId,
      unitId: variable.unitName,
      sampleCount: variable.sampleCount || 10,
      includeDeriveError: variable.includeDeriveError === true ? true : undefined
    }));
  }

  private async buildTrainingBundleConfigs(
    workspaceId: number,
    assignedVariableBundles: JobDefinitionVariableBundle[] = [],
    variableConfigs: TrainingVariableConfig[] = []
  ): Promise<TrainingBundleConfig[]> {
    const bundleIds = this.getValidatedBundleIds(assignedVariableBundles);
    const fetchedBundleById = await this.getWorkspaceVariableBundlesById(workspaceId, bundleIds);
    const variableConfigByKey = new Map(
      variableConfigs.map(config => [
        makeTrainingVariableKey(config.unitId, config.variableId),
        config
      ])
    );

    return assignedVariableBundles.map(bundle => {
      const fetchedBundle = fetchedBundleById.get(bundle.id);
      const configuredVariablesByKey = new Map(
        (bundle.variables || []).map(variable => [
          makeTrainingVariableKey(variable.unitName, variable.variableId),
          variable
        ])
      );
      const variables = (fetchedBundle?.variables || []).map(variable => {
        const variableKey = makeTrainingVariableKey(
          variable.unitName,
          variable.variableId
        );
        const configuredVariable = configuredVariablesByKey.get(variableKey);
        const selectedConfig = variableConfigByKey.get(variableKey);

        return {
          unitId: variable.unitName,
          variableId: variable.variableId,
          sampleCount:
            selectedConfig?.sampleCount ||
            configuredVariable?.sampleCount ||
            bundle.sampleCount ||
            10,
          includeDeriveError:
            selectedConfig?.includeDeriveError === true ||
            configuredVariable?.includeDeriveError === true ?
              true :
              undefined
        };
      });

      return {
        id: bundle.id,
        name: fetchedBundle?.name || bundle.name || '',
        sampleCount: bundle.sampleCount || 10,
        caseOrderingMode: bundle.caseOrderingMode,
        variables
      };
    });
  }

  mapTrainingBundles(
    bundles: CoderTrainingBundle[] = [],
    variables: JobDefinitionVariable[] = []
  ): JobDefinitionVariableBundle[] {
    const variablesByKey = new Map(
      variables.map(variable => [
        makeTrainingVariableKey(variable.unitName, variable.variableId),
        variable
      ])
    );

    return bundles.map(bundle => ({
      id: bundle.variable_bundle_id,
      name: bundle.bundle?.name || '',
      sampleCount: bundle.sample_count || 10,
      caseOrderingMode: bundle.case_ordering_mode ?? undefined,
      variables: bundle.bundle?.variables?.map(variable => {
        const savedVariable = variablesByKey.get(
          makeTrainingVariableKey(variable.unitName, variable.variableId)
        );
        return {
          unitName: variable.unitName,
          variableId: variable.variableId,
          sampleCount: savedVariable?.sampleCount ?? bundle.sample_count ?? 10,
          includeDeriveError: savedVariable?.includeDeriveError === true ? true : undefined
        };
      })
    }));
  }

  mapTrainingVariables(
    variables: CoderTrainingVariable[] = []
  ): JobDefinitionVariable[] {
    return variables.map(variable => ({
      variableId: variable.variable_id,
      unitName: variable.unit_name,
      sampleCount: variable.sample_count || 10,
      includeDeriveError: variable.include_derive_error === true ? true : undefined
    }));
  }

  async generateCoderTrainingPackages(
    workspaceId: number,
    selectedCoders: { id: number; name: string }[],
    variableConfigs: TrainingVariableConfig[],
    options?: {
      caseSelectionMode?: CaseSelectionMode;
      referenceTrainingIds?: number[];
      referenceMode?: ReferenceMode;
      assignedVariableBundles?: JobDefinitionVariableBundle[];
    }
  ): Promise<TrainingPackage[]> {
    const caseSelectionMode = options?.caseSelectionMode ?? 'oldest_first';
    const referenceTrainingIds = options?.referenceTrainingIds ?? [];
    const referenceMode = options?.referenceMode;

    this.logger.log(`Generating coder training packages for workspace ${workspaceId} with ${selectedCoders.length} coders and ${variableConfigs.length} variable configs (caseSelectionMode=${caseSelectionMode})`);

    const referenceResponseIdsByConfig =
      referenceMode && referenceTrainingIds.length > 0 ?
        await this.getTrainingResponseIds(workspaceId, referenceTrainingIds) :
        null;
    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);

    // Load aggregation settings once for this workspace
    const aggregationThreshold = await this.codingJobService.getAggregationThreshold(workspaceId);
    const matchingFlags = await this.codingJobService.getResponseMatchingMode(workspaceId);
    this.logger.log(`Aggregation threshold: ${aggregationThreshold}, matching flags: ${matchingFlags.join(', ')}`);

    // Build derived variable lookup for the shared aggregation logic.
    const derivedVariableMap = await this.workspaceFilesService.getDerivedVariableMap(workspaceId);
    const derivedVariableSets = new Map<string, Set<string>>();
    derivedVariableMap.forEach((vars, unitNameKey) => {
      derivedVariableSets.set(unitNameKey.toUpperCase(), vars);
    });

    const bundleConfigs = await this.buildTrainingBundleConfigs(
      workspaceId,
      options?.assignedVariableBundles || [],
      variableConfigs
    );
    const bundleVariableKeys = new Set(
      bundleConfigs.flatMap(bundle => bundle.variables.map(variable => this.sampling.makeTrainingConfigKey(
        variable.unitId,
        variable.variableId
      )))
    );

    // Pre-sample responses for each variable configuration to ensure consistency across all coders
    const sampledResponsesByConfig: Map<string, CoderTrainingResponse[]> = new Map();
    const responsesForSamplingByConfig: Map<string, CoderTrainingResponse[]> = new Map();

    for (const config of variableConfigs) {
      const variableId = config.variableId;
      const unitId = config.unitId;
      const sampleCount = config.sampleCount;
      const configKey = this.sampling.makeTrainingConfigKey(unitId, variableId);
      const includeDeriveError = config.includeDeriveError === true;

      this.logger.log(`Querying incomplete responses for unit ${unitId}, variable ${variableId}`);

      // Fetch all eligible responses (no DB-level limit — we need the full set to apply aggregation grouping)
      const unitResponsesQuery = this.responseRepository
        .createQueryBuilder('response')
        .leftJoinAndSelect('response.unit', 'unit')
        .leftJoinAndSelect('unit.booklet', 'booklet')
        .leftJoinAndSelect('booklet.person', 'person')
        .leftJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
        .where('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('person.consider = :consider', { consider: true })
        .andWhere(includeDeriveError ?
          new Brackets(qb => {
            qb.where('response.status_v1 IN (:...statuses)', {
              statuses: MANUAL_CODING_DEFAULT_CANDIDATE_STATUSES
            }).orWhere('response.status_v1 = :deriveErrorStatus', {
              deriveErrorStatus: DERIVE_ERROR_STATUS
            });
          }) :
          'response.status_v1 IN (:...statuses)',
        { statuses: MANUAL_CODING_DEFAULT_CANDIDATE_STATUSES })
        .andWhere('response.variableid = :variableId', { variableId })
        .andWhere('response.status_v2 IS NULL')
        .andWhere('(unit.alias = :unitId OR unit.name = :unitId)', { unitId })
        .orderBy('response.id', 'ASC');
      applyResolvedExclusionsToQuery(unitResponsesQuery, exclusions, { parameterPrefix: `trainingPackage${configKey.replace(/[^a-zA-Z0-9]/g, '')}` });
      const unitResponses = await unitResponsesQuery.getMany();

      this.logger.log(`Found ${unitResponses.length} incomplete responses for unit ${unitId}, variable ${variableId}`);

      let transformedResponses: CoderTrainingResponse[] = unitResponses.map(r => ({
        responseId: r.id,
        unitAlias: r.unit?.alias || '',
        variableId: r.variableid,
        unitName: r.unit?.name || '',
        value: r.value,
        personLogin: r.unit?.booklet?.person?.login || '',
        personCode: r.unit?.booklet?.person?.code || '',
        personGroup: r.unit?.booklet?.person?.group || '',
        bookletName: r.unit?.booklet?.bookletinfo?.name || '',
        variable: r.variableid,
        unitId: r.unitid
      }));

      if (caseSelectionMode === 'oldest_first' || caseSelectionMode === 'newest_first') {
        const unitIds = [...new Set(transformedResponses.map(r => r.unitId!).filter(Boolean))];
        if (unitIds.length > 0) {
          const chunks = await this.chunkRepository
            .createQueryBuilder('chunk')
            .where('chunk.unitid IN (:...unitIds)', { unitIds })
            .getMany();

          const chunkTsStatsByUnitAndVar = new Map<string, { min: number; max: number; hasMultiple: boolean }>();
          for (const chunk of chunks) {
            if (!chunk.variables) continue;

            const chunkTs = Number(chunk.ts) || 0;
            for (const v of chunk.variables.split(',').map(s => s.trim())) {
              const key = `${chunk.unitid}:${v}`;
              const existing = chunkTsStatsByUnitAndVar.get(key);
              if (existing) {
                if (chunkTs < existing.min) {
                  existing.min = chunkTs;
                  existing.hasMultiple = true;
                }
                if (chunkTs > existing.max) {
                  existing.max = chunkTs;
                  existing.hasMultiple = true;
                }
              } else {
                chunkTsStatsByUnitAndVar.set(key, { min: chunkTs, max: chunkTs, hasMultiple: false });
              }
            }
          }

          const multipleKeys: string[] = [];
          for (const [key, stats] of chunkTsStatsByUnitAndVar.entries()) {
            if (stats.hasMultiple) multipleKeys.push(key);
          }
          if (multipleKeys.length > 0) {
            const sample = multipleKeys.slice(0, 10).join(', ');
            this.logger.debug(`Multiple chunk.ts values detected for ${multipleKeys.length} unit/variable keys. Sample: ${sample}`);
          }

          const pickOldest = caseSelectionMode === 'oldest_first';
          transformedResponses = transformedResponses.map(r => {
            const stats = chunkTsStatsByUnitAndVar.get(`${r.unitId}:${r.variableId}`);
            let chunkTs: number | undefined;
            if (stats) {
              chunkTs = pickOldest ? stats.min : stats.max;
            }
            return {
              ...r,
              chunkTs
            };
          });
        }
      }

      const dedupedResponses = deduplicateManualCodingResponses(transformedResponses);
      if (dedupedResponses.length !== transformedResponses.length) {
        this.logger.debug(`Removed ${transformedResponses.length - dedupedResponses.length} duplicate responses for unit ${unitId}, variable ${variableId}.`);
      }
      transformedResponses = dedupedResponses;

      // Apply the same aggregation grouping used by availability analysis.
      let responsesForSampling: CoderTrainingResponse[];
      if (aggregationThreshold !== null) {
        const aggregatedGroups = buildAggregationGroups(
          transformedResponses,
          matchingFlags,
          aggregationThreshold,
          derivedVariableSets
        );
        responsesForSampling = [];
        for (const group of aggregatedGroups) {
          if (group.responses.length >= aggregationThreshold) {
            const representative = group.responses.reduce((a, b) => (
              a.responseId < b.responseId ? a : b
            ));
            responsesForSampling.push(representative);
          } else {
            responsesForSampling.push(...group.responses);
          }
        }
        this.logger.log(
          `After aggregation grouping: ${responsesForSampling.length} cases (from ${transformedResponses.length} raw responses) for unit ${unitId}, variable ${variableId}`
        );
      } else {
        responsesForSampling = transformedResponses;
      }

      responsesForSampling = this.sampling.applyReferenceFilter(
        responsesForSampling,
        referenceMode,
        referenceResponseIdsByConfig,
        configKey
      );
      responsesForSamplingByConfig.set(configKey, responsesForSampling);

      if (!bundleVariableKeys.has(configKey)) {
        const sampledResponses = this.sampling.sampleResponses(responsesForSampling, sampleCount, caseSelectionMode);
        sampledResponsesByConfig.set(configKey, sampledResponses);

        this.logger.log(`Sampled ${sampledResponses.length} consistent responses for unit ${unitId}, variable ${variableId}`);
      }
    }

    for (const bundle of bundleConfigs) {
      const sampledResponsesByBundleVariable = this.sampling.sampleBundleResponses(
        bundle,
        responsesForSamplingByConfig,
        caseSelectionMode
      );
      sampledResponsesByBundleVariable.forEach((responses, configKey) => {
        sampledResponsesByConfig.set(configKey, responses);
      });

      this.logger.log(
        `Sampled ${bundle.sampleCount} bundled cases for training bundle ${bundle.name || bundle.id}`
      );
    }

    // Create training packages for each coder using the pre-sampled responses
    const result: TrainingPackage[] = [];

    for (const coder of selectedCoders) {
      const coderId = coder.id;
      const coderName = coder.name;
      const coderResponses: CoderTrainingResponse[] = [];

      this.logger.log(`Assigning consistent training samples to coder ${coderName} (ID: ${coderId})`);

      for (const config of variableConfigs) {
        const configKey = this.sampling.makeTrainingConfigKey(
          config.unitId,
          config.variableId
        );
        const sampledResponses = sampledResponsesByConfig.get(configKey)!;
        coderResponses.push(...sampledResponses);
      }

      result.push({
        coderId,
        coderName,
        responses: coderResponses
      });

      this.logger.log(`Generated consistent training package for coder ${coderName} with ${coderResponses.length} responses`);
    }

    this.logger.log(`Completed generating consistent coder training packages. Total packages: ${result.length}`);
    return result;
  }
}
