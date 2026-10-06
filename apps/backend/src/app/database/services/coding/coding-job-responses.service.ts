import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository, EntityManager, SelectQueryBuilder, Brackets
} from 'typeorm';
import { CodingJob } from '../../entities/coding-job.entity';
import { CodingJobVariable } from '../../entities/coding-job-variable.entity';
import { CodingJobVariableBundle } from '../../entities/coding-job-variable-bundle.entity';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';
import { ResponseEntity } from '../../entities/response.entity';
import { applyResolvedExclusionsToQuery, WorkspaceExclusionService } from '../workspace/workspace-exclusion.service';
import { getAggregationVariableKey } from './aggregation-metrics.util';
import { IQB_STANDARD_MISSING_CODES, MissingsProfilesService } from './missings-profiles.service';
import { DERIVE_ERROR_STATUS, getDeriveErrorManualCodingPairKeys, MANUAL_CODING_DEFAULT_CANDIDATE_STATUSES } from '../../utils/manual-coding-candidate.util';
import { statusStringToNumber } from '../../utils/response-status-converter';
import { CodingAggregationPeerService } from './coding-aggregation-peer.service';
import { ResponseMatchingFlag, VariableReference, SlimResponse } from './coding-job.types';
import { CodingJobQueryService } from './coding-job-query.service';

@Injectable()
export class CodingJobResponsesService {
  constructor(
    @InjectRepository(CodingJob)
    private readonly codingJobRepository: Repository<CodingJob>,
    @InjectRepository(CodingJobVariable)
    private readonly codingJobVariableRepository: Repository<CodingJobVariable>,
    @InjectRepository(CodingJobVariableBundle)
    private readonly codingJobVariableBundleRepository: Repository<CodingJobVariableBundle>,
    @InjectRepository(CodingJobUnit)
    private readonly codingJobUnitRepository: Repository<CodingJobUnit>,
    @InjectRepository(ResponseEntity)
    private readonly responseRepository: Repository<ResponseEntity>,
    private readonly workspaceExclusionService: WorkspaceExclusionService,
    private readonly codingAggregationPeerService: CodingAggregationPeerService,
    private readonly query: CodingJobQueryService,
    @Optional()
    private readonly missingsProfilesService?: MissingsProfilesService
  ) {}

  async getDefaultMirCode(workspaceId: number): Promise<number> {
    if (!this.missingsProfilesService) {
      return IQB_STANDARD_MISSING_CODES.mir;
    }

    const missing =
      await this.missingsProfilesService.getMissingByIdForProfileOrDefault(
        workspaceId,
        null,
        'mir'
      );
    return missing.code;
  }

  applyManualCodingCandidateStatusFilter(
    queryBuilder: SelectQueryBuilder<ResponseEntity>,
    variables: VariableReference[] = []
  ): void {
    const deriveErrorManualCodingPairKeys =
      getDeriveErrorManualCodingPairKeys(variables);

    if (deriveErrorManualCodingPairKeys.length === 0) {
      queryBuilder.andWhere('response.status_v1 IN (:...statuses)', {
        statuses: MANUAL_CODING_DEFAULT_CANDIDATE_STATUSES
      });
      return;
    }

    queryBuilder.andWhere(
      new Brackets(qb => {
        qb.where('response.status_v1 IN (:...statuses)', {
          statuses: MANUAL_CODING_DEFAULT_CANDIDATE_STATUSES
        }).orWhere(
          `response.status_v1 = :deriveErrorStatus
          AND CONCAT(UPPER(unit.name), CHR(31), response.variableid) IN (:...deriveErrorManualCodingPairKeys)`,
          {
            deriveErrorStatus: DERIVE_ERROR_STATUS,
            deriveErrorManualCodingPairKeys
          }
        );
      })
    );
  }

  responseMatchesVariableReference(
    response: SlimResponse,
    variable: VariableReference
  ): boolean {
    if (
      getAggregationVariableKey(response.unitName, response.variableid) !==
        getAggregationVariableKey(variable.unitName, variable.variableId)
    ) {
      return false;
    }

    return (
      response.statusV1 !== DERIVE_ERROR_STATUS ||
      variable.includeDeriveError === true
    );
  }

  async getResponsesForCodingJob(
    codingJobId: number,
    manager?: EntityManager
  ): Promise<ResponseEntity[]> {
    const jobRepo = manager ?
      manager.getRepository(CodingJob) :
      this.codingJobRepository;
    const variableRepo = manager ?
      manager.getRepository(CodingJobVariable) :
      this.codingJobVariableRepository;
    const bundleRepo = manager ?
      manager.getRepository(CodingJobVariableBundle) :
      this.codingJobVariableBundleRepository;
    const responseRepo = manager ?
      manager.getRepository(ResponseEntity) :
      this.responseRepository;

    const codingJob = await jobRepo.findOne({ where: { id: codingJobId } });
    if (!codingJob) {
      return [];
    }

    const codingJobVariables = await variableRepo.find({
      where: { coding_job_id: codingJobId }
    });

    const codingJobVariableBundles = await bundleRepo.find({
      where: { coding_job_id: codingJobId },
      relations: ['variable_bundle']
    });

    const allVariables: { unit_name: string; variable_id: string }[] =
      codingJobVariables.map(v => ({
        unit_name: v.unit_name,
        variable_id: v.variable_id
      }));
    codingJobVariableBundles.forEach(bundle => {
      if (bundle.variable_bundle?.variables) {
        bundle.variable_bundle.variables.forEach(variable => {
          allVariables.push({
            unit_name: variable.unitName,
            variable_id: variable.variableId
          });
        });
      }
    });

    if (allVariables.length === 0) {
      return [];
    }

    const queryBuilder = responseRepo
      .createQueryBuilder('response')
      .leftJoinAndSelect('response.unit', 'unit')
      .leftJoinAndSelect('unit.booklet', 'booklet')
      .leftJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
      .leftJoinAndSelect('booklet.person', 'person')
      .where('person.workspace_id = :workspaceId', {
        workspaceId: codingJob.workspace_id
      })
      .andWhere('person.consider = :consider', { consider: true });

    const conditions: string[] = [];
    const parameters: Record<string, string> = {};

    allVariables.forEach((variable, index) => {
      const unitParam = `unitName${index}`;
      const variableParam = `variableId${index}`;
      conditions.push(
        `(UPPER(unit.name) = UPPER(:${unitParam}) AND response.variableid = :${variableParam})`
      );
      parameters[unitParam] = variable.unit_name;
      parameters[variableParam] = variable.variable_id;
    });

    if (conditions.length > 0) {
      queryBuilder.andWhere(`(${conditions.join(' OR ')})`, parameters);
    }

    // Exclude aggregated duplicates (marked with code_v2 = -111)
    queryBuilder.andWhere(
      '(response.code_v2 IS NULL OR response.code_v2 != -111)'
    );
    queryBuilder.andWhere(
      '(response.status_v2 IS NULL OR response.status_v2 != :completedV2Status)',
      { completedV2Status: statusStringToNumber('CODING_COMPLETE') }
    );
    const exclusions =
      await this.workspaceExclusionService.resolveExclusionsForQueries(
        codingJob.workspace_id
      );
    applyResolvedExclusionsToQuery(queryBuilder, exclusions);

    return queryBuilder.orderBy('response.id', 'ASC').getMany();
  }

  async getSlimResponsesForCodingJob(
    codingJobId: number,
    manager?: EntityManager
  ): Promise<SlimResponse[]> {
    const jobRepo = manager ?
      manager.getRepository(CodingJob) :
      this.codingJobRepository;
    const variableRepo = manager ?
      manager.getRepository(CodingJobVariable) :
      this.codingJobVariableRepository;
    const bundleRepo = manager ?
      manager.getRepository(CodingJobVariableBundle) :
      this.codingJobVariableBundleRepository;

    const codingJob = await jobRepo.findOne({ where: { id: codingJobId } });
    if (!codingJob) {
      return [];
    }
    const workspaceId = codingJob.workspace_id;

    const codingJobVariables = await variableRepo.find({
      where: { coding_job_id: codingJobId }
    });

    const codingJobVariableBundles = await bundleRepo.find({
      where: { coding_job_id: codingJobId },
      relations: ['variable_bundle']
    });

    const variableBundleMap = new Map<string, number>();
    const allVariables: { unit_name: string; variable_id: string }[] =
      codingJobVariables.map(v => ({
        unit_name: v.unit_name,
        variable_id: v.variable_id
      }));
    codingJobVariableBundles.forEach(bundle => {
      if (bundle.variable_bundle?.variables) {
        bundle.variable_bundle.variables.forEach(variable => {
          allVariables.push({
            unit_name: variable.unitName,
            variable_id: variable.variableId
          });
          variableBundleMap.set(
            getAggregationVariableKey(variable.unitName, variable.variableId),
            bundle.variable_bundle_id
          );
        });
      }
    });

    if (allVariables.length === 0) {
      return [];
    }

    const responseRepo = manager ?
      manager.getRepository(ResponseEntity) :
      this.responseRepository;
    const queryBuilder = responseRepo
      .createQueryBuilder('response')
      .select('response.id', 'id')
      .addSelect('response.variableid', 'variableid')
      .addSelect('response.value', 'value')
      .addSelect('response.status_v1', 'statusV1')
      .addSelect('unit.name', 'unitName')
      .addSelect('unit.alias', 'unitAlias')
      .addSelect("COALESCE(bookletinfo.name, '')", 'bookletName')
      .addSelect("COALESCE(person.login, '')", 'personLogin')
      .addSelect("COALESCE(person.code, '')", 'personCode')
      .addSelect("COALESCE(person.group, '')", 'personGroup')
      .innerJoin('response.unit', 'unit')
      .innerJoin('unit.booklet', 'booklet')
      .leftJoin('booklet.bookletinfo', 'bookletinfo')
      .innerJoin('booklet.person', 'person')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true });
    this.applyManualCodingCandidateStatusFilter(queryBuilder);

    const conditions: string[] = [];
    const parameters: Record<string, string> = {};

    allVariables.forEach((variable, index) => {
      const unitParam = `cjUnitName${index}`;
      const variableParam = `cjVariableId${index}`;
      conditions.push(
        `(UPPER(unit.name) = UPPER(:${unitParam}) AND response.variableid = :${variableParam})`
      );
      parameters[unitParam] = variable.unit_name;
      parameters[variableParam] = variable.variable_id;
    });

    queryBuilder.andWhere(`(${conditions.join(' OR ')})`, parameters);
    queryBuilder.andWhere(
      '(response.code_v2 IS NULL OR (response.code_v2 != :aggregatedCode AND response.code_v2 != :defaultMirCode))',
      {
        aggregatedCode: -111,
        defaultMirCode: await this.getDefaultMirCode(workspaceId)
      }
    );
    queryBuilder.andWhere(
      '(response.status_v2 IS NULL OR response.status_v2 != :completedV2Status)',
      { completedV2Status: statusStringToNumber('CODING_COMPLETE') }
    );
    const exclusions =
      await this.workspaceExclusionService.resolveExclusionsForQueries(
        workspaceId
      );
    applyResolvedExclusionsToQuery(queryBuilder, exclusions);

    const raw = await queryBuilder.orderBy('response.id', 'ASC').getRawMany();

    return raw.map(r => {
      const unitName = r.unitName ?? '';
      const variableid = r.variableid;
      return {
        id: Number(r.id),
        variableid: variableid,
        value: r.value ?? null,
        statusV1:
          r.statusV1 !== undefined && r.statusV1 !== null ?
            Number(r.statusV1) :
            null,
        unitName: unitName,
        unitAlias: r.unitAlias ?? null,
        bookletName: r.bookletName ?? '',
        personLogin: r.personLogin ?? '',
        personCode: r.personCode ?? '',
        personGroup: r.personGroup ?? '',
        variableBundleId: variableBundleMap.get(
          getAggregationVariableKey(unitName, variableid)
        )
      };
    });
  }

  async getResponsesForVariables(
    workspaceId: number,
    variables: VariableReference[]
  ): Promise<ResponseEntity[]> {
    if (variables.length === 0) {
      return [];
    }

    const queryBuilder = this.responseRepository
      .createQueryBuilder('response')
      .leftJoinAndSelect('response.unit', 'unit')
      .leftJoinAndSelect('unit.booklet', 'booklet')
      .leftJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
      .leftJoinAndSelect('booklet.person', 'person')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      .andWhere('(response.code_v2 IS NULL OR response.code_v2 != -111)')
      .andWhere('(response.status_v2 IS NULL OR response.status_v2 != :completedV2Status)', {
        completedV2Status: statusStringToNumber('CODING_COMPLETE')
      });
    this.applyManualCodingCandidateStatusFilter(queryBuilder, variables);
    const exclusions =
      await this.workspaceExclusionService.resolveExclusionsForQueries(
        workspaceId
      );
    applyResolvedExclusionsToQuery(queryBuilder, exclusions);

    const conditions: string[] = [];
    const parameters: Record<string, string> = {};

    variables.forEach((variable, index) => {
      const unitParam = `unitName${index}`;
      const variableParam = `variableId${index}`;
      conditions.push(
        `(UPPER(unit.name) = UPPER(:${unitParam}) AND response.variableid = :${variableParam})`
      );
      parameters[unitParam] = variable.unitName;
      parameters[variableParam] = variable.variableId;
    });

    if (conditions.length > 0) {
      queryBuilder.andWhere(`(${conditions.join(' OR ')})`, parameters);
    }

    return queryBuilder.orderBy('response.id', 'ASC').getMany();
  }

  async getSlimResponsesForVariables(
    workspaceId: number,
    variables: VariableReference[],
    manager?: EntityManager
  ): Promise<SlimResponse[]> {
    if (variables.length === 0) {
      return [];
    }

    const repository = manager ?
      manager.getRepository(ResponseEntity) :
      this.responseRepository;
    const queryBuilder = repository
      .createQueryBuilder('response')
      .select('response.id', 'id')
      .addSelect('response.variableid', 'variableid')
      .addSelect('response.value', 'value')
      .addSelect('response.status_v1', 'statusV1')
      .addSelect('response.status_v2', 'statusV2')
      .addSelect('unit.name', 'unitName')
      .addSelect('unit.alias', 'unitAlias')
      .addSelect("COALESCE(bookletinfo.name, '')", 'bookletName')
      .addSelect("COALESCE(person.login, '')", 'personLogin')
      .addSelect("COALESCE(person.code, '')", 'personCode')
      .addSelect("COALESCE(person.group, '')", 'personGroup')
      .innerJoin('response.unit', 'unit')
      .innerJoin('unit.booklet', 'booklet')
      .leftJoin('booklet.bookletinfo', 'bookletinfo')
      .innerJoin('booklet.person', 'person')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      .andWhere(
        '(response.code_v2 IS NULL OR (response.code_v2 != :aggregatedCode AND response.code_v2 != :defaultMirCode))',
        {
          aggregatedCode: -111,
          defaultMirCode: await this.getDefaultMirCode(workspaceId)
        }
      )
      .andWhere('(response.status_v2 IS NULL OR response.status_v2 != :completedV2Status)', {
        completedV2Status: statusStringToNumber('CODING_COMPLETE')
      });
    this.applyManualCodingCandidateStatusFilter(queryBuilder, variables);
    const exclusions =
      await this.workspaceExclusionService.resolveExclusionsForQueries(
        workspaceId
      );
    applyResolvedExclusionsToQuery(queryBuilder, exclusions);

    const conditions: string[] = [];
    const parameters: Record<string, string> = {};

    variables.forEach((variable, index) => {
      const unitParam = `slimUnitName${index}`;
      const variableParam = `slimVariableId${index}`;
      conditions.push(
        `(UPPER(unit.name) = UPPER(:${unitParam}) AND response.variableid = :${variableParam})`
      );
      parameters[unitParam] = variable.unitName;
      parameters[variableParam] = variable.variableId;
    });

    if (conditions.length > 0) {
      queryBuilder.andWhere(`(${conditions.join(' OR ')})`, parameters);
    }

    const raw = await queryBuilder.orderBy('response.id', 'ASC').getRawMany();

    return raw.map(r => ({
      id: Number(r.id),
      variableid: r.variableid,
      value: r.value ?? null,
      statusV1:
        r.statusV1 !== undefined && r.statusV1 !== null ?
          Number(r.statusV1) :
          null,
      statusV2:
        r.statusV2 !== undefined && r.statusV2 !== null ?
          Number(r.statusV2) :
          null,
      unitName: r.unitName ?? '',
      unitAlias: r.unitAlias ?? null,
      bookletName: r.bookletName ?? '',
      personLogin: r.personLogin ?? '',
      personCode: r.personCode ?? '',
      personGroup: r.personGroup ?? ''
    }));
  }

  async getSlimResponsesForVariableCoverage(
    workspaceId: number,
    variables: VariableReference[],
    matchingFlags: ResponseMatchingFlag[],
    aggregationThreshold: number | null,
    derivedVariableMap: Map<string, Set<string>>,
    manager?: EntityManager
  ): Promise<SlimResponse[]> {
    const activeResponses = await this.getSlimResponsesForVariables(
      workspaceId,
      variables,
      manager
    );
    const aggregationActive = aggregationThreshold !== null &&
      !matchingFlags.includes(ResponseMatchingFlag.NO_AGGREGATION);

    if (!aggregationActive || activeResponses.length === 0) {
      return activeResponses;
    }

    const completedPeers = await this.codingAggregationPeerService
      .findCompletedPeers({
        workspaceId,
        sourceResponses: activeResponses.map(response => ({
          responseId: response.id,
          unitName: response.unitName,
          variableId: response.variableid,
          value: response.value
        })),
        matchingFlags,
        derivedVariableMap,
        variables,
        manager,
        loadQueryContext: async () => {
          const [defaultMirCode, exclusions] = await Promise.all([
            this.getDefaultMirCode(workspaceId),
            this.workspaceExclusionService.resolveExclusionsForQueries(
              workspaceId
            )
          ]);
          return { defaultMirCode, exclusions };
        }
      });

    return [
      ...activeResponses,
      ...completedPeers.map(response => ({
        id: response.responseId,
        variableid: response.variableId,
        value: response.value,
        statusV1: response.statusV1,
        statusV2: response.statusV2,
        unitName: response.unitName,
        unitAlias: response.unitAlias,
        bookletName: response.bookletName,
        personLogin: response.personLogin,
        personCode: response.personCode,
        personGroup: response.personGroup
      }))
    ];
  }

  async getAssignedResponseIdsForVariables(
    workspaceId: number,
    variables: VariableReference[],
    excludeJobDefinitionId?: number,
    manager?: EntityManager
  ): Promise<Set<number>> {
    if (variables.length === 0) {
      return new Set();
    }

    const repository = manager ?
      manager.getRepository(CodingJobUnit) :
      this.codingJobUnitRepository;
    const query = repository
      .createQueryBuilder('cju')
      .select('DISTINCT cju.response_id', 'responseId')
      .leftJoin('cju.coding_job', 'coding_job')
      .where('coding_job.workspace_id = :workspaceId', { workspaceId })
      .andWhere('coding_job.training_id IS NULL');
    this.query.applyNonCodingIssueReviewJobFilter(
      query,
      'coding_job',
      'assignedResponseIdsReviewJobType'
    );

    if (
      excludeJobDefinitionId !== undefined &&
      excludeJobDefinitionId !== null
    ) {
      query.andWhere(
        '(coding_job.job_definition_id IS NULL OR coding_job.job_definition_id != :excludeJobDefinitionId)',
        { excludeJobDefinitionId }
      );
    }

    const conditions: string[] = [];
    const parameters: Record<string, string> = {};

    variables.forEach((variable, index) => {
      const unitParam = `assignedUnitName${index}`;
      const variableParam = `assignedVariableId${index}`;
      conditions.push(
        `(UPPER(cju.unit_name) = UPPER(:${unitParam}) AND cju.variable_id = :${variableParam})`
      );
      parameters[unitParam] = variable.unitName;
      parameters[variableParam] = variable.variableId;
    });

    query.andWhere(`(${conditions.join(' OR ')})`, parameters);
    await this.query.applyCodingJobUnitExclusions(
      query,
      workspaceId,
      'assignedResponseIdsForVariables'
    );

    const rawResults = await query.getRawMany();
    return new Set(
      rawResults
        .map(row => Number(row.responseId))
        .filter(responseId => Number.isFinite(responseId))
    );
  }
}
