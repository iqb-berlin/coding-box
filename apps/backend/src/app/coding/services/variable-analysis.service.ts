import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VariableFrequencyDto } from '../../admin/variable-analysis/dto/variable-frequency.dto';
import { VariableAnalysisResultDto } from '../../admin/variable-analysis/dto/variable-analysis-result.dto';
import { VariableAnalysisJob } from '../entities/variable-analysis-job.entity';
import { WorkspacesFacadeService } from '../../workspaces/services/workspaces-facade.service';

@Injectable()
export class VariableAnalysisService {
  private readonly logger = new Logger(VariableAnalysisService.name);

  constructor(
    private workspacesFacadeService: WorkspacesFacadeService,
    @InjectRepository(VariableAnalysisJob)
    private jobRepository: Repository<VariableAnalysisJob>
  ) {}

  async createAnalysisJob(
    workspaceId: number,
    unitId?: number,
    variableId?: string
  ): Promise<VariableAnalysisJob> {
    const job = this.jobRepository.create({
      workspace_id: workspaceId,
      unit_id: unitId,
      variable_id: variableId,
      status: 'pending'
    });

    const savedJob = await this.jobRepository.save(job);
    this.logger.log(`Created variable analysis job with ID ${savedJob.id}`);

    this.processAnalysisJob(savedJob.id).catch(error => {
      this.logger.error(`Error processing job ${savedJob.id}: ${error.message}`, error.stack);
    });

    return savedJob;
  }

  async getAnalysisJob(jobId: number, workspaceId?: number): Promise<VariableAnalysisJob> {
    const whereClause: { id: number; workspace_id?: number } = { id: jobId };

    if (workspaceId !== undefined) {
      whereClause.workspace_id = workspaceId;
    }

    const job = await this.jobRepository.findOne({ where: whereClause });
    if (!job) {
      if (workspaceId !== undefined) {
        throw new Error(`Job with ID ${jobId} not found in workspace ${workspaceId}`);
      } else {
        throw new Error(`Job with ID ${jobId} not found`);
      }
    }
    return job;
  }

  async getAnalysisResults(jobId: number, workspaceId?: number): Promise<VariableAnalysisResultDto> {
    const job = await this.getAnalysisJob(jobId, workspaceId);

    if (job.status !== 'completed') {
      throw new Error(`Job with ID ${jobId} is not completed (status: ${job.status})`);
    }

    if (!job.result) {
      throw new Error(`Job with ID ${jobId} has no results`);
    }

    try {
      return JSON.parse(job.result) as VariableAnalysisResultDto;
    } catch (error) {
      this.logger.error(`Error parsing results for job ${jobId}: ${error.message}`, error.stack);
      throw new Error(`Error parsing results for job ${jobId}`);
    }
  }

  async getAnalysisJobs(workspaceId: number): Promise<VariableAnalysisJob[]> {
    return this.jobRepository.find({
      where: { workspace_id: workspaceId },
      order: { created_at: 'DESC' }
    });
  }

  private async processAnalysisJob(jobId: number): Promise<void> {
    try {
      // Get the job without workspace filtering since this is an internal method
      const job = await this.getAnalysisJob(jobId);

      job.status = 'processing';
      await this.jobRepository.save(job);

      const result = await this.getVariableFrequencies(
        job.workspace_id,
        job.unit_id,
        job.variable_id
      );

      // Update job with result
      job.result = JSON.stringify(result);
      job.status = 'completed';
      await this.jobRepository.save(job);

      this.logger.log(`Completed variable analysis job with ID ${jobId}`);
    } catch (error) {
      try {
        // Try to get the job again in case it was deleted
        const job = await this.getAnalysisJob(jobId);
        job.error = error.message;
        job.status = 'failed';
        await this.jobRepository.save(job);
      } catch (innerError) {
        // If we can't get the job, just log the error
        this.logger.error(`Failed to update job ${jobId} with error: ${innerError.message}`, innerError.stack);
      }

      this.logger.error(`Failed to process job ${jobId}: ${error.message}`, error.stack);
    }
  }

  async getVariableFrequencies(
    workspaceId: number,
    unitId?: number,
    variableId?: string
  ): Promise<VariableAnalysisResultDto> {
    const rawResults = await this.workspacesFacadeService.getVariableFrequencies(workspaceId, unitId, variableId);

    if (rawResults.length === 0) {
      return {
        variableCombos: [],
        frequencies: {},
        total: 0
      };
    }

    interface RawFrequencyResult {
      unitId: number;
      unitName: string;
      variableId: string;
      values: { value: string; count: string }[];
    }

    const typedResults = rawResults as unknown as RawFrequencyResult[];

    const variableCombos = typedResults.map(r => ({
      unitId: Number(r.unitId),
      unitName: r.unitName,
      variableId: r.variableId
    }));

    const frequencies: { [key: string]: VariableFrequencyDto[] } = {};
    typedResults.forEach(r => {
      const comboKey = `${r.unitId}:${r.variableId}`;
      const totalResponses = r.values.reduce((sum, val) => sum + parseInt(val.count, 10), 0);

      frequencies[comboKey] = r.values.map(val => ({
        unitId: Number(r.unitId),
        unitName: r.unitName,
        variableId: r.variableId,
        value: val.value || '',
        count: parseInt(val.count, 10),
        percentage: (parseInt(val.count, 10) / totalResponses) * 100
      }));
    });

    return {
      variableCombos,
      frequencies,
      total: variableCombos.length
    };
  }
}
