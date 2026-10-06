import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, Not } from 'typeorm';
import { SaveCodingProgressDto } from '../../../admin/coding-job/dto/save-coding-progress.dto';
import { sortUnitsContinuous, sortUnitsAlternating, getLatestCode } from '../../../utils/coding-utils';
import { CodingJob } from '../../entities/coding-job.entity';
import { CodingJobVariableBundle } from '../../entities/coding-job-variable-bundle.entity';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';
import { VariableBundle } from '../../entities/variable-bundle.entity';
import { ResponseEntity } from '../../entities/response.entity';
import { isExcludedByResolvedExclusions, WorkspaceExclusionService } from '../workspace/workspace-exclusion.service';
import { getAggregationVariableKey } from './aggregation-metrics.util';
import { ReplayCodingProgressEntryDto, ReplayCodingSessionDto, ReplayCodingSessionUnitDto } from '../../../../../../../api-dto/coding/replay-coding-session.dto';
import {
  CodingJobBundleVariableStatus, CodingJobBundleContext, CodingJobBundleTarget, CodingJobNavigationUnit
} from './coding-job.types';
import { CodingJobQueryService } from './coding-job-query.service';
import { CodingJobSchemeService } from './coding-job-scheme.service';

@Injectable()
export class CodingJobReplayService {
  constructor(
    @InjectRepository(CodingJob)
    private readonly codingJobRepository: Repository<CodingJob>,
    @InjectRepository(CodingJobVariableBundle)
    private readonly codingJobVariableBundleRepository: Repository<CodingJobVariableBundle>,
    @InjectRepository(CodingJobUnit)
    private readonly codingJobUnitRepository: Repository<CodingJobUnit>,
    @InjectRepository(VariableBundle)
    private readonly variableBundleRepository: Repository<VariableBundle>,
    @InjectRepository(ResponseEntity)
    private readonly responseRepository: Repository<ResponseEntity>,
    private readonly workspaceExclusionService: WorkspaceExclusionService,
    private readonly query: CodingJobQueryService,
    private readonly scheme: CodingJobSchemeService
  ) {}

  async getCodingProgress(
    codingJobId: number
  ): Promise<Record<string, SaveCodingProgressDto['selectedCode']>> {
    const codingJob = await this.codingJobRepository.findOne({
      where: { id: codingJobId }
    });

    if (!codingJob) {
      throw new NotFoundException(
        `Coding job with ID ${codingJobId} not found`
      );
    }

    const codingJobUnits = await this.query.getEffectiveVisibleCodingJobUnits(
      codingJob
    );

    return this.buildCodingProgress(codingJobUnits, codingJob.workspace_id);
  }

  async buildCodingProgress(
    codingJobUnits: CodingJobUnit[],
    workspaceId: number
  ): Promise<Record<string, ReplayCodingProgressEntryDto>> {
    const codedUnits = codingJobUnits.filter(
      unit => unit.code !== null && unit.code >= 0
    );
    const codingSchemesByUnit = await this.scheme.getCodingSchemesForUnits(
      codedUnits,
      workspaceId
    );

    const progressMap: Record<string, ReplayCodingProgressEntryDto> = {};

    const setProgressEntry = (unit: CodingJobUnit, compositeKey: string) => {
      const progressCode = unit.code ?? unit.coding_issue_option;
      if (progressCode === null) {
        return;
      }

      const codingScheme = progressCode >= 0 ?
        codingSchemesByUnit.get(unit) :
        undefined;
      let code: string | undefined;
      let label: string | undefined;

      if (codingScheme) {
        const variableCoding = this.scheme.findVariableCoding(
          codingScheme,
          unit.variable_id
        );
        if (variableCoding?.codes) {
          const codeEntry = variableCoding.codes.find(
            c => Number(c.id) === progressCode
          );
          if (codeEntry) {
            code = codeEntry.code;
            label = codeEntry.label;
          }
        }
      }

      progressMap[compositeKey] = {
        id: progressCode,
        code,
        label
      };

      if (unit.score !== null) {
        progressMap[compositeKey].score = unit.score;
      }

      if (unit.coding_issue_option !== null) {
        progressMap[compositeKey].codingIssueOption =
          unit.coding_issue_option;
      }
    };

    codingJobUnits.forEach(unit => {
      const compositeKey = this.query.getCodingJobUnitProgressKey(unit);

      if (unit.is_open) {
        progressMap[`${compositeKey}:open`] = {
          id: -1,
          code: '',
          label: 'OPEN'
        };
        if (this.query.codingJobUnitRequiresIssueReview(unit)) {
          setProgressEntry(unit, compositeKey);
        }
      } else if (unit.code !== null) {
        setProgressEntry(unit, compositeKey);
      }
    });

    return progressMap;
  }

  async getCodingNotes(codingJobId: number): Promise<Record<string, string>> {
    const codingJob = await this.codingJobRepository.findOne({
      where: { id: codingJobId }
    });

    if (!codingJob) {
      throw new NotFoundException(
        `Coding job with ID ${codingJobId} not found`
      );
    }

    const codingJobUnits = await this.query.getEffectiveVisibleCodingJobUnits(
      codingJob
    );

    return this.buildCodingNotes(codingJobUnits);
  }

  buildCodingNotes(
    codingJobUnits: CodingJobUnit[]
  ): Record<string, string> {
    const notesMap: Record<string, string> = {};

    codingJobUnits.forEach(unit => {
      if (unit.notes) {
        const compositeKey = this.query.getCodingJobUnitProgressKey(unit);
        notesMap[compositeKey] = unit.notes;
      }
    });

    return notesMap;
  }

  async getCodingJobUnits(
    codingJobId: number,
    onlyOpen: boolean = false
  ): Promise<CodingJobNavigationUnit[]> {
    const codingJob = await this.codingJobRepository.findOne({
      where: { id: codingJobId },
      relations: ['codingJobCoders', 'codingJobCoders.user']
    });
    if (!codingJob) {
      return [];
    }

    const bundles = await this.codingJobVariableBundleRepository.find({
      where: { coding_job_id: codingJobId },
      order: { id: 'ASC' }
    });

    const codingJobUnitSelect: (keyof CodingJobUnit)[] = [
      'response_id',
      'unit_name',
      'unit_alias',
      'variable_id',
      'variable_anchor',
      'booklet_name',
      'person_login',
      'person_code',
      'person_group',
      'notes',
      'variable_bundle_id',
      'code',
      'score',
      'is_open'
    ];

    const codingJobUnits = await this.codingJobUnitRepository.find({
      where: { coding_job_id: codingJobId },
      select: codingJobUnitSelect
    });
    const exclusions =
      await this.workspaceExclusionService.resolveExclusionsForQueries(
        codingJob.workspace_id
      );
    const visibleCodingJobUnits = codingJobUnits.filter(
      unit => !isExcludedByResolvedExclusions(
        exclusions,
        unit.booklet_name,
        unit.unit_name
      )
    );

    return this.buildCodingJobNavigationUnits(
      codingJob,
      bundles,
      visibleCodingJobUnits,
      onlyOpen,
      true
    );
  }

  async getCodingJobReplaySession(
    codingJobId: number,
    workspaceId: number,
    onlyOpen: boolean = false
  ): Promise<ReplayCodingSessionDto> {
    const startedAt = Date.now();
    const codingJob = await this.codingJobRepository.findOne({
      where: { id: codingJobId, workspace_id: workspaceId }
    });
    const jobLoadedAt = Date.now();

    if (!codingJob) {
      throw new NotFoundException(
        `Coding job with ID ${codingJobId} not found`
      );
    }

    const [bundles, codingJobUnits, exclusions] = await Promise.all([
      this.codingJobVariableBundleRepository.find({
        where: { coding_job_id: codingJobId },
        order: { id: 'ASC' }
      }),
      this.codingJobUnitRepository.find({
        where: { coding_job_id: codingJobId }
      }),
      this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId)
    ]);
    const contextLoadedAt = Date.now();
    const visibleCodingJobUnits = codingJobUnits.filter(
      unit => !isExcludedByResolvedExclusions(
        exclusions,
        unit.booklet_name,
        unit.unit_name
      )
    );
    const effectiveCodingJobUnits =
      await this.query.applyCodingIssueReviewOverlays(
        codingJob,
        visibleCodingJobUnits
      );
    const reviewOverlaysAppliedAt = Date.now();

    const navigationUnits = await this.buildCodingJobNavigationUnits(
      codingJob,
      bundles,
      visibleCodingJobUnits,
      onlyOpen,
      false
    );
    const units: ReplayCodingSessionUnitDto[] = navigationUnits.map(unit => ({
      responseId: unit.responseId,
      unitName: unit.unitName,
      unitAlias: unit.unitAlias,
      variableId: unit.variableId,
      variableAnchor: unit.variableAnchor,
      variablePage: unit.variablePage,
      bookletName: unit.bookletName,
      personLogin: unit.personLogin,
      personCode: unit.personCode,
      personGroup: unit.personGroup,
      variableBundleId: unit.variableBundleId,
      bundleContext: unit.bundleContext
    }));
    const unitsBuiltAt = Date.now();
    const progress = await this.buildCodingProgress(
      effectiveCodingJobUnits,
      workspaceId
    );
    const progressBuiltAt = Date.now();
    const notes = this.buildCodingNotes(effectiveCodingJobUnits);
    const notesBuiltAt = Date.now();
    const job = {
      status: codingJob.status,
      comment: codingJob.comment ?? null,
      showScore: codingJob.showScore,
      allowComments: codingJob.allowComments,
      suppressGeneralInstructions: codingJob.suppressGeneralInstructions
    };
    const responsePreparedAt = Date.now();

    return {
      units,
      progress,
      notes,
      job,
      serverTimings: {
        loadJobMs: jobLoadedAt - startedAt,
        loadContextMs: contextLoadedAt - jobLoadedAt,
        reviewOverlaysMs: reviewOverlaysAppliedAt - contextLoadedAt,
        buildUnitsMs: unitsBuiltAt - reviewOverlaysAppliedAt,
        buildProgressMs: progressBuiltAt - unitsBuiltAt,
        buildNotesMs: notesBuiltAt - progressBuiltAt,
        finalizeResponseMs: responsePreparedAt - notesBuiltAt,
        totalMs: responsePreparedAt - startedAt
      }
    };
  }

  async buildCodingJobNavigationUnits(
    codingJob: CodingJob,
    bundles: CodingJobVariableBundle[],
    visibleCodingJobUnitsForContext: CodingJobUnit[],
    onlyOpen: boolean,
    includePeerCoders: boolean
  ): Promise<CodingJobNavigationUnit[]> {
    const globalMode = codingJob.case_ordering_mode || 'continuous';
    const bundleModes = new Map<number, string>();
    for (const bundle of bundles) {
      bundleModes.set(
        bundle.variable_bundle_id,
        bundle.case_ordering_mode || globalMode
      );
    }
    const visibleCodingJobUnits = onlyOpen ?
      visibleCodingJobUnitsForContext.filter(unit => unit.is_open) :
      visibleCodingJobUnitsForContext;

    // Detect double coding and other coders in the same logical coding scope.
    const responseIds = visibleCodingJobUnits.map(unit => unit.response_id);
    const otherCodersMap = new Map<number, Set<string>>();
    const currentCoderIds = new Set(
      (codingJob.codingJobCoders || []).map(cjc => cjc.user_id)
    );

    if (includePeerCoders && responseIds.length > 0) {
      const otherUnits = await this.codingJobUnitRepository.find({
        where: {
          response_id: In(responseIds),
          coding_job_id: Not(codingJob.id)
        },
        relations: [
          'coding_job',
          'coding_job.codingJobCoders',
          'coding_job.codingJobCoders.user'
        ]
      });

      otherUnits.forEach(unit => {
        const otherJob = unit.coding_job;
        if (
          !otherJob ||
          otherJob.workspace_id !== codingJob.workspace_id ||
          !this.isComparableDoubleCodingScope(codingJob, otherJob)
        ) {
          return;
        }

        if (!otherCodersMap.has(unit.response_id)) {
          otherCodersMap.set(unit.response_id, new Set<string>());
        }
        const coderSet = otherCodersMap.get(unit.response_id)!;
        otherJob.codingJobCoders?.forEach(cjc => {
          if (currentCoderIds.has(cjc.user_id)) {
            return;
          }
          if (cjc.user) {
            coderSet.add(cjc.user.username || `Coder ${cjc.user_id}`);
          }
        });
      });
    }

    const buckets = new Map<number | 'unbundled', CodingJobUnit[]>();
    for (const b of bundles) {
      buckets.set(b.variable_bundle_id, []);
    }
    buckets.set('unbundled', []);

    for (const unit of visibleCodingJobUnits) {
      const key = unit.variable_bundle_id || 'unbundled';
      if (!buckets.has(key)) {
        buckets.set(key, []);
      }
      buckets.get(key)!.push(unit);
    }

    let sortedUnits: CodingJobUnit[] = [];
    for (const [key, units] of buckets.entries()) {
      const mode =
        key === 'unbundled' ?
          globalMode :
          bundleModes.get(key as number) || globalMode;
      units.sort(
        mode === 'alternating' ? sortUnitsAlternating : sortUnitsContinuous
      );
      sortedUnits = sortedUnits.concat(units);
    }

    const variablePageMaps = await this.scheme.getVariablePageMapsForUnits(
      visibleCodingJobUnitsForContext,
      codingJob.workspace_id
    );
    const variableAnchorMaps = await this.scheme.getVariableAnchorMapsForUnits(
      visibleCodingJobUnitsForContext,
      codingJob.workspace_id
    );
    const bundleContextByResponseId =
      await this.getCodingJobBundleContextsForUnits(
        sortedUnits,
        bundles,
        bundleModes,
        globalMode,
        variablePageMaps,
        variableAnchorMaps,
        codingJob.workspace_id,
        visibleCodingJobUnitsForContext
      );

    return sortedUnits.map(unit => {
      const otherCoders = Array.from(
        otherCodersMap.get(unit.response_id) || []
      );
      const variablePage =
        variablePageMaps.get(unit.unit_name)?.get(unit.variable_id) || '0';
      const variableAnchor =
        variableAnchorMaps.get(unit.unit_name)?.get(unit.variable_id) ||
        unit.variable_anchor;
      return {
        responseId: unit.response_id,
        unitName: unit.unit_name,
        unitAlias: unit.unit_alias,
        variableId: unit.variable_id,
        variableAnchor,
        variablePage,
        bookletName: unit.booklet_name,
        personLogin: unit.person_login,
        personCode: unit.person_code,
        personGroup: unit.person_group,
        notes: unit.notes,
        variableBundleId: unit.variable_bundle_id,
        bundleContext: bundleContextByResponseId.get(unit.response_id) || null,
        isDoubleCoded: otherCoders.length > 0,
        otherCoders: otherCoders
      };
    });
  }

  getCodingJobBundleUnitCaseKey(
    unit: Pick<
    CodingJobUnit,
    | 'person_login'
    | 'person_code'
    | 'person_group'
    | 'booklet_name'
    >
  ): string {
    return [
      unit.person_login,
      unit.person_code,
      unit.person_group,
      unit.booklet_name
    ].join('\u0000');
  }

  getCodingJobBundleResponseCaseKey(
    response: ResponseEntity
  ): string {
    return [
      response.unit?.booklet?.person?.login || '',
      response.unit?.booklet?.person?.code || '',
      response.unit?.booklet?.person?.group || '',
      response.unit?.booklet?.bookletinfo?.name || ''
    ].join('\u0000');
  }

  getCodingJobBundleTargets(
    bundledUnits: CodingJobUnit[],
    variableBundleById: Map<number, VariableBundle>
  ): CodingJobBundleTarget[] {
    const targets = new Map<string, CodingJobBundleTarget>();
    const processedBundleCases = new Set<string>();

    bundledUnits.forEach(unit => {
      const bundleId = unit.variable_bundle_id;
      if (bundleId === null) {
        return;
      }

      const variableBundle = variableBundleById.get(bundleId);
      if (!variableBundle) {
        return;
      }

      const caseKey = this.getCodingJobBundleUnitCaseKey(unit);
      const bundleCaseKey = `${caseKey}\u0000${bundleId}`;
      if (processedBundleCases.has(bundleCaseKey)) {
        return;
      }
      processedBundleCases.add(bundleCaseKey);

      const [login, code, personGroup, bookletName] = caseKey.split('\u0000');
      (variableBundle.variables || []).forEach(variable => {
        const variableKey = getAggregationVariableKey(
          variable.unitName,
          variable.variableId
        );
        targets.set(`${caseKey}\u0000${variableKey}`, {
          login,
          code,
          person_group: personGroup,
          booklet_name: bookletName,
          unit_name: variable.unitName.toUpperCase(),
          variable_id: variable.variableId
        });
      });
    });

    return Array.from(targets.values());
  }

  getCodingJobBundleVariableStatus(
    response: ResponseEntity | undefined,
    manualUnit: CodingJobUnit | undefined
  ): {
      status: CodingJobBundleVariableStatus;
      code: number | null;
      score: number | null;
      source: 'manual' | 'auto' | 'none';
    } {
    const latestCode = response ? getLatestCode(response) : null;
    const hasManualCode =
      manualUnit?.code !== null &&
      manualUnit?.code !== undefined;

    // Keep an actual manual decision authoritative. If the job unit has no
    // decision, a response result written after job creation (for example by
    // empty-response coding) must still be shown as automatically coded.
    if (manualUnit && hasManualCode) {
      return {
        status: 'manual-coded',
        code: manualUnit.code ?? null,
        score: manualUnit.score ?? null,
        source: 'manual'
      };
    }

    if (
      response &&
      (response.is_autocoder_generated === true || latestCode?.code !== null)
    ) {
      return {
        status: 'auto-coded',
        code: latestCode?.code ?? null,
        score: latestCode?.score ?? null,
        source: 'auto'
      };
    }

    if (manualUnit) {
      return {
        status: manualUnit.is_open === false ?
          'manual-coded' :
          'manual-open',
        code: manualUnit.code ?? null,
        score: manualUnit.score ?? null,
        source: 'manual'
      };
    }

    if (!response) {
      return {
        status: 'not-available',
        code: null,
        score: null,
        source: 'none'
      };
    }

    if (response.status_v1 !== null) {
      return {
        status: 'not-coded',
        code: null,
        score: null,
        source: 'none'
      };
    }

    return {
      status: 'not-coded',
      code: null,
      score: null,
      source: 'none'
    };
  }

  async getCodingJobBundleContextsForUnits(
    units: CodingJobUnit[],
    codingJobBundles: CodingJobVariableBundle[],
    bundleModes: Map<number, string>,
    globalMode: string,
    variablePageMaps: Map<string, Map<string, string>>,
    variableAnchorMaps: Map<string, Map<string, string>>,
    workspaceId: number,
    contextUnits: CodingJobUnit[] = units
  ): Promise<Map<number, CodingJobBundleContext>> {
    const bundledUnits = units.filter(
      unit => unit.variable_bundle_id !== null
    );
    if (bundledUnits.length === 0) {
      return new Map();
    }

    const bundleIds = Array.from(
      new Set(
        bundledUnits
          .map(unit => unit.variable_bundle_id)
          .filter((bundleId): bundleId is number => bundleId !== null)
      )
    );
    const variableBundles = await this.variableBundleRepository.find({
      where: {
        id: In(bundleIds),
        workspace_id: workspaceId
      }
    });
    const variableBundleById = new Map(
      variableBundles.map(bundle => [bundle.id, bundle])
    );
    const caseKeys = new Set(
      bundledUnits.map(unit => this.getCodingJobBundleUnitCaseKey(unit))
    );
    const contextBundledUnits = contextUnits.filter(
      unit => unit.variable_bundle_id !== null &&
        caseKeys.has(this.getCodingJobBundleUnitCaseKey(unit))
    );
    const bundleTargets = this.getCodingJobBundleTargets(
      bundledUnits,
      variableBundleById
    );
    if (bundleTargets.length === 0) {
      return new Map();
    }
    const manualUnitByResponseId = new Map(
      contextBundledUnits.map(unit => [unit.response_id, unit])
    );
    const responses = await this.responseRepository
      .createQueryBuilder('response')
      .leftJoinAndSelect('response.unit', 'unit')
      .leftJoinAndSelect('unit.booklet', 'booklet')
      .leftJoinAndSelect('booklet.person', 'person')
      .leftJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere(`
        (
          person.login,
          person.code,
          COALESCE(person.group, ''),
          COALESCE(bookletinfo.name, ''),
          UPPER(unit.name),
          response.variableid
        ) IN (
          SELECT
            bundle_target.login,
            bundle_target.code,
            bundle_target.person_group,
            bundle_target.booklet_name,
            bundle_target.unit_name,
            bundle_target.variable_id
          FROM jsonb_to_recordset(CAST(:bundleTargets AS jsonb)) AS bundle_target(
            login text,
            code text,
            person_group text,
            booklet_name text,
            unit_name text,
            variable_id text
          )
        )
      `, {
        bundleTargets: JSON.stringify(bundleTargets)
      })
      .getMany();

    const responseByCaseAndVariable = new Map<string, ResponseEntity>();
    responses.forEach(response => {
      const caseKey = this.getCodingJobBundleResponseCaseKey(response);
      if (!caseKeys.has(caseKey)) {
        return;
      }

      const responseKey = `${caseKey}\u0000${getAggregationVariableKey(
        response.unit?.name || '',
        response.variableid
      )}`;
      const existing = responseByCaseAndVariable.get(responseKey);
      const responseIsManual = manualUnitByResponseId.has(response.id);
      const existingIsManual = existing ?
        manualUnitByResponseId.has(existing.id) :
        false;
      if (
        !existing ||
        (responseIsManual && !existingIsManual) ||
        (responseIsManual === existingIsManual && response.id < existing.id)
      ) {
        responseByCaseAndVariable.set(responseKey, response);
      }
    });

    const bundleContextByResponseId = new Map<number, CodingJobBundleContext>();
    const configuredBundleIds = new Set(
      codingJobBundles.map(bundle => bundle.variable_bundle_id)
    );

    bundledUnits.forEach(unit => {
      const bundleId = unit.variable_bundle_id;
      if (bundleId === null || !configuredBundleIds.has(bundleId)) {
        return;
      }

      const variableBundle = variableBundleById.get(bundleId);
      if (!variableBundle) {
        return;
      }

      const caseKey = this.getCodingJobBundleUnitCaseKey(unit);
      const contextVariables = (variableBundle.variables || [])
        .map(variable => {
          const response = responseByCaseAndVariable.get(
            `${caseKey}\u0000${getAggregationVariableKey(
              variable.unitName,
              variable.variableId
            )}`
          );
          const manualUnit = response ?
            manualUnitByResponseId.get(response.id) :
            undefined;
          const resolvedUnitName = response?.unit?.name || variable.unitName;
          const status = this.getCodingJobBundleVariableStatus(
            response,
            manualUnit
          );

          return {
            responseId: response?.id ?? null,
            unitName: resolvedUnitName,
            variableId: variable.variableId,
            variableAnchor:
              variableAnchorMaps.get(resolvedUnitName)?.get(variable.variableId) ||
              variable.variableId,
            variablePage:
              variablePageMaps.get(resolvedUnitName)?.get(variable.variableId) ||
              '0',
            ...status
          };
        });

      bundleContextByResponseId.set(unit.response_id, {
        bundleId,
        bundleName: variableBundle.name,
        caseKey,
        caseOrderingMode:
          (bundleModes.get(bundleId) || globalMode) === 'alternating' ?
            'alternating' :
            'continuous',
        variables: contextVariables
      });
    });

    return bundleContextByResponseId;
  }

  isComparableDoubleCodingScope(
    currentJob: CodingJob,
    otherJob: CodingJob
  ): boolean {
    if (currentJob.training_id || otherJob.training_id) {
      return currentJob.training_id === otherJob.training_id;
    }

    if (currentJob.job_definition_id || otherJob.job_definition_id) {
      return currentJob.job_definition_id === otherJob.job_definition_id;
    }

    return true;
  }

  async getBulkCodingProgress(
    codingJobIds: number[],
    workspaceId: number
  ): Promise<
    Record<number, Record<string, SaveCodingProgressDto['selectedCode']>>
    > {
    if (codingJobIds.length === 0) {
      return {};
    }

    const codingJobs = await this.codingJobRepository.find({
      where: { id: In(codingJobIds), workspace_id: workspaceId },
      select: ['id', 'workspace_id']
    });

    if (codingJobs.length !== codingJobIds.length) {
      throw new NotFoundException(
        'One or more coding jobs not found in the workspace'
      );
    }

    const progressMap: Record<
    number,
    Record<string, SaveCodingProgressDto['selectedCode']>
    > = {};

    await Promise.all(
      codingJobs.map(async job => {
        progressMap[job.id] = await this.getCodingProgress(job.id);
      })
    );

    return progressMap;
  }
}
