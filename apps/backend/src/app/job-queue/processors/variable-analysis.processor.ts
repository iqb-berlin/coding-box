import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ResponseEntity } from '../../database/entities/response.entity';
import { VariableAnalysisJobData } from '../job-queue.service';
import { VariableAnalysisResultDto, VariableCombo } from '../../admin/variable-analysis/dto/variable-analysis-result.dto';
import { VariableFrequencyDto } from '../../admin/variable-analysis/dto/variable-frequency.dto';
import {
  applyResolvedExclusionsToQuery,
  WorkspaceExclusionService
} from '../../database/services/workspace/workspace-exclusion.service';

@Processor('variable-analysis')
export class VariableAnalysisProcessor {
  private readonly logger = new Logger(VariableAnalysisProcessor.name);

  private readonly MAX_VALUES_PER_VARIABLE = 20;

  constructor(
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    private workspaceExclusionService: WorkspaceExclusionService
  ) { }

  @Process()
  async process(job: Job<VariableAnalysisJobData>): Promise<VariableAnalysisResultDto> {
    this.logger.log(`Processing variable analysis job ${job.id} for workspace ${job.data.workspaceId}`);

    try {
      await job.progress(0);

      const workspaceId = job.data.workspaceId;
      const unitId = job.data.unitId;
      const variableId = job.data.variableId;
      const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);

      // Build the query
      const query = this.responseRepository
        .createQueryBuilder('response')
        .innerJoin('response.unit', 'unit')
        .innerJoin('unit.booklet', 'booklet')
        .innerJoin('booklet.person', 'person')
        .innerJoin('booklet.bookletinfo', 'bookletinfo')
        .where('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('person.consider = :consider', { consider: true });
      applyResolvedExclusionsToQuery(query, exclusions);

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
      const variableCombos: VariableCombo[] = variableCombosResult.map(result => ({
        unitId: Number(result.unitId),
        unitName: result.unitName,
        variableId: result.variableId,
        totalCount: 0,
        emptyCount: 0,
        emptyPercentage: 0,
        distinctValueCount: 0,
        statusCounts: []
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

      const total = variableCombos.length;

      const frequencies: { [key: string]: VariableFrequencyDto[] } = {};
      const comboByKey = new Map<string, VariableCombo>();
      variableCombos.forEach(combo => {
        const comboKey = `${combo.unitId}:${combo.variableId}`;
        comboByKey.set(comboKey, combo);
        frequencies[comboKey] = [];
      });

      await job.progress(25);

      const summaryRows = await query.clone()
        .select('unit.id', 'unitId')
        .addSelect('response.variableid', 'variableId')
        .addSelect('COUNT(*)', 'totalCount')
        .addSelect("SUM(CASE WHEN response.value IS NULL OR response.value = '' THEN 1 ELSE 0 END)", 'emptyCount')
        .addSelect("COUNT(DISTINCT COALESCE(response.value, ''))", 'distinctValueCount')
        .groupBy('unit.id')
        .addGroupBy('response.variableid')
        .getRawMany();

      for (const row of summaryRows) {
        const combo = comboByKey.get(`${Number(row.unitId)}:${row.variableId}`);

        if (combo) {
          combo.totalCount = parseInt(row.totalCount, 10);
          combo.emptyCount = parseInt(row.emptyCount, 10);
          combo.distinctValueCount = parseInt(row.distinctValueCount, 10);
        }
      }

      await job.progress(40);

      const topValuesQuery = query.clone()
        .select('unit.id', 'unitId')
        .addSelect('unit.name', 'unitName')
        .addSelect('response.variableid', 'variableId')
        .addSelect("COALESCE(response.value, '')", 'value')
        .addSelect('COUNT(*)', 'count')
        .groupBy('unit.id')
        .addGroupBy('unit.name')
        .addGroupBy('response.variableid')
        .addGroupBy("COALESCE(response.value, '')")
        .orderBy('unit.name', 'ASC')
        .addOrderBy('response.variableid', 'ASC')
        .addOrderBy('count', 'DESC');

      const [topValuesSql, topValuesParameters] = topValuesQuery.getQueryAndParameters();
      const maxValuesParameter = `$${topValuesParameters.length + 1}`;
      const valueRows = await this.responseRepository.query(
        `
          SELECT ranked_values.*
          FROM (
            SELECT
              grouped_values.*,
              ROW_NUMBER() OVER (
                PARTITION BY grouped_values."unitId", grouped_values."variableId"
                ORDER BY grouped_values."count" DESC, grouped_values."value" ASC
              ) AS "rank"
            FROM (${topValuesSql}) grouped_values
          ) ranked_values
          WHERE ranked_values."rank" <= ${maxValuesParameter}
          ORDER BY ranked_values."unitName" ASC, ranked_values."variableId" ASC, ranked_values."count" DESC
        `,
        [...topValuesParameters, this.MAX_VALUES_PER_VARIABLE]
      );

      for (const row of valueRows) {
        const unitIdNumber = Number(row.unitId);
        const comboKey = `${unitIdNumber}:${row.variableId}`;
        const combo = comboByKey.get(comboKey);

        if (combo) {
          const count = parseInt(row.count, 10);
          frequencies[comboKey].push({
            unitId: unitIdNumber,
            unitName: row.unitName,
            variableId: row.variableId,
            value: row.value || '',
            count,
            percentage: 0
          });
        }
      }

      variableCombos.forEach(combo => {
        const comboKey = `${combo.unitId}:${combo.variableId}`;
        const totalResponses = combo.totalCount || 0;
        combo.emptyPercentage = totalResponses > 0 ? ((combo.emptyCount || 0) / totalResponses) * 100 : 0;
        frequencies[comboKey] = frequencies[comboKey].map(item => ({
          ...item,
          percentage: totalResponses > 0 ? (item.count / totalResponses) * 100 : 0
        }));
      });

      await job.progress(70);

      const statusRows = await query.clone()
        .select('unit.id', 'unitId')
        .addSelect('response.variableid', 'variableId')
        .addSelect('response.status', 'status')
        .addSelect('COUNT(*)', 'count')
        .groupBy('unit.id')
        .addGroupBy('response.variableid')
        .addGroupBy('response.status')
        .orderBy('unit.id', 'ASC')
        .addOrderBy('response.variableid', 'ASC')
        .addOrderBy('count', 'DESC')
        .getRawMany();

      for (const row of statusRows) {
        const combo = comboByKey.get(`${Number(row.unitId)}:${row.variableId}`);

        if (combo) {
          const count = parseInt(row.count, 10);
          const totalResponses = combo.totalCount || 0;
          combo.statusCounts = [
            ...(combo.statusCounts || []),
            {
              status: Number(row.status),
              count,
              percentage: totalResponses > 0 ? (count / totalResponses) * 100 : 0
            }
          ];
        }
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
