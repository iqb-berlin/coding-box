import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { CodingJob } from '../../entities/coding-job.entity';
import { CodingJobCoder } from '../../entities/coding-job-coder.entity';
import { CodingJobVariable } from '../../entities/coding-job-variable.entity';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';
import { CoderTraining } from '../../entities/coder-training.entity';
import { ResponseEntity } from '../../entities/response.entity';
import { statusStringToNumber } from '../../utils/response-status-converter';

interface CoderTrainingResponse {
  responseId: number;
  unitAlias: string;
  variableId: string;
  unitName: string;
  value: string;
  personLogin: string;
  personCode: string;
  personGroup: string;
  bookletName: string;
  variable: string;
}

interface TrainingPackage {
  coderId: number;
  coderName: string;
  responses: CoderTrainingResponse[];
}

interface TrainingJob {
  coderId: number;
  coderName: string;
  jobId: number;
  jobName: string;
}

interface CoderTrainingWithJobs {
  id: number;
  workspace_id: number;
  label: string;
  created_at: Date;
  updated_at: Date;
  jobsCount: number;
}

@Injectable()
export class CoderTrainingService {
  private readonly logger = new Logger(CoderTrainingService.name);

  constructor(
    @InjectRepository(CodingJob)
    private codingJobRepository: Repository<CodingJob>,
    @InjectRepository(CodingJobCoder)
    private codingJobCoderRepository: Repository<CodingJobCoder>,
    @InjectRepository(CodingJobVariable)
    private codingJobVariableRepository: Repository<CodingJobVariable>,
    @InjectRepository(CodingJobUnit)
    private codingJobUnitRepository: Repository<CodingJobUnit>,
    @InjectRepository(CoderTraining)
    private coderTrainingRepository: Repository<CoderTraining>,
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>
  ) { }

  private sampleResponses(
    responses: CoderTrainingResponse[],
    sampleCount: number
  ): CoderTrainingResponse[] {
    if (responses.length <= sampleCount) {
      return responses;
    }

    // Sort by response ID for deterministic, consistent ordering across all coders
    const sorted = [...responses].sort((a, b) => a.responseId - b.responseId);
    return sorted.slice(0, sampleCount);
  }

  async generateCoderTrainingPackages(
    workspaceId: number,
    selectedCoders: { id: number; name: string }[],
    variableConfigs: { variableId: string; unitId: string; sampleCount: number }[]
  ): Promise<TrainingPackage[]> {
    this.logger.log(`Generating coder training packages for workspace ${workspaceId} with ${selectedCoders.length} coders and ${variableConfigs.length} variable configs`);

    // Pre-sample responses for each variable configuration to ensure consistency across all coders
    const sampledResponsesByConfig: Map<string, CoderTrainingResponse[]> = new Map();

    for (const config of variableConfigs) {
      const variableId = config.variableId;
      const unitId = config.unitId;
      const sampleCount = config.sampleCount;
      const configKey = `${unitId}:${variableId}`;

      this.logger.log(`Querying CODING_INCOMPLETE responses for unit ${unitId}, variable ${variableId}`);

      const responses = await this.responseRepository.find({
        where: {
          status_v1: statusStringToNumber('CODING_INCOMPLETE'),
          variableid: variableId
        },
        relations: ['unit', 'unit.booklet', 'unit.booklet.person', 'unit.booklet.bookletinfo'],
        select: {
          id: true,
          value: true,
          variableid: true,
          status_v1: true,
          code_v1: true,
          score_v1: true,
          unit: {
            id: true,
            name: true,
            alias: true,
            booklet: {
              id: true,
              person: {
                id: true,
                login: true,
                code: true,
                group: true
              },
              bookletinfo: {
                id: true,
                name: true
              }
            }
          }
        }
      });

      const unitResponses = responses.filter(r => r.unit?.alias === unitId);
      this.logger.log(`Found ${unitResponses.length} CODING_INCOMPLETE responses for unit ${unitId}, variable ${variableId}`);
      const transformedResponses: CoderTrainingResponse[] = unitResponses.map(r => ({
        responseId: r.id,
        unitAlias: r.unit?.alias || '',
        variableId: r.variableid,
        unitName: r.unit?.name || '',
        value: r.value,
        personLogin: r.unit?.booklet?.person?.login || '',
        personCode: r.unit?.booklet?.person?.code || '',
        personGroup: r.unit?.booklet?.person?.group || '',
        bookletName: r.unit?.booklet?.bookletinfo?.name || '',
        variable: r.variableid
      }));

      const sampledResponses = this.sampleResponses(transformedResponses, sampleCount);
      sampledResponsesByConfig.set(configKey, sampledResponses);

      this.logger.log(`Sampled ${sampledResponses.length} consistent responses for unit ${unitId}, variable ${variableId}`);
    }

    // Create training packages for each coder using the pre-sampled responses
    const result: TrainingPackage[] = [];

    for (const coder of selectedCoders) {
      const coderId = coder.id;
      const coderName = coder.name;
      const coderResponses: CoderTrainingResponse[] = [];

      this.logger.log(`Assigning consistent training samples to coder ${coderName} (ID: ${coderId})`);

      for (const config of variableConfigs) {
        const configKey = `${config.unitId}:${config.variableId}`;
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

  async createCoderTrainingJobs(
    workspaceId: number,
    selectedCoders: { id: number; name: string }[],
    variableConfigs: { variableId: string; unitId: string; sampleCount: number }[],
    trainingLabel: string,
    missingsProfileId?: number
  ): Promise<{ success: boolean; jobsCreated: number; message: string; jobs: TrainingJob[]; trainingId?: number }> {
    try {
      this.logger.log(`Creating coder training jobs for workspace ${workspaceId} with ${selectedCoders.length} coders and label '${trainingLabel}'`);

      const coderTraining = new CoderTraining();
      coderTraining.workspace_id = workspaceId;
      coderTraining.label = trainingLabel;
      coderTraining.created_at = new Date();
      coderTraining.updated_at = new Date();

      const savedTraining = await this.coderTrainingRepository.save(coderTraining);
      const trainingId = savedTraining.id;

      this.logger.log(`Created coder training ${trainingId} with label '${trainingLabel}'`);

      const trainingPackages = await this.generateCoderTrainingPackages(workspaceId, selectedCoders, variableConfigs);

      const jobs: TrainingJob[] = [];
      let jobsCreated = 0;

      for (const trainingPackage of trainingPackages) {
        const coderId = trainingPackage.coderId;
        const coderName = trainingPackage.coderName;

        this.logger.log(`Creating training job for coder ${coderName} (ID: ${coderId})`);

        const codingJob = new CodingJob();
        codingJob.name = `${trainingLabel}-${coderName}`;
        codingJob.workspace_id = workspaceId;
        codingJob.description = '';
        codingJob.training_id = trainingId;
        codingJob.missings_profile_id = missingsProfileId;
        codingJob.created_at = new Date();
        codingJob.updated_at = new Date();

        const savedJob = await this.codingJobRepository.save(codingJob);
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
        await this.codingJobCoderRepository.save(codingJobCoder);

        const processedVariables = new Set<string>();
        for (const response of trainingPackage.responses) {
          const variableKey = `${response.variableId}:${response.unitName}`;
          if (!processedVariables.has(variableKey)) {
            const codingJobVariable = new CodingJobVariable();
            codingJobVariable.coding_job_id = jobId;
            codingJobVariable.variable_id = response.variableId;
            codingJobVariable.unit_name = response.unitName;
            await this.codingJobVariableRepository.save(codingJobVariable);
            processedVariables.add(variableKey);
            this.logger.log(`Added variable ${response.variableId} for unit ${response.unitName} to training job ${jobId} for coder ${coderName}`);
          }
        }

        for (const response of trainingPackage.responses) {
          const codingJobUnit = new CodingJobUnit();
          codingJobUnit.coding_job_id = jobId;
          codingJobUnit.response_id = response.responseId;
          codingJobUnit.unit_name = response.unitName;
          codingJobUnit.unit_alias = response.unitAlias || null;
          codingJobUnit.variable_id = response.variableId;
          codingJobUnit.variable_anchor = response.variableId; // Same as variable_id
          codingJobUnit.booklet_name = response.bookletName;
          codingJobUnit.person_login = response.personLogin;
          codingJobUnit.person_code = response.personCode;
          codingJobUnit.is_open = true;
          await this.codingJobUnitRepository.save(codingJobUnit);

          this.logger.log(`Added coding job unit for response ${response.responseId} to training job ${jobId} for coder ${coderName}`);
        }

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
    } catch (error) {
      const errorMessage = `Error creating coder training jobs: ${error.message}`;
      this.logger.error(errorMessage, error.stack);
      return {
        success: false,
        jobsCreated: 0,
        message: errorMessage,
        jobs: []
      };
    }
  }

  async getCoderTrainings(workspaceId: number): Promise<CoderTrainingWithJobs[]> {
    this.logger.log(`Getting all coder trainings for workspace ${workspaceId}`);

    const trainings = await this.coderTrainingRepository.find({
      where: { workspace_id: workspaceId },
      relations: ['codingJobs'],
      order: { created_at: 'DESC' }
    });

    return trainings.map(training => ({
      id: training.id,
      workspace_id: training.workspace_id,
      label: training.label,
      created_at: training.created_at,
      updated_at: training.updated_at,
      jobsCount: training.codingJobs?.length || 0
    }));
  }

  async getTrainingCodingComparison(
    workspaceId: number,
    trainingIds: number[]
  ): Promise<Array<{
      unitName: string;
      variableId: string;
      trainings: Array<{
        trainingId: number;
        trainingLabel: string;
        code: string | null;
        score: number | null;
      }>;
    }>> {
    this.logger.log(`Getting coding comparison for trainings ${trainingIds.join(', ')} in workspace ${workspaceId}`);

    const trainings = await this.coderTrainingRepository.find({
      where: {
        workspace_id: workspaceId,
        id: In(trainingIds)
      },
      relations: ['codingJobs.codingJobUnits'],
      order: { label: 'ASC' }
    });

    if (trainings.length === 0) {
      return [];
    }

    const unitVariableMap = new Map<string, { unitName: string; variableId: string }>();

    trainings.forEach(training => {
      training.codingJobs?.forEach(job => {
        job.codingJobUnits?.forEach(unit => {
          const unitVariableKey = `${unit.unit_name}:${unit.variable_id}`;
          if (!unitVariableMap.has(unitVariableKey)) {
            unitVariableMap.set(unitVariableKey, {
              unitName: unit.unit_name,
              variableId: unit.variable_id
            });
          }
        });
      });
    });

    const comparisonData: Array<{
      unitName: string;
      variableId: string;
      trainings: Array<{
        trainingId: number;
        trainingLabel: string;
        code: string | null;
        score: number | null;
      }>;
    }> = [];

    for (const [, unitVar] of unitVariableMap.entries()) {
      const trainingsData: Array<{
        trainingId: number;
        trainingLabel: string;
        code: string | null;
        score: number | null;
      }> = [];

      for (const training of trainings) {
        let code: string | null = null;
        let score: number | null = null;

        training.codingJobs?.forEach(job => {
          job.codingJobUnits?.forEach(unit => {
            if (unit.unit_name === unitVar.unitName && unit.variable_id === unitVar.variableId) {
              if (unit.code !== null) {
                code = unit.code.toString(); // Codes are stored as numbers in DB
              }
              if (unit.score !== null) {
                score = unit.score;
              }
            }
          });
        });

        trainingsData.push({
          trainingId: training.id,
          trainingLabel: training.label,
          code,
          score
        });
      }

      comparisonData.push({
        unitName: unitVar.unitName,
        variableId: unitVar.variableId,
        trainings: trainingsData
      });
    }

    this.logger.log(`Generated comparison data for ${comparisonData.length} unit/variable combinations across ${trainings.length} trainings`);

    return comparisonData;
  }

  async getWithinTrainingCodingComparison(
    workspaceId: number,
    trainingId: number
  ): Promise<Array<{

      unitName: string;
      variableId: string;
      personCode: string;
      testPerson: string;
      givenAnswer: string;
      coders: Array<{
        jobId: number;
        coderName: string;
        code: string | null;
        score: number | null;
      }>;
    }>> {
    this.logger.log(`Getting within-training coding comparison for training ${trainingId} in workspace ${workspaceId}`);

    const training = await this.coderTrainingRepository.findOne({
      where: {
        workspace_id: workspaceId,
        id: trainingId
      },
      relations: ['codingJobs.codingJobCoders.user', 'codingJobs.codingJobUnits.response.unit.booklet.person']
    });

    if (!training || !training.codingJobs) {
      return [];
    }

    const unitVariableMap = new Map<string, { unitName: string; variableId: string; personCode: string; testPerson: string; givenAnswer: string }>();

    training.codingJobs.forEach(job => {
      job.codingJobUnits?.forEach(unit => {
        const unitVariableKey = `${unit.unit_name}:${unit.variable_id}:${unit.person_code}`;
        if (!unitVariableMap.has(unitVariableKey)) {
          const givenAnswer = unit.response?.value || '';
          const personGroup = unit.response?.unit?.booklet?.person?.group || '';
          const testPerson = `${unit.person_login} (${personGroup}) - ${unit.booklet_name}`;

          unitVariableMap.set(unitVariableKey, {
            unitName: unit.unit_name,
            variableId: unit.variable_id,
            personCode: unit.person_code,
            testPerson,
            givenAnswer
          });
        }
      });
    });

    const comparisonData = [];

    for (const [, unitVar] of unitVariableMap.entries()) {
      const codersData: Array<{
        jobId: number;
        coderName: string;
        code: string | null;
        score: number | null;
      }> = [];

      for (const job of training.codingJobs) {
        let code: string | null = null;
        let score: number | null = null;

        const coderName = job.codingJobCoders && job.codingJobCoders.length > 0 && job.codingJobCoders[0].user ?
          `${job.codingJobCoders[0].user.username || 'Unknown'}` :
          `Coder ${job.name}`;

        job.codingJobUnits?.forEach(unit => {
          if (unit.unit_name === unitVar.unitName && unit.variable_id === unitVar.variableId && unit.person_code === unitVar.personCode) {
            if (unit.code !== null) {
              code = unit.code.toString();
            }
            if (unit.score !== null) {
              score = unit.score;
            }
          }
        });

        codersData.push({
          jobId: job.id,
          coderName,
          code,
          score
        });
      }

      comparisonData.push({
        unitName: unitVar.unitName,
        variableId: unitVar.variableId,
        personCode: unitVar.personCode,
        testPerson: unitVar.testPerson,
        givenAnswer: unitVar.givenAnswer,
        coders: codersData
      });
    }

    this.logger.log(`Generated within-training comparison data for ${comparisonData.length} unit/variable combinations across ${training.codingJobs.length} coders`);

    return comparisonData;
  }

  async updateCoderTrainingLabel(workspaceId: number, trainingId: number, newLabel: string): Promise<{ success: boolean; message: string }> {
    try {
      this.logger.log(`Updating coder training ${trainingId} label to "${newLabel}" in workspace ${workspaceId}`);

      const training = await this.coderTrainingRepository.findOne({
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

      await this.coderTrainingRepository.save(training);
      this.logger.log(`Updated coder training ${trainingId} label to "${newLabel}"`);

      return {
        success: true,
        message: `Successfully updated coder training label to "${newLabel}"`
      };
    } catch (error) {
      const errorMessage = `Error updating coder training label: ${error.message}`;
      this.logger.error(errorMessage, error.stack);
      return {
        success: false,
        message: errorMessage
      };
    }
  }

  async getCodingJobsForTraining(workspaceId: number, trainingId: number): Promise<Array<{
    id: number;
    name: string;
    description?: string;
    status: string;
    created_at: Date;
    coder: {
      userId: number;
      username: string;
    };
    unitsCount: number;
  }>> {
    this.logger.log(`Getting coding jobs for training ${trainingId} in workspace ${workspaceId}`);

    const training = await this.coderTrainingRepository.findOne({
      where: {
        id: trainingId,
        workspace_id: workspaceId
      },
      relations: ['codingJobs', 'codingJobs.codingJobCoders', 'codingJobs.codingJobCoders.user', 'codingJobs.codingJobUnits']
    });

    if (!training || !training.codingJobs) {
      return [];
    }

    return training.codingJobs.map(job => ({
      id: job.id,
      name: job.name,
      description: job.description,
      status: job.status,
      created_at: job.created_at,
      coder: job.codingJobCoders && job.codingJobCoders.length > 0 && job.codingJobCoders[0].user ? {
        userId: job.codingJobCoders[0].user.id,
        username: job.codingJobCoders[0].user.username
      } : {
        userId: 0,
        username: 'Unknown'
      },
      unitsCount: job.codingJobUnits?.length || 0
    }));
  }

  async deleteCoderTraining(workspaceId: number, trainingId: number): Promise<{ success: boolean; message: string }> {
    try {
      this.logger.log(`Deleting coder training ${trainingId} in workspace ${workspaceId}`);

      const training = await this.coderTrainingRepository.findOne({
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
        await this.codingJobUnitRepository.delete({ coding_job_id: job.id });
        this.logger.log(`Deleted ${job.codingJobUnits?.length || 0} coding job units for job ${job.id}`);
      }

      for (const job of training.codingJobs || []) {
        await this.codingJobVariableRepository.delete({ coding_job_id: job.id });
        this.logger.log(`Deleted coding job variables for job ${job.id}`);
      }

      for (const job of training.codingJobs || []) {
        await this.codingJobCoderRepository.delete({ coding_job_id: job.id });
        this.logger.log(`Deleted coding job coders for job ${job.id}`);
      }

      const jobsDeleted = training.codingJobs?.length || 0;
      if (jobsDeleted > 0) {
        await this.codingJobRepository.delete({ training_id: trainingId });
        this.logger.log(`Deleted ${jobsDeleted} coding jobs for training ${trainingId}`);
      }

      await this.coderTrainingRepository.delete(trainingId);
      this.logger.log(`Deleted coder training ${trainingId}`);

      return {
        success: true,
        message: `Successfully deleted coder training "${training.label}" with ${jobsDeleted} associated jobs`
      };
    } catch (error) {
      const errorMessage = `Error deleting coder training: ${error.message}`;
      this.logger.error(errorMessage, error.stack);
      return {
        success: false,
        message: errorMessage
      };
    }
  }
}
