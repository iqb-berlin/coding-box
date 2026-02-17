import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ResponseEntity } from '../../database/entities/response.entity';
import { VariableAnalysisJobData } from '../job-queue.service';
import { VariableAnalysisResultDto } from '../../admin/variable-analysis/dto/variable-analysis-result.dto';
import { VariableFrequencyDto } from '../../admin/variable-analysis/dto/variable-frequency.dto';

@Processor('variable-analysis')
export class VariableAnalysisProcessor {
  private readonly logger = new Logger(VariableAnalysisProcessor.name);

  constructor(
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>
  ) { }

  @Process()
  async process(job: Job<VariableAnalysisJobData>): Promise<VariableAnalysisResultDto> {
    this.logger.log(`Processing variable analysis job ${job.id} for workspace ${job.data.workspaceId}`);

    try {
      await job.progress(0);

      const workspaceId = job.data.workspaceId;
      const unitId = job.data.unitId;
      const variableId = job.data.variableId;

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
        await job.progress(100);
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

      // Process in chunks
      const CHUNK_SIZE = 10;
      for (let i = 0; i < variableCombos.length; i += CHUNK_SIZE) {
        const chunk = variableCombos.slice(i, i + CHUNK_SIZE);

        for (const combo of chunk) {
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

        // Update progress
        const processedCount = Math.min(i + CHUNK_SIZE, variableCombos.length);
        const progressPercentage = Math.round((processedCount / variableCombos.length) * 100);
        await job.progress(progressPercentage);
      }

      await job.progress(100);
      this.logger.log(`Job ${job.id} completed successfully`);

      return {
        variableCombos,
        frequencies,
        total
      };
    } catch (error) {
      this.logger.error(`Error processing job ${job.id}: ${error.message}`, error.stack);
      throw error;
    }
  }
}
