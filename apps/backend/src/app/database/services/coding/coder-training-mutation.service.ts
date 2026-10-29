import {
  BadRequestException, ForbiddenException, Injectable, Logger
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  In, IsNull, Not,
  Repository
} from 'typeorm';
import { getErrorMessage, getErrorStack } from '../../../utils/error.util';
import { CoderTrainingBundle } from '../../entities/coder-training-bundle.entity';
import { CoderTrainingCoder } from '../../entities/coder-training-coder.entity';
import { CoderTrainingDiscussionResult } from '../../entities/coder-training-discussion-result.entity';
import { CoderTrainingVariable } from '../../entities/coder-training-variable.entity';
import type { CaseSelectionMode, ReferenceMode } from '../../entities/coder-training.entity';
import { CoderTraining } from '../../entities/coder-training.entity';
import { CodingJobCoder } from '../../entities/coding-job-coder.entity';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';
import { CodingJobVariableBundle } from '../../entities/coding-job-variable-bundle.entity';
import { CodingJobVariable } from '../../entities/coding-job-variable.entity';
import { CodingJob } from '../../entities/coding-job.entity';
import { JobDefinitionVariable, JobDefinitionVariableBundle } from '../../entities/job-definition.entity';
import { assertCodingResourceCreation, assertCodingResourceMutation } from '../shared/coding-ownership.policy';
import { lockWorkspaceTestResultsMutationInTransaction, withWorkspaceTestResultsMutationTransaction } from '../shared/workspace-test-results-lock.util';
import { CoderTrainingSelectionService } from './coder-training-selection.service';
import { CoderTrainingResponse, TrainingJob, TrainingVariableConfig } from './coder-training.types';
import { CodingJobService } from './coding-job.service';
import {
  MissingsProfilesService
} from './missings-profiles.service';

@Injectable()
export class CoderTrainingMutationService {
  private readonly logger = new Logger('CoderTrainingService');

  constructor(
    @InjectRepository(CodingJobUnit)
    private codingJobUnitRepository: Repository<CodingJobUnit>,
    @InjectRepository(CoderTraining)
    private coderTrainingRepository: Repository<CoderTraining>,
    @InjectRepository(CoderTrainingDiscussionResult)
    private coderTrainingDiscussionResultRepository: Repository<CoderTrainingDiscussionResult>,
    private codingJobService: CodingJobService,
    private missingsProfilesService: MissingsProfilesService,
    private readonly selection: CoderTrainingSelectionService
  ) {}

  private async hasCodingProgressForJobs(jobIds: number[]): Promise<boolean> {
    const distinctJobIds = [...new Set(jobIds.filter(jobId => Number.isInteger(jobId) && jobId > 0))];
    if (distinctJobIds.length === 0) {
      return false;
    }

    const codedUnits = await this.codingJobUnitRepository.count({
      where: [
        { coding_job_id: In(distinctJobIds), code: Not(IsNull()) },
        { coding_job_id: In(distinctJobIds), score: Not(IsNull()) },
        { coding_job_id: In(distinctJobIds), notes: Not(IsNull()) },
        { coding_job_id: In(distinctJobIds), coding_issue_option: Not(IsNull()) },
        { coding_job_id: In(distinctJobIds), supervisor_comment: Not(IsNull()) }
      ]
    });

    return codedUnits > 0;
  }

  private async hasDiscussionResultsForTraining(workspaceId: number, trainingId: number): Promise<boolean> {
    const discussionResults = await this.coderTrainingDiscussionResultRepository.count({
      where: {
        workspace_id: workspaceId,
        training_id: trainingId
      }
    });

    return discussionResults > 0;
  }

  async createCoderTrainingJobs(
    workspaceId: number,
    selectedCoders: { id: number; name: string }[],
    variableConfigs: TrainingVariableConfig[],
    trainingLabel: string,
    missingsProfileId?: number,
    assignedVariables?: JobDefinitionVariable[],
    assignedVariableBundles?: JobDefinitionVariableBundle[],
    caseOrderingMode?: 'continuous' | 'alternating',
    caseSelectionMode?: CaseSelectionMode,
    referenceTrainingIds?: number[],
    referenceMode?: ReferenceMode,
    showScore?: boolean,
    allowComments?: boolean,
    suppressGeneralInstructions?: boolean,
    actorUserId?: number
  ): Promise<{ success: boolean; jobsCreated: number; message: string; jobs: TrainingJob[]; trainingId?: number }> {
    await assertCodingResourceCreation(this.coderTrainingRepository.manager, workspaceId, actorUserId);
    try {
      return await withWorkspaceTestResultsMutationTransaction(this.coderTrainingRepository.manager, async manager => {
        await lockWorkspaceTestResultsMutationInTransaction(manager, workspaceId);
        const creatorUserId = await assertCodingResourceCreation(manager, workspaceId, actorUserId);
        const coderTrainingRepository = manager.getRepository(CoderTraining);
        const coderTrainingVariableRepository = manager.getRepository(CoderTrainingVariable);
        const coderTrainingBundleRepository = manager.getRepository(CoderTrainingBundle);
        const coderTrainingCoderRepository = manager.getRepository(CoderTrainingCoder);
        const codingJobRepository = manager.getRepository(CodingJob);
        const codingJobUnitRepository = manager.getRepository(CodingJobUnit);
        const codingJobVariableRepository = manager.getRepository(CodingJobVariable);
        const codingJobCoderRepository = manager.getRepository(CodingJobCoder);
        const codingJobVariableBundleRepository = manager.getRepository(CodingJobVariableBundle);

        this.logger.log(`Creating coder training jobs for workspace ${workspaceId} with ${selectedCoders.length} coders and label '${trainingLabel}'`);
        await this.codingJobService.assertCodersCanCodeInWorkspace(
          selectedCoders.map(coder => coder.id),
          workspaceId,
          manager
        );
        const resolvedMissingsProfileId = await this.missingsProfilesService.resolveMissingsProfileId(
          workspaceId,
          missingsProfileId,
          manager
        );
        const trainingVariableSelections = await this.selection.buildTrainingVariableSelections(
          workspaceId,
          variableConfigs,
          assignedVariables || [],
          assignedVariableBundles || []
        );
        const trainingVariableConfigs = this.selection.mapTrainingVariableSelectionsToConfigs(trainingVariableSelections);

        const coderTraining = new CoderTraining();
        coderTraining.workspace_id = workspaceId;
        coderTraining.creatorUserId = creatorUserId;
        coderTraining.label = trainingLabel;
        coderTraining.case_ordering_mode = caseOrderingMode || 'continuous';
        coderTraining.case_selection_mode = caseSelectionMode ?? 'oldest_first';
        coderTraining.reference_training_ids = referenceTrainingIds?.length ? referenceTrainingIds : null;
        coderTraining.reference_mode = referenceMode ?? null;
        coderTraining.show_score = showScore ?? false;
        coderTraining.allow_comments = allowComments ?? true;
        coderTraining.suppress_general_instructions = suppressGeneralInstructions ?? false;
        coderTraining.created_at = new Date();
        coderTraining.updated_at = new Date();

        const savedTraining = await coderTrainingRepository.save(coderTraining);
        const trainingId = savedTraining.id;

        // Save selected variables, including variables that came from bundles.
        for (const variable of trainingVariableSelections) {
          const trainingVariable = new CoderTrainingVariable();
          trainingVariable.coder_training_id = trainingId;
          trainingVariable.variable_id = variable.variableId;
          trainingVariable.unit_name = variable.unitName;
          trainingVariable.sample_count = variable.sampleCount || 10;
          trainingVariable.include_derive_error = variable.includeDeriveError === true;
          await coderTrainingVariableRepository.save(trainingVariable);
        }

        // Save assigned bundles
        if (assignedVariableBundles) {
          for (const bundle of assignedVariableBundles) {
            const trainingBundle = new CoderTrainingBundle();
            trainingBundle.coder_training_id = trainingId;
            trainingBundle.variable_bundle_id = bundle.id;
            trainingBundle.sample_count = bundle.sampleCount || 10;
            trainingBundle.case_ordering_mode = bundle.caseOrderingMode || null;
            await coderTrainingBundleRepository.save(trainingBundle);
          }
        }

        // Save assigned coders
        for (const coder of selectedCoders) {
          const trainingCoder = new CoderTrainingCoder();
          trainingCoder.coder_training_id = trainingId;
          trainingCoder.user_id = coder.id;
          await coderTrainingCoderRepository.save(trainingCoder);
        }

        this.logger.log(`Created coder training ${trainingId} with label '${trainingLabel}' and configuration`);

        const trainingPackageOptions: {
          caseSelectionMode: CaseSelectionMode;
          referenceTrainingIds?: number[];
          referenceMode?: ReferenceMode;
          assignedVariableBundles?: JobDefinitionVariableBundle[];
        } = {
          caseSelectionMode: caseSelectionMode ?? 'oldest_first',
          referenceTrainingIds,
          referenceMode
        };
        if (assignedVariableBundles?.length) {
          trainingPackageOptions.assignedVariableBundles = assignedVariableBundles;
        }

        const trainingPackages = await this.selection.generateCoderTrainingPackages(
          workspaceId,
          selectedCoders,
          trainingVariableConfigs,
          trainingPackageOptions
        );

        // Build mapping from variable to bundle id and bundle sorting mode
        const variableToBundleMap = new Map<string, number>();
        const bundleSortingModeMap = new Map<number, 'continuous' | 'alternating' | null>();
        this.logger.log(`Building bundle maps for ${assignedVariableBundles?.length || 0} bundles`);
        if (assignedVariableBundles && assignedVariableBundles.length > 0) {
          const bundleIds = this.selection.getValidatedBundleIds(assignedVariableBundles);
          if (bundleIds.length > 0) {
            const fetchedBundlesById = await this.selection.getWorkspaceVariableBundlesById(workspaceId, bundleIds);
            for (const bundle of fetchedBundlesById.values()) {
            // Store the bundle's sorting mode (if set, otherwise null)
              const bundleConfig = assignedVariableBundles.find(b => b.id === bundle.id);
              const mode = bundleConfig?.caseOrderingMode || null;
              bundleSortingModeMap.set(bundle.id, mode);
              this.logger.log(`Bundle ${bundle.id} (${bundle.name}): mode=${mode}`);
              if (bundle.variables) {
                for (const v of bundle.variables) {
                  const key = `${v.unitName}::${v.variableId}`;
                  variableToBundleMap.set(key, bundle.id);
                  this.logger.debug(`  Variable mapping: ${key} -> bundle ${bundle.id}`);
                }
              }
            }
          }
        }

        const jobs: TrainingJob[] = [];
        let jobsCreated = 0;

        for (const trainingPackage of trainingPackages) {
          const coderId = trainingPackage.coderId;
          const coderName = trainingPackage.coderName;

          this.logger.log(`Creating training job for coder ${coderName} (ID: ${coderId})`);

          const codingJob = new CodingJob();
          codingJob.creatorUserId = savedTraining.creatorUserId;
          codingJob.name = `${trainingLabel}-${coderName}`;
          codingJob.workspace_id = workspaceId;
          codingJob.description = '';
          codingJob.training_id = trainingId;
          codingJob.missings_profile_id = resolvedMissingsProfileId;
          codingJob.case_ordering_mode = caseOrderingMode || 'continuous';
          codingJob.showScore = showScore ?? false;
          codingJob.allowComments = allowComments ?? true;
          codingJob.suppressGeneralInstructions = suppressGeneralInstructions ?? false;
          codingJob.created_at = new Date();
          codingJob.updated_at = new Date();

          const savedJob = await codingJobRepository.save(codingJob);
          const jobId = savedJob.id;

          jobsCreated += 1;
          jobs.push({
            coderId,
            coderName,
            jobId,
            jobName: codingJob.name
          });

          const codingJobCoder = new CodingJobCoder();
          codingJobCoder.coding_job_id = jobId;
          codingJobCoder.user_id = coderId;
          await codingJobCoderRepository.save(codingJobCoder);

          // Save bundle configurations to CodingJobVariableBundle for display sorting
          const seenBundleIdsForJob = new Set<number>();
          for (const response of trainingPackage.responses) {
            const bundleId = variableToBundleMap.get(`${response.unitName}::${response.variableId}`);
            if (bundleId && !seenBundleIdsForJob.has(bundleId)) {
              seenBundleIdsForJob.add(bundleId);
              const bundleMode = bundleSortingModeMap.get(bundleId);
              const jobVariableBundle = new CodingJobVariableBundle();
              jobVariableBundle.coding_job_id = jobId;
              jobVariableBundle.variable_bundle_id = bundleId;
              jobVariableBundle.case_ordering_mode = bundleMode || null;
              await codingJobVariableBundleRepository.save(jobVariableBundle);
              this.logger.log(`Saved CodingJobVariableBundle: job=${jobId}, bundle=${bundleId}, mode=${bundleMode || 'null'}`);
            }
          }

          const processedVariables = new Set<string>();
          for (const response of trainingPackage.responses) {
            const variableKey = `${response.variableId}:${response.unitName}`;
            if (!processedVariables.has(variableKey)) {
              const codingJobVariable = new CodingJobVariable();
              codingJobVariable.coding_job_id = jobId;
              codingJobVariable.variable_id = response.variableId;
              codingJobVariable.unit_name = response.unitName;
              await codingJobVariableRepository.save(codingJobVariable);
              processedVariables.add(variableKey);
              this.logger.log(`Added variable ${response.variableId} for unit ${response.unitName} to training job ${jobId} for coder ${coderName}`);
            }
          }

          // Sort responses with bundle-specific sorting modes
          // Group responses by their effective sorting mode
          const defaultMode = caseOrderingMode || 'continuous';
          const alternatingResponses: CoderTrainingResponse[] = [];
          const continuousResponses: CoderTrainingResponse[] = [];

          for (const response of trainingPackage.responses) {
            const bundleId = variableToBundleMap.get(`${response.unitName}::${response.variableId}`);
            const bundleMode = bundleId !== undefined ? bundleSortingModeMap.get(bundleId) : undefined;
            const effectiveMode = bundleMode || defaultMode;

            this.logger.debug(`Response ${response.responseId} (${response.unitName}::${response.variableId}): bundleId=${bundleId}, bundleMode=${bundleMode}, effectiveMode=${effectiveMode}`);

            if (effectiveMode === 'alternating') {
              alternatingResponses.push(response);
            } else {
              continuousResponses.push(response);
            }
          }

          this.logger.log(`Sorting: ${alternatingResponses.length} alternating, ${continuousResponses.length} continuous (default: ${defaultMode})`);

          // Sort each group with its respective mode
          const sortedAlternating = this.selection.sortTrainingResponses(alternatingResponses, 'alternating');
          const sortedContinuous = this.selection.sortTrainingResponses(continuousResponses, 'continuous');

          // Combine: alternating first, then continuous
          const sortedResponses = [...sortedAlternating, ...sortedContinuous];

          const codingJobUnits: CodingJobUnit[] = sortedResponses.map(response => {
            const codingJobUnit = new CodingJobUnit();
            codingJobUnit.coding_job_id = jobId;
            codingJobUnit.workspace_id = workspaceId;
            codingJobUnit.response_id = response.responseId;
            codingJobUnit.unit_name = response.unitName;
            codingJobUnit.unit_alias = response.unitAlias || null;
            codingJobUnit.variable_id = response.variableId;
            codingJobUnit.variable_anchor = response.variableId; // Same as variable_id
            codingJobUnit.booklet_name = response.bookletName;
            codingJobUnit.person_login = response.personLogin;
            codingJobUnit.person_code = response.personCode;
            codingJobUnit.person_group = response.personGroup;
            codingJobUnit.is_open = true;
            codingJobUnit.variable_bundle_id = variableToBundleMap.get(`${response.unitName}::${response.variableId}`) || null;
            return codingJobUnit;
          });
          await codingJobUnitRepository.save(codingJobUnits);
          this.logger.log(`Bulk-inserted ${codingJobUnits.length} coding job units to training job ${jobId} for coder ${coderName}`);

          this.logger.log(`Successfully created training job ${jobId} with ${trainingPackage.responses.length} coding units for coder ${coderName}`);
        }

        const message = `Successfully created ${jobsCreated} coder training jobs`;

        this.logger.log(message);
        return {
          success: true,
          jobsCreated,
          message,
          jobs,
          trainingId
        };
      });
    } catch (error) {
      if (error instanceof ForbiddenException) throw error;
      const errorMessage = `Error creating coder training jobs: ${getErrorMessage(error)}`;
      this.logger.error(errorMessage, getErrorStack(error));
      return {
        success: false,
        jobsCreated: 0,
        message: errorMessage,
        jobs: []
      };
    }
  }

  async updateCoderTraining(
    workspaceId: number,
    trainingId: number,
    trainingLabel: string,
    selectedCoders: { id: number; name: string }[],
    variableConfigs: TrainingVariableConfig[],
    missingsProfileId?: number,
    assignedVariables?: JobDefinitionVariable[],
    assignedVariableBundles?: JobDefinitionVariableBundle[],
    caseOrderingMode?: 'continuous' | 'alternating',
    caseSelectionMode?: CaseSelectionMode,
    referenceTrainingIds?: number[],
    referenceMode?: ReferenceMode,
    showScore?: boolean,
    allowComments?: boolean,
    suppressGeneralInstructions?: boolean,
    actorUserId?: number
  ): Promise<{ success: boolean; message: string; jobsCreated?: number; jobs?: TrainingJob[] }> {
    await assertCodingResourceMutation(this.coderTrainingRepository.manager, workspaceId, 'training', trainingId, actorUserId);
    try {
      return await withWorkspaceTestResultsMutationTransaction(this.coderTrainingRepository.manager, async manager => {
        await lockWorkspaceTestResultsMutationInTransaction(manager, workspaceId);
        await assertCodingResourceMutation(manager, workspaceId, 'training', trainingId, actorUserId);
        const coderTrainingRepository = manager.getRepository(CoderTraining);
        const coderTrainingVariableRepository = manager.getRepository(CoderTrainingVariable);
        const coderTrainingBundleRepository = manager.getRepository(CoderTrainingBundle);
        const coderTrainingCoderRepository = manager.getRepository(CoderTrainingCoder);
        const codingJobRepository = manager.getRepository(CodingJob);
        const codingJobUnitRepository = manager.getRepository(CodingJobUnit);
        const codingJobVariableRepository = manager.getRepository(CodingJobVariable);
        const codingJobCoderRepository = manager.getRepository(CodingJobCoder);
        const codingJobVariableBundleRepository = manager.getRepository(CodingJobVariableBundle);

        this.logger.log(`Updating coder training ${trainingId} in workspace ${workspaceId}`);
        await this.codingJobService.assertCodersCanCodeInWorkspace(
          selectedCoders.map(coder => coder.id),
          workspaceId,
          manager
        );

        const training = await coderTrainingRepository.findOne({
          where: { id: trainingId, workspace_id: workspaceId },
          relations: ['codingJobs', 'variables', 'bundles', 'bundles.bundle', 'coders']
        });

        if (!training) {
          return { success: false, message: 'Training nicht gefunden' };
        }

        for (const job of training.codingJobs || []) {
          await assertCodingResourceMutation(manager, workspaceId, 'job', job.id, actorUserId);
        }

        const resolvedCurrentProfileIds = await Promise.all((training.codingJobs || [])
          .map(job => this.missingsProfilesService.resolveMissingsProfileId(
            workspaceId,
            job.missings_profile_id,
            manager
          )));
        const currentProfileKeys = new Set(resolvedCurrentProfileIds);
        const hasConflictingCurrentMissingsProfiles = currentProfileKeys.size > 1;
        if (hasConflictingCurrentMissingsProfiles && missingsProfileId === undefined) {
          throw new BadRequestException(`Conflicting missing profiles for training ${trainingId}`);
        }
        const currentMissingsProfileId = currentProfileKeys.size === 1 ?
          Array.from(currentProfileKeys)[0] :
          null;
        const resolvedCurrentMissingsProfileId = await this.missingsProfilesService.resolveMissingsProfileId(
          workspaceId,
          currentMissingsProfileId,
          manager
        );
        const resolvedMissingsProfileId = missingsProfileId !== undefined ?
          await this.missingsProfilesService.resolveMissingsProfileId(workspaceId, missingsProfileId, manager) :
          resolvedCurrentMissingsProfileId;

        // Check if critical configuration changed (coders or variables)
        const currentCoderIds = training.coders?.map(c => c.user_id).sort() || [];
        const newCoderIds = selectedCoders.map(c => c.id).sort();
        const codersChanged = JSON.stringify(currentCoderIds) !== JSON.stringify(newCoderIds);

        const currentAssignedVariables = this.selection.mapTrainingVariables(training.variables || []);

        const currentCaseOrderingMode = training.case_ordering_mode || 'continuous';
        const newCaseOrderingMode = caseOrderingMode ?? currentCaseOrderingMode;

        const currentAssignedVariableBundles = this.selection.mapTrainingBundles(
          training.bundles || [],
          currentAssignedVariables
        );
        const currentTrainingVariables = await this.selection.buildTrainingVariableSelections(
          workspaceId,
          [],
          currentAssignedVariables,
          currentAssignedVariableBundles
        );

        const effectiveAssignedVariables = assignedVariables ?? currentAssignedVariables;
        const effectiveAssignedVariableBundles = assignedVariableBundles ?? currentAssignedVariableBundles;
        const effectiveTrainingVariables = await this.selection.buildTrainingVariableSelections(
          workspaceId,
          variableConfigs,
          effectiveAssignedVariables,
          effectiveAssignedVariableBundles
        );
        const effectiveTrainingVariableConfigs = this.selection.mapTrainingVariableSelectionsToConfigs(effectiveTrainingVariables);

        const currentVariables = currentTrainingVariables.map(v => ({
          variableId: v.variableId,
          unitName: v.unitName,
          sampleCount: v.sampleCount || 10,
          includeDeriveError: v.includeDeriveError === true
        })).sort((a, b) => (a.variableId + a.unitName).localeCompare(b.variableId + b.unitName));

        const newVariables = effectiveTrainingVariables.map(v => ({
          variableId: v.variableId,
          unitName: v.unitName,
          sampleCount: v.sampleCount || 10,
          includeDeriveError: v.includeDeriveError === true
        })).sort((a, b) => (a.variableId + a.unitName).localeCompare(b.variableId + b.unitName));

        const variablesChanged = JSON.stringify(currentVariables) !== JSON.stringify(newVariables);

        const currentBundles = currentAssignedVariableBundles.map(b => ({
          id: b.id,
          sampleCount: b.sampleCount || 10,
          caseOrderingMode: b.caseOrderingMode ?? currentCaseOrderingMode
        })).sort((a, b) => a.id - b.id);

        const newBundles = effectiveAssignedVariableBundles.map(b => ({
          id: b.id,
          sampleCount: b.sampleCount || 10,
          caseOrderingMode: b.caseOrderingMode ?? newCaseOrderingMode
        })).sort((a, b) => a.id - b.id);

        const bundlesChanged = JSON.stringify(currentBundles) !== JSON.stringify(newBundles);
        const caseOrderingChanged = currentCaseOrderingMode !== newCaseOrderingMode;
        const currentCaseSelectionMode = training.case_selection_mode || 'oldest_first';
        const newCaseSelectionMode = caseSelectionMode ?? currentCaseSelectionMode;
        const currentReferenceTrainingIds = [...(training.reference_training_ids ?? [])].sort((a, b) => a - b);
        const effectiveReferenceTrainingIds = referenceTrainingIds ?? training.reference_training_ids ?? [];
        const newReferenceTrainingIds = [...effectiveReferenceTrainingIds].sort((a, b) => a - b);
        const currentReferenceMode = training.reference_mode ?? null;
        const newReferenceMode = effectiveReferenceTrainingIds.length > 0 ?
          referenceMode ?? currentReferenceMode :
          null;
        const caseSelectionChanged = currentCaseSelectionMode !== newCaseSelectionMode;
        const referenceSelectionChanged = JSON.stringify(currentReferenceTrainingIds) !== JSON.stringify(newReferenceTrainingIds) ||
        currentReferenceMode !== newReferenceMode;
        const missingsProfileChanged = hasConflictingCurrentMissingsProfiles ||
        resolvedCurrentMissingsProfileId !== resolvedMissingsProfileId;
        const shouldRecreateJobs =
          codersChanged ||
        variablesChanged ||
        bundlesChanged ||
        caseOrderingChanged ||
        caseSelectionChanged ||
        referenceSelectionChanged ||
        missingsProfileChanged;

        if (shouldRecreateJobs) {
          const jobIds = (training.codingJobs || []).map(job => job.id);
          const [hasCodingProgress, hasDiscussionResults] = await Promise.all([
            this.hasCodingProgressForJobs(jobIds),
            this.hasDiscussionResultsForTraining(workspaceId, trainingId)
          ]);
          if (hasCodingProgress || hasDiscussionResults) {
            return {
              success: false,
              message: 'Die Schulung wurde bereits bearbeitet. Änderungen an Fallauswahl, Fallreihenfolge, Referenzen, Missing-Profil, Kodierern oder Variablen würden bestehende Kodierungen löschen.'
            };
          }
        }

        const resolvedSuppressGeneralInstructions = suppressGeneralInstructions ??
        training.suppress_general_instructions ??
        false;
        const resolvedShowScore = showScore ??
        training.show_score ??
        false;
        const resolvedAllowComments = allowComments ??
        training.allow_comments ??
        true;

        training.label = trainingLabel;
        training.case_ordering_mode = newCaseOrderingMode;
        training.case_selection_mode = newCaseSelectionMode;
        training.reference_training_ids = effectiveReferenceTrainingIds.length ? effectiveReferenceTrainingIds : null;
        training.reference_mode = newReferenceMode;
        training.show_score = resolvedShowScore;
        training.allow_comments = resolvedAllowComments;
        training.suppress_general_instructions = resolvedSuppressGeneralInstructions;
        training.updated_at = new Date();

        await coderTrainingRepository.save(training);

        if (shouldRecreateJobs) {
          this.logger.log(`Configuration changed for training ${trainingId}. Recreating jobs.`);

          // Delete existing configuration relations
          await coderTrainingVariableRepository.delete({ coder_training_id: trainingId });
          await coderTrainingBundleRepository.delete({ coder_training_id: trainingId });
          await coderTrainingCoderRepository.delete({ coder_training_id: trainingId });

          // Save new configuration relations
          for (const variable of effectiveTrainingVariables) {
            const trainingVariable = new CoderTrainingVariable();
            trainingVariable.coder_training_id = trainingId;
            trainingVariable.variable_id = variable.variableId;
            trainingVariable.unit_name = variable.unitName;
            trainingVariable.sample_count = variable.sampleCount || 10;
            trainingVariable.include_derive_error = variable.includeDeriveError === true;
            await coderTrainingVariableRepository.save(trainingVariable);
          }

          for (const bundle of effectiveAssignedVariableBundles) {
            const trainingBundle = new CoderTrainingBundle();
            trainingBundle.coder_training_id = trainingId;
            trainingBundle.variable_bundle_id = bundle.id;
            trainingBundle.sample_count = bundle.sampleCount || 10;
            trainingBundle.case_ordering_mode = bundle.caseOrderingMode ?? null;
            await coderTrainingBundleRepository.save(trainingBundle);
          }

          for (const coder of selectedCoders) {
            const trainingCoder = new CoderTrainingCoder();
            trainingCoder.coder_training_id = trainingId;
            trainingCoder.user_id = coder.id;
            await coderTrainingCoderRepository.save(trainingCoder);
          }
          this.logger.log(`Configuration changed for training ${trainingId}. Recreating jobs.`);

          // Delete existing jobs and their associations
          for (const job of training.codingJobs || []) {
            await codingJobUnitRepository.delete({ coding_job_id: job.id });
            await codingJobVariableRepository.delete({ coding_job_id: job.id });
            await codingJobCoderRepository.delete({ coding_job_id: job.id });
            await codingJobRepository.delete(job.id);
          }

          // Generate and create new jobs
          const trainingPackageOptions: {
            caseSelectionMode: CaseSelectionMode;
            referenceTrainingIds?: number[];
            referenceMode?: ReferenceMode;
            assignedVariableBundles?: JobDefinitionVariableBundle[];
          } = {
            caseSelectionMode: newCaseSelectionMode,
            referenceTrainingIds: effectiveReferenceTrainingIds,
            referenceMode: newReferenceMode ?? undefined
          };
          if (effectiveAssignedVariableBundles.length > 0) {
            trainingPackageOptions.assignedVariableBundles = effectiveAssignedVariableBundles;
          }

          const trainingPackages = await this.selection.generateCoderTrainingPackages(
            workspaceId,
            selectedCoders,
            effectiveTrainingVariableConfigs,
            trainingPackageOptions
          );

          // Build mapping from variable to bundle id and bundle sorting mode
          const variableToBundleMap = new Map<string, number>();
          const bundleSortingModeMap = new Map<number, 'continuous' | 'alternating' | null>();
          this.logger.log(`[Update] Building bundle maps for ${effectiveAssignedVariableBundles.length} bundles`);
          if (effectiveAssignedVariableBundles.length > 0) {
            const bundleIds = this.selection.getValidatedBundleIds(effectiveAssignedVariableBundles);
            if (bundleIds.length > 0) {
              const fetchedBundlesById = await this.selection.getWorkspaceVariableBundlesById(workspaceId, bundleIds);
              for (const bundle of fetchedBundlesById.values()) {
              // Store the bundle's sorting mode (if set, otherwise null)
                const bundleConfig = effectiveAssignedVariableBundles.find(b => b.id === bundle.id);
                const mode = bundleConfig?.caseOrderingMode ?? null;
                bundleSortingModeMap.set(bundle.id, mode);
                this.logger.log(`[Update] Bundle ${bundle.id} (${bundle.name}): mode=${mode}`);
                if (bundle.variables) {
                  for (const v of bundle.variables) {
                    const key = `${v.unitName}::${v.variableId}`;
                    variableToBundleMap.set(key, bundle.id);
                    this.logger.debug(`[Update]   Variable mapping: ${key} -> bundle ${bundle.id}`);
                  }
                }
              }
            }
          }

          const jobs: TrainingJob[] = [];
          let jobsCreatedCount = 0;

          for (const trainingPackage of trainingPackages) {
            const coderId = trainingPackage.coderId;
            const coderName = trainingPackage.coderName;

            const codingJob = new CodingJob();
            codingJob.creatorUserId = training.creatorUserId ?? null;
            codingJob.name = `${trainingLabel}-${coderName}`;
            codingJob.workspace_id = workspaceId;
            codingJob.training_id = trainingId;
            codingJob.missings_profile_id = resolvedMissingsProfileId;
            codingJob.case_ordering_mode = newCaseOrderingMode;
            codingJob.showScore = resolvedShowScore;
            codingJob.allowComments = resolvedAllowComments;
            codingJob.suppressGeneralInstructions = resolvedSuppressGeneralInstructions;
            codingJob.created_at = new Date();
            codingJob.updated_at = new Date();

            const savedJob = await codingJobRepository.save(codingJob);
            const jobId = savedJob.id;

            jobsCreatedCount += 1;
            jobs.push({
              coderId,
              coderName,
              jobId,
              jobName: codingJob.name
            });

            const codingJobCoder = new CodingJobCoder();
            codingJobCoder.coding_job_id = jobId;
            codingJobCoder.user_id = coderId;
            await codingJobCoderRepository.save(codingJobCoder);

            // Save bundle configurations to CodingJobVariableBundle for display sorting
            const seenBundleIdsForJob = new Set<number>();
            for (const response of trainingPackage.responses) {
              const bundleId = variableToBundleMap.get(`${response.unitName}::${response.variableId}`);
              if (bundleId && !seenBundleIdsForJob.has(bundleId)) {
                seenBundleIdsForJob.add(bundleId);
                const bundleMode = bundleSortingModeMap.get(bundleId);
                const jobVariableBundle = new CodingJobVariableBundle();
                jobVariableBundle.coding_job_id = jobId;
                jobVariableBundle.variable_bundle_id = bundleId;
                jobVariableBundle.case_ordering_mode = bundleMode ?? null;
                await codingJobVariableBundleRepository.save(jobVariableBundle);
                this.logger.log(`[Update] Saved CodingJobVariableBundle: job=${jobId}, bundle=${bundleId}, mode=${bundleMode || 'null'}`);
              }
            }

            const processedVariables = new Set<string>();
            for (const response of trainingPackage.responses) {
              const variableKey = `${response.variableId}:${response.unitName}`;
              if (!processedVariables.has(variableKey)) {
                const codingJobVariable = new CodingJobVariable();
                codingJobVariable.coding_job_id = jobId;
                codingJobVariable.variable_id = response.variableId;
                codingJobVariable.unit_name = response.unitName;
                await codingJobVariableRepository.save(codingJobVariable);
                processedVariables.add(variableKey);
              }
            }

            // Sort responses with bundle-specific sorting modes
            // Group responses by their effective sorting mode
            const defaultMode = newCaseOrderingMode;
            const alternatingResponses: CoderTrainingResponse[] = [];
            const continuousResponses: CoderTrainingResponse[] = [];

            for (const response of trainingPackage.responses) {
              const bundleId = variableToBundleMap.get(`${response.unitName}::${response.variableId}`);
              const bundleMode = bundleId !== undefined ? bundleSortingModeMap.get(bundleId) : undefined;
              const effectiveMode = bundleMode || defaultMode;

              this.logger.debug(`Response ${response.responseId} (${response.unitName}::${response.variableId}): bundleId=${bundleId}, bundleMode=${bundleMode}, effectiveMode=${effectiveMode}`);

              if (effectiveMode === 'alternating') {
                alternatingResponses.push(response);
              } else {
                continuousResponses.push(response);
              }
            }

            this.logger.log(`Sorting: ${alternatingResponses.length} alternating, ${continuousResponses.length} continuous (default: ${defaultMode})`);

            // Sort each group with its respective mode
            const sortedAlternating = this.selection.sortTrainingResponses(alternatingResponses, 'alternating');
            const sortedContinuous = this.selection.sortTrainingResponses(continuousResponses, 'continuous');

            // Combine: alternating first, then continuous
            const sortedResponses = [...sortedAlternating, ...sortedContinuous];

            const codingJobUnits: CodingJobUnit[] = sortedResponses.map(response => {
              const codingJobUnit = new CodingJobUnit();
              codingJobUnit.coding_job_id = jobId;
              codingJobUnit.workspace_id = workspaceId;
              codingJobUnit.response_id = response.responseId;
              codingJobUnit.unit_name = response.unitName;
              codingJobUnit.unit_alias = response.unitAlias || null;
              codingJobUnit.variable_id = response.variableId;
              codingJobUnit.variable_anchor = response.variableId; // Same as variable_id
              codingJobUnit.booklet_name = response.bookletName;
              codingJobUnit.person_login = response.personLogin;
              codingJobUnit.person_code = response.personCode;
              codingJobUnit.person_group = response.personGroup;
              codingJobUnit.is_open = true;
              codingJobUnit.variable_bundle_id = variableToBundleMap.get(`${response.unitName}::${response.variableId}`) || null;
              return codingJobUnit;
            });
            await codingJobUnitRepository.save(codingJobUnits);
            this.logger.log(`Bulk-inserted ${codingJobUnits.length} coding job units to training job ${jobId} for coder ${coderName}`);
          }

          return {
            success: true,
            message: 'Training erfolgreich aktualisiert und neue Kodierungsaufträge erstellt',
            jobsCreated: jobsCreatedCount,
            jobs
          };
        }

        for (const job of training.codingJobs || []) {
          job.showScore = resolvedShowScore;
          job.allowComments = resolvedAllowComments;
          job.suppressGeneralInstructions = resolvedSuppressGeneralInstructions;
          await codingJobRepository.save(job);
        }

        return { success: true, message: 'Training erfolgreich aktualisiert' };
      });
    } catch (error) {
      if (error instanceof ForbiddenException) throw error;
      this.logger.error(`Error updating coder training: ${getErrorMessage(error)}`, getErrorStack(error));
      return { success: false, message: `Fehler beim Aktualisieren des Trainings: ${getErrorMessage(error)}` };
    }
  }

  async updateCoderTrainingLabel(workspaceId: number, trainingId: number, newLabel: string,
                                 actorUserId?: number): Promise<{ success: boolean; message: string }> {
    await assertCodingResourceMutation(this.coderTrainingRepository.manager, workspaceId, 'training', trainingId, actorUserId);
    try {
      return await withWorkspaceTestResultsMutationTransaction(this.coderTrainingRepository.manager, async manager => {
        await lockWorkspaceTestResultsMutationInTransaction(manager, workspaceId);
        await assertCodingResourceMutation(manager, workspaceId, 'training', trainingId, actorUserId);
        const coderTrainingRepository = manager.getRepository(CoderTraining);

        this.logger.log(`Updating coder training ${trainingId} label to "${newLabel}" in workspace ${workspaceId}`);

        const training = await coderTrainingRepository.findOne({
          where: {
            id: trainingId,
            workspace_id: workspaceId
          }
        });

        if (!training) {
          return {
            success: false,
            message: `Coder training with ID ${trainingId} not found in workspace ${workspaceId}`
          };
        }

        training.label = newLabel;
        training.updated_at = new Date();

        await coderTrainingRepository.save(training);
        this.logger.log(`Updated coder training ${trainingId} label to "${newLabel}"`);

        return {
          success: true,
          message: `Successfully updated coder training label to "${newLabel}"`
        };
      });
    } catch (error) {
      if (error instanceof ForbiddenException) throw error;
      const errorMessage = `Error updating coder training label: ${getErrorMessage(error)}`;
      this.logger.error(errorMessage, getErrorStack(error));
      return {
        success: false,
        message: errorMessage
      };
    }
  }

  async deleteCoderTraining(workspaceId: number, trainingId: number,
                            actorUserId?: number): Promise<{ success: boolean; message: string }> {
    await assertCodingResourceMutation(this.coderTrainingRepository.manager, workspaceId, 'training', trainingId, actorUserId);
    try {
      return await withWorkspaceTestResultsMutationTransaction(this.coderTrainingRepository.manager, async manager => {
        await lockWorkspaceTestResultsMutationInTransaction(manager, workspaceId);
        await assertCodingResourceMutation(manager, workspaceId, 'training', trainingId, actorUserId);
        const coderTrainingRepository = manager.getRepository(CoderTraining);
        const codingJobRepository = manager.getRepository(CodingJob);
        const codingJobUnitRepository = manager.getRepository(CodingJobUnit);
        const codingJobVariableRepository = manager.getRepository(CodingJobVariable);
        const codingJobCoderRepository = manager.getRepository(CodingJobCoder);

        this.logger.log(`Deleting coder training ${trainingId} in workspace ${workspaceId}`);

        const training = await coderTrainingRepository.findOne({
          where: {
            id: trainingId,
            workspace_id: workspaceId
          },
          relations: ['codingJobs', 'codingJobs.codingJobUnits']
        });

        if (!training) {
          return {
            success: false,
            message: `Coder training with ID ${trainingId} not found in workspace ${workspaceId}`
          };
        }

        for (const job of training.codingJobs || []) {
          await assertCodingResourceMutation(manager, workspaceId, 'job', job.id, actorUserId);
        }

        for (const job of training.codingJobs || []) {
          await codingJobUnitRepository.delete({ coding_job_id: job.id });
          this.logger.log(`Deleted ${job.codingJobUnits?.length || 0} coding job units for job ${job.id}`);
        }

        for (const job of training.codingJobs || []) {
          await codingJobVariableRepository.delete({ coding_job_id: job.id });
          this.logger.log(`Deleted coding job variables for job ${job.id}`);
        }

        for (const job of training.codingJobs || []) {
          await codingJobCoderRepository.delete({ coding_job_id: job.id });
          this.logger.log(`Deleted coding job coders for job ${job.id}`);
        }

        const jobsDeleted = training.codingJobs?.length || 0;
        if (jobsDeleted > 0) {
          await codingJobRepository.delete({ training_id: trainingId });
          this.logger.log(`Deleted ${jobsDeleted} coding jobs for training ${trainingId}`);
        }

        await coderTrainingRepository.delete(trainingId);
        this.logger.log(`Deleted coder training ${trainingId}`);

        return {
          success: true,
          message: `Successfully deleted coder training "${training.label}" with ${jobsDeleted} associated jobs`
        };
      });
    } catch (error) {
      if (error instanceof ForbiddenException) throw error;
      const errorMessage = `Error deleting coder training: ${getErrorMessage(error)}`;
      this.logger.error(errorMessage, getErrorStack(error));
      return {
        success: false,
        message: errorMessage
      };
    }
  }
}
