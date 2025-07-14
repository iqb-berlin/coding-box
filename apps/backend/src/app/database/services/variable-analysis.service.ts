import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ResponseEntity } from '../entities/response.entity';
import { Unit } from '../entities/unit.entity';
import { VariableFrequencyDto } from '../../admin/variable-analysis/dto/variable-frequency.dto';
import { VariableAnalysisResultDto } from '../../admin/variable-analysis/dto/variable-analysis-result.dto';
import { VariableAnalysisJob } from '../entities/variable-analysis-job.entity';

@Injectable()
export class VariableAnalysisService {
  private readonly logger = new Logger(VariableAnalysisService.name);

  constructor(
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    @InjectRepository(Unit)
    private unitRepository: Repository<Unit>,
    @InjectRepository(VariableAnalysisJob)
    private jobRepository: Repository<VariableAnalysisJob>
  ) {}

  /**
   * Create a new variable analysis job
   * @param workspaceId The ID of the workspace
   * @param unitId Optional unit ID to filter by
   * @param variableId Optional variable ID to filter by
   * @returns The created job
   */
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

    // Start processing the job asynchronously
    this.processAnalysisJob(savedJob.id).catch(error => {
      this.logger.error(`Error processing job ${savedJob.id}: ${error.message}`, error.stack);
    });

    return savedJob;
  }

  /**
   * Get a variable analysis job by ID
   * @param jobId The ID of the job
   * @param workspaceId Optional workspace ID to filter by
   * @returns The job
   */
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

  /**
   * Get the results of a completed analysis job
   * @param jobId The ID of the job
   * @param workspaceId Optional workspace ID to filter by
   * @returns The analysis results
   */
  async getAnalysisResults(jobId: number, workspaceId?: number): Promise<VariableAnalysisResultDto> {
    // Get the job, optionally filtering by workspace
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

  /**
   * Get all analysis jobs for a workspace
   * @param workspaceId The ID of the workspace
   * @returns The jobs
   */
  async getAnalysisJobs(workspaceId: number): Promise<VariableAnalysisJob[]> {
    return this.jobRepository.find({
      where: { workspace_id: workspaceId },
      order: { created_at: 'DESC' }
    });
  }

  /**
   * Process a variable analysis job
   * @param jobId The ID of the job to process
   */
  private async processAnalysisJob(jobId: number): Promise<void> {
    try {
      // Get the job without workspace filtering since this is an internal method
      const job = await this.getAnalysisJob(jobId);

      // Update job status to processing
      job.status = 'processing';
      await this.jobRepository.save(job);

      // Perform the analysis
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

        // Update job with error
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

  /**
   * Get variable frequencies for a workspace
   * @param workspaceId The ID of the workspace
   * @param unitId Optional unit ID to filter by
   * @param variableId Optional variable ID to filter by
   * @param page Page number for pagination
   * @param limit Number of items per page
   * @returns The variable analysis result
   */
  async getVariableFrequencies(
    workspaceId: number,
    unitId?: number,
    variableId?: string,
    page: number = 1,
    limit: number = 50
  ): Promise<VariableAnalysisResultDto> {
    // Build the query
    const query = this.responseRepository
      .createQueryBuilder('response')
      .innerJoin('response.unit', 'unit')
      .innerJoin('unit.booklet', 'booklet')
      .innerJoin('booklet.person', 'person')
      .innerJoin('booklet.bookletinfo', 'bookletinfo');

    // Add filters
    if (unitId) {
      query.andWhere('unit.id = :unitId', { unitId });
    }

    if (variableId) {
      query.andWhere('response.variableId LIKE :variableId', { variableId: `%${variableId}%` });
    }

    // Get distinct variable IDs
    const variableIdsQuery = query.clone()
      .select('DISTINCT response.variableId', 'variableId')
      .orderBy('response.variableId', 'ASC');

    // Apply pagination to variable IDs
    const offset = (page - 1) * limit;
    variableIdsQuery.offset(offset).limit(limit);

    // Execute the query to get variable IDs
    const variableIdsResult = await variableIdsQuery.getRawMany();
    const variableIds = variableIdsResult.map(result => result.variableId);

    // If no variables found, return empty result
    if (variableIds.length === 0) {
      return {
        variables: [],
        frequencies: {},
        total: 0
      };
    }

    // Get total count of distinct variable IDs
    const totalQuery = query.clone()
      .select('COUNT(DISTINCT response.variableId)', 'count');
    const totalResult = await totalQuery.getRawOne();
    const total = parseInt(totalResult.count, 10);

    // Get frequencies for each variable
    const frequencies: { [key: string]: VariableFrequencyDto[] } = {};

    // Process each variable ID
    for (const varId of variableIds) {
      // Get all values for this variable
      const valuesQuery = query.clone()
        .select('response.value', 'value')
        .addSelect('COUNT(*)', 'count')
        .where('response.variableId = :varId', { varId })
        .groupBy('response.value')
        .orderBy('count', 'DESC');

      const valuesResult = await valuesQuery.getRawMany();

      const totalResponses = valuesResult.reduce((sum, result) => sum + parseInt(result.count, 10), 0);

      // Map to DTOs
      frequencies[varId] = valuesResult.map(result => ({
        variableId: varId,
        value: result.value || '',
        count: parseInt(result.count, 10),
        percentage: (parseInt(result.count, 10) / totalResponses) * 100
      }));
    }

    return {
      variables: variableIds,
      frequencies,
      total
    };
  }
}
