import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { statusStringToNumber } from '../../workspaces/utils/response-status-converter';
import { WorkspacesFacadeService } from '../../workspaces/services/workspaces-facade.service';
import { CodingJobUnit } from '../entities/coding-job-unit.entity';
import { CodingStatisticsService } from './coding-statistics.service';

/**
 * DoubleCodingService
 *
 * Handles the review and resolution of double-coded responses,
 * including inter-rater reliability calculations (Cohen's Kappa).
 *
 * Extracted from WorkspaceCodingService to improve maintainability.
 */
@Injectable()
export class DoubleCodingService {
  private readonly logger = new Logger(DoubleCodingService.name);

  constructor(
    private readonly workspacesFacadeService: WorkspacesFacadeService,
    private readonly codingStatisticsService: CodingStatisticsService,
    @InjectRepository(CodingJobUnit)
    private readonly codingJobUnitRepository: Repository<CodingJobUnit>
  ) {}

  /**
   * Get all responses that have been double-coded and require review
   */
  async getDoubleCodedVariablesForReview(
    workspaceId: number,
    page: number = 1,
    limit: number = 50
  ): Promise<{
      data: Array<{
        responseId: number;
        unitName: string;
        variableId: string;
        personLogin: string;
        personCode: string;
        bookletName: string;
        givenAnswer: string;
        coderResults: Array<{
          coderId: number;
          coderName: string;
          jobId: number;
          code: number | null;
          score: number | null;
          notes: string | null;
          codedAt: Date;
        }>;
      }>;
      total: number;
      page: number;
      limit: number;
    }> {
    try {
      this.logger.log(`Getting double-coded variables for review in workspace ${workspaceId}`);

      const doubleCodedResponseIds = await this.codingJobUnitRepository
        .createQueryBuilder('cju')
        .select('cju.response_id', 'responseId')
        .addSelect('COUNT(DISTINCT cju.coding_job_id)', 'jobCount')
        .leftJoin('cju.coding_job', 'cj')
        .where('cj.workspace_id = :workspaceId', { workspaceId })
        .andWhere('cju.code IS NOT NULL')
        .groupBy('cju.response_id')
        .having('COUNT(DISTINCT cju.coding_job_id) > 1')
        .getRawMany();

      const responseIds = doubleCodedResponseIds.map(row => row.responseId);
      if (responseIds.length === 0) {
        return {
          data: [], total: 0, page, limit
        };
      }

      const total = responseIds.length;
      const startIndex = (page - 1) * limit;
      const paginatedResponseIds = responseIds.slice(startIndex, startIndex + limit);

      const codingJobUnits = await this.codingJobUnitRepository.find({
        where: { response_id: In(paginatedResponseIds) },
        relations: [
          'coding_job',
          'coding_job.codingJobCoders',
          'coding_job.codingJobCoders.user',
          'response',
          'response.unit',
          'response.unit.booklet',
          'response.unit.booklet.person'
        ]
      });

      const responseGroups = new Map<number, {
        responseId: number;
        unitName: string;
        variableId: string;
        personLogin: string;
        personCode: string;
        bookletName: string;
        givenAnswer: string;
        coderResults: Array<{
          coderId: number;
          coderName: string;
          jobId: number;
          code: number | null;
          score: number | null;
          notes: string | null;
          codedAt: Date;
        }>;
      }>();
      codingJobUnits.forEach(unit => {
        const responseId = unit.response_id;
        if (!responseGroups.has(responseId)) {
          responseGroups.set(responseId, {
            responseId,
            unitName: unit.response?.unit?.name || '',
            variableId: unit.variable_id,
            personLogin: unit.response?.unit?.booklet?.person?.login || '',
            personCode: unit.response?.unit?.booklet?.person?.code || '',
            bookletName: unit.response?.unit?.booklet?.bookletinfo?.name || 'Unknown',
            givenAnswer: unit.response?.value || '',
            coderResults: []
          });
        }

        const group = responseGroups.get(responseId);
        const coder = unit.coding_job?.codingJobCoders?.[0];
        if (coder) {
          group.coderResults.push({
            coderId: coder.user_id,
            coderName: coder.user?.username || `Coder ${coder.user_id}`,
            jobId: unit.coding_job_id,
            code: unit.code,
            score: unit.score,
            notes: unit.notes,
            codedAt: unit.created_at
          });
        }
      });

      return {
        data: Array.from(responseGroups.values()), total, page, limit
      };
    } catch (error) {
      this.logger.error(`Error getting double-coded variables: ${error.message}`, error.stack);
      throw new Error('Could not get double-coded variables for review.');
    }
  }

  /**
   * Apply resolutions for double-coded responses
   */
  async applyDoubleCodedResolutions(
    workspaceId: number,
    decisions: Array<{
      responseId: number;
      selectedJobId: number;
      resolutionComment?: string;
    }>
  ): Promise<{
      success: boolean;
      appliedCount: number;
      failedCount: number;
      skippedCount: number;
      message: string;
    }> {
    try {
      let appliedCount = 0;
      let failedCount = 0;
      let skippedCount = 0;

      for (const decision of decisions) {
        try {
          const selected = await this.codingJobUnitRepository.findOne({
            where: { response_id: decision.responseId, coding_job_id: decision.selectedJobId },
            relations: ['response', 'coding_job']
          });

          if (!selected || selected.coding_job?.workspace_id !== workspaceId || !selected.response) {
            skippedCount += 1;
            continue;
          }

          const response = selected.response;
          let updatedValue = response.value || '';
          if (decision.resolutionComment?.trim()) {
            const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 16);
            updatedValue = `[RESOLUTION - ${timestamp}]: ${decision.resolutionComment.trim()}\n${updatedValue}`;
          }

          response.status_v2 = statusStringToNumber('CODING_COMPLETE');
          response.code_v2 = selected.code;
          response.score_v2 = selected.score;
          response.value = updatedValue;

          await this.workspacesFacadeService.saveResponse(response);
          appliedCount += 1;
        } catch (error) {
          this.logger.error(`Error resolving response ${decision.responseId}: ${error.message}`);
          failedCount += 1;
        }
      }

      return {
        success: appliedCount > 0,
        appliedCount,
        failedCount,
        skippedCount,
        message: `Applied ${appliedCount} resolutions successfully.`
      };
    } catch (error) {
      this.logger.error(`Error applying resolutions: ${error.message}`, error.stack);
      throw new Error('Could not apply resolutions.');
    }
  }

  /**
   * Get the count of results that have been applied (v2 status set)
   */
  async getAppliedResultsCount(
    workspaceId: number,
    incompleteVariables: { unitName: string; variableId: string }[]
  ): Promise<number> {
    if (incompleteVariables.length === 0) return 0;

    let totalAppliedCount = 0;
    const batchSize = 50;
    for (let i = 0; i < incompleteVariables.length; i += batchSize) {
      const batch = incompleteVariables.slice(i, i + batchSize);
      const conditions = batch
        .map(v => `(unit.name = '${v.unitName.replace(/'/g, "''")}' AND response.variableid = '${v.variableId.replace(/'/g, "''")}')`)
        .join(' OR ');

      const query = `
        SELECT COUNT(response.id) as applied_count
        FROM response
        INNER JOIN unit ON response.unitid = unit.id
        INNER JOIN booklet ON unit.bookletid = booklet.id
        INNER JOIN persons person ON booklet.personid = person.id
        WHERE person.workspace_id = $1
          AND person.consider = true
          AND response.status_v1 = $2
          AND (${conditions})
          AND response.status_v2 IN ($3, $4, $5)
      `;

      const result = await this.workspacesFacadeService.queryResponses(query, [
        workspaceId,
        statusStringToNumber('CODING_INCOMPLETE'),
        statusStringToNumber('CODING_COMPLETE'),
        statusStringToNumber('INVALID'),
        statusStringToNumber('CODING_ERROR')
      ]);

      totalAppliedCount += parseInt(result[0]?.applied_count || '0', 10);
    }

    return totalAppliedCount;
  }

  /**
   * Calculate Cohen's Kappa summary for a workspace
   */
  async getWorkspaceCohensKappaSummary(workspaceId: number): Promise<{
    coderPairs: Array<{
      coder1Id: number;
      coder2Id: number;
      coder1Name: string;
      coder2Name: string;
      kappa: number | null;
      agreement: number;
      totalSharedResponses: number;
      validPairs: number;
      interpretation: string;
    }>;
    workspaceSummary: {
      totalDoubleCodedResponses: number;
      totalCoderPairs: number;
      averageKappa: number | null;
      variablesIncluded: number;
      codersIncluded: number;
    };
  }> {
    const doubleCodedData = await this.getDoubleCodedVariablesForReview(workspaceId, 1, 10000);
    if (doubleCodedData.total === 0) {
      return {
        coderPairs: [],
        workspaceSummary: {
          totalDoubleCodedResponses: 0, totalCoderPairs: 0, averageKappa: null, variablesIncluded: 0, codersIncluded: 0
        }
      };
    }

    const coderPairData = new Map<string, {
      coder1Id: number;
      coder1Name: string;
      coder2Id: number;
      coder2Name: string;
      codes: Array<{ code1: number | null; code2: number | null }>;
    }>();
    const uniqueVariables = new Set<string>();
    const uniqueCoders = new Set<number>();

    doubleCodedData.data.forEach(item => {
      uniqueVariables.add(`${item.unitName}:${item.variableId}`);
      const coders = item.coderResults;
      for (let i = 0; i < coders.length; i++) {
        for (let j = i + 1; j < coders.length; j++) {
          const c1 = coders[i];
          const c2 = coders[j];
          uniqueCoders.add(c1.coderId);
          uniqueCoders.add(c2.coderId);

          const pairKey = c1.coderId < c2.coderId ? `${c1.coderId}-${c2.coderId}` : `${c2.coderId}-${c1.coderId}`;
          if (!coderPairData.has(pairKey)) {
            coderPairData.set(pairKey, {
              coder1Id: Math.min(c1.coderId, c2.coderId),
              coder1Name: c1.coderId < c2.coderId ? c1.coderName : c2.coderName,
              coder2Id: Math.max(c1.coderId, c2.coderId),
              coder2Name: c1.coderId < c2.coderId ? c2.coderName : c1.coderName,
              codes: []
            });
          }
          const pair = coderPairData.get(pairKey);
          pair.codes.push({
            code1: c1.coderId < c2.coderId ? c1.code : c2.code,
            code2: c1.coderId < c2.coderId ? c2.code : c1.code
          });
        }
      }
    });

    const coderPairs = Array.from(coderPairData.values()).map(pair => {
      const kappaResults = this.codingStatisticsService.calculateCohensKappa([pair]);
      return kappaResults[0];
    });

    const validKappas = coderPairs.filter(p => p.kappa !== null && !Number.isNaN(p.kappa));
    const averageKappa = validKappas.length > 0 ? validKappas.reduce((s, p) => s + p.kappa, 0) / validKappas.length : null;

    return {
      coderPairs,
      workspaceSummary: {
        totalDoubleCodedResponses: doubleCodedData.total,
        totalCoderPairs: coderPairs.length,
        averageKappa: averageKappa !== null ? Math.round(averageKappa * 1000) / 1000 : null,
        variablesIncluded: uniqueVariables.size,
        codersIncluded: uniqueCoders.size
      }
    };
  }
}
