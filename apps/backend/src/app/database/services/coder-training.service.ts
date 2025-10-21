import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CodingJob } from '../entities/coding-job.entity';
import { CodingJobCoder } from '../entities/coding-job-coder.entity';
import { CodingJobVariable } from '../entities/coding-job-variable.entity';
import { CodingJobUnit } from '../entities/coding-job-unit.entity';
import { ResponseEntity } from '../entities/response.entity';
import { Unit } from '../entities/unit.entity';
import { statusStringToNumber } from '../utils/response-status-converter';

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
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    @InjectRepository(Unit)
    private unitRepository: Repository<Unit>
  ) {}

  private sampleResponses(
    responses: CoderTrainingResponse[],
    sampleCount: number
  ): CoderTrainingResponse[] {
    if (responses.length <= sampleCount) {
      return responses;
    }

    const shuffled = [...responses].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, sampleCount);
  }

  async generateCoderTrainingPackages(
    workspaceId: number,
    selectedCoders: { id: number; name: string }[],
    variableConfigs: { variableId: string; unitId: string; sampleCount: number }[]
  ): Promise<TrainingPackage[]> {
    this.logger.log(`Generating coder training packages for workspace ${workspaceId} with ${selectedCoders.length} coders and ${variableConfigs.length} variable configs`);

    const result: TrainingPackage[] = [];

    for (const coder of selectedCoders) {
      const coderId = coder.id;
      const coderName = coder.name;
      const coderResponses: CoderTrainingResponse[] = [];

      this.logger.log(`Processing coder ${coderName} (ID: ${coderId})`);

      for (const config of variableConfigs) {
        const variableId = config.variableId;
        const unitId = config.unitId;
        const sampleCount = config.sampleCount;

        this.logger.log(`Querying CODING_INCOMPLETE responses for unit ${unitId}, variable ${variableId}`);

        // Query responses with CODING_INCOMPLETE status for this variable/unit combination
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

        // Filter responses by the specific unit
        const unitResponses = responses.filter(r => r.unit?.alias === unitId);

        this.logger.log(`Found ${unitResponses.length} CODING_INCOMPLETE responses for unit ${unitId}, variable ${variableId}`);

        // Transform responses to the expected format
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

        // Sample the responses
        const sampledResponses = this.sampleResponses(transformedResponses, sampleCount);
        coderResponses.push(...sampledResponses);

        this.logger.log(`Selected ${sampledResponses.length} sample responses for unit ${unitId}, variable ${variableId}`);
      }

      result.push({
        coderId,
        coderName,
        responses: coderResponses
      });

      this.logger.log(`Generated training package for coder ${coderName} with ${coderResponses.length} responses`);
    }

    this.logger.log(`Completed generating coder training packages. Total packages: ${result.length}`);
    return result;
  }

  async createCoderTrainingJobs(
    workspaceId: number,
    selectedCoders: { id: number; name: string }[],
    variableConfigs: { variableId: string; unitId: string; sampleCount: number }[]
  ): Promise<{ success: boolean; jobsCreated: number; message: string; jobs: TrainingJob[] }> {
    try {
      this.logger.log(`Creating coder training jobs for workspace ${workspaceId} with ${selectedCoders.length} coders`);

      const jobs: TrainingJob[] = [];
      let jobsCreated = 0;

      for (const coder of selectedCoders) {
        const coderId = coder.id;
        const coderName = coder.name;

        this.logger.log(`Creating training job for coder ${coderName} (ID: ${coderId})`);

        // Create the main coding job
        const codingJob = new CodingJob();
        codingJob.name = `Coder Training - ${coderName}`;
        codingJob.workspace_id = workspaceId;
        codingJob.description = `Training job for coder ${coderName} generated on ${new Date().toISOString()}`;
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

        // Add coder to the job
        const codingJobCoder = new CodingJobCoder();
        codingJobCoder.coding_job_id = jobId;
        codingJobCoder.user_id = coderId;
        await this.codingJobCoderRepository.save(codingJobCoder);

        // Add variables to the job for each configuration
        for (const config of variableConfigs) {
          const variableId = config.variableId;
          const unitId = config.unitId;

          // Get unit ID from alias
          const unit = await this.unitRepository.findOne({
            where: { alias: unitId, booklet: { person: { workspace_id: workspaceId } } },
            relations: ['booklet']
          });

          if (!unit) {
            this.logger.warn(`Unit with alias ${unitId} not found in workspace ${workspaceId}`);
            continue;
          }

          // Add variable to the job
          const codingJobVariable = new CodingJobVariable();
          codingJobVariable.coding_job_id = jobId;
          codingJobVariable.variable_id = variableId;
          codingJobVariable.unit_name = unit.name;
          await this.codingJobVariableRepository.save(codingJobVariable);

          // Add unit to the job
          const codingJobUnit = new CodingJobUnit();
          codingJobUnit.coding_job_id = jobId;
          await this.codingJobUnitRepository.save(codingJobUnit);

          this.logger.log(`Added variable ${variableId} and unit ${unitId} to training job ${jobId} for coder ${coderName}`);
        }

        this.logger.log(`Successfully created training job ${jobId} for coder ${coderName}`);
      }

      const message = `Successfully created ${jobsCreated} coder training jobs`;

      this.logger.log(message);
      return {
        success: true,
        jobsCreated,
        message,
        jobs
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
}
