import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ResponseEntity } from '../../workspaces/entities/response.entity';
import { Unit } from '../../workspaces/entities/unit.entity';
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
    // Build the query
    const query = this.responseRepository
      .createQueryBuilder('response')
      .innerJoin('response.unit', 'unit')
      .innerJoin('unit.booklet', 'booklet')
      .innerJoin('booklet.person', 'person')
      .innerJoin('booklet.bookletinfo', 'bookletinfo')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true });

    // Add filters
    if (unitId) {
      query.andWhere('unit.id = :unitId', { unitId });
    }

    if (variableId) {
      query.andWhere('response.variableid LIKE :variableId', { variableId: `%${variableId}%` });
    }

    // Get distinct combinations of unit name and variable ID
    const variableCombosQuery = query.clone()
      .select('unit.id', 'unitId')
      .addSelect('unit.name', 'unitName')
      .addSelect('response.variableid', 'variableId')
      .distinct(true)
      .orderBy('unit.name', 'ASC')
      .addOrderBy('response.variableid', 'ASC');

    // Execute the query to get variable combinations
    const variableCombosResult = await variableCombosQuery.getRawMany();
    const variableCombos = variableCombosResult.map(result => ({
      unitId: Number(result.unitId),
      unitName: result.unitName,
      variableId: result.variableId
    }));

    // If no variable combinations found, return empty result
    if (variableCombos.length === 0) {
      return {
        variableCombos: [],
        frequencies: {},
        total: 0
      };
    }

    // Get total count of distinct variable combinations
    const totalQuery = query.clone()
      .select("COUNT(DISTINCT CONCAT(unit.id, ':', response.variableid))", 'count');
    const totalResult = await totalQuery.getRawOne();
    const total = parseInt(totalResult.count, 10);

    // Get frequencies for each variable combination
    const frequencies: { [key: string]: VariableFrequencyDto[] } = {};

    // Process each variable combination
    for (const combo of variableCombos) {
      // Create a unique key for this combination
      const comboKey = `${combo.unitId}:${combo.variableId}`;

      // Get all values for this variable combination
      const valuesQuery = query.clone()
        .select('response.value', 'value')
        .addSelect('COUNT(*)', 'count')
        .andWhere('unit.id = :unitId', { unitId: combo.unitId })
        .andWhere('response.variableid = :varId', { varId: combo.variableId })
        .groupBy('response.value')
        .orderBy('count', 'DESC');

      const valuesResult = await valuesQuery.getRawMany();

      const totalResponses = valuesResult.reduce((sum, result) => sum + parseInt(result.count, 10), 0);

      // Map to DTOs
      frequencies[comboKey] = valuesResult.map(result => ({
        unitId: combo.unitId,
        unitName: combo.unitName,
        variableId: combo.variableId,
        value: result.value || '',
        count: parseInt(result.count, 10),
        percentage: (parseInt(result.count, 10) / totalResponses) * 100
      }));
    }

    return {
      variableCombos,
      frequencies,
      total
    };
  }
}
