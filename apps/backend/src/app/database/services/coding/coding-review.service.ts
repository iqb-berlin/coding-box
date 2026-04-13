import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { statusStringToNumber } from '../../utils/response-status-converter';
import { ResponseEntity } from '../../entities/response.entity';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';
import { CodingStatisticsService } from './coding-statistics.service';

@Injectable()
export class CodingReviewService {
  private readonly logger = new Logger(CodingReviewService.name);

  constructor(
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    @InjectRepository(CodingJobUnit)
    private codingJobUnitRepository: Repository<CodingJobUnit>,
    private codingStatisticsService: CodingStatisticsService
  ) { }

  async getDoubleCodedVariablesForReview(
    workspaceId: number,
    page: number = 1,
    limit: number = 50,
    onlyConflicts: boolean = false,
    excludeTrainings: boolean = false,
    search?: string,
    coderId?: number,
    statusFilter?: string,
    resolvedFilter?: string,
    agreementFilter?: 'all' | 'match' | 'differ',
    includeRelations: boolean = true
  ): Promise<{
      data: Array<{
        responseId: number;
        unitName: string;
        variableId: string;
        personLogin: string;
        personCode: string;
        bookletName: string;
        givenAnswer: string;
        isResolved: boolean;
        coderResults: Array<{
          coderId: number;
          coderName: string;
          jobId: number;
          jobName: string;
          code: number | null;
          score: number | null;
          notes: string | null;
          supervisorComment: string | null;
          codedAt: Date;
        }>;
      }>;
      total: number;
      page: number;
      limit: number;
    }> {
    try {
      this.logger.log(
        `Getting double-coded variables for review in workspace ${workspaceId} (onlyConflicts=${onlyConflicts}, agreementFilter=${agreementFilter}, resolvedFilter=${resolvedFilter})`
      );
      const query = this.codingJobUnitRepository
        .createQueryBuilder('cju')
        .leftJoin('cju.coding_job', 'cj')
        .leftJoin('cju.response', 'resp')
        .leftJoin('resp.unit', 'u')
        .leftJoin('u.booklet', 'b')
        .leftJoin('b.person', 'p')
        .select('cju.response_id', 'responseId')
        .addSelect('COUNT(DISTINCT cju.coding_job_id)', 'jobCount')
        .addSelect('resp.status_v2', 'responseStatus')
        .where('cj.workspace_id = :workspaceId', { workspaceId })
        .groupBy('cju.response_id')
        .addGroupBy('resp.status_v2')
        .having('COUNT(DISTINCT cju.coding_job_id) > 1'); // Multiple jobs assigned to this response

      if (agreementFilter === 'differ') {
        // Conflict: at least two codes available and they differ.
        query.andHaving('COUNT(cju.code) > 1');
        query.andHaving('COUNT(DISTINCT cju.code) > 1');
      } else if (agreementFilter === 'match') {
        // Match: no differing non-null codes.
        query.andHaving('COUNT(DISTINCT cju.code) <= 1');
      } else if (onlyConflicts) {
        // Legacy behavior for older clients that still use onlyConflicts.
        query.andHaving('COUNT(cju.code) > 1');
        query.andHaving('COUNT(DISTINCT cju.code) > 1');
      }

      // Applied Status Filter Logic
      const completeStatus = statusStringToNumber('CODING_COMPLETE');
      if (resolvedFilter === 'resolved') {
        query.andWhere('resp.status_v2 = :completeStatus', { completeStatus });
      } else if (resolvedFilter === 'unresolved') {
        query.andWhere('resp.status_v2 != :completeStatus', { completeStatus });
      } else if ((agreementFilter === 'differ' || (onlyConflicts && agreementFilter !== 'match')) && !resolvedFilter) {
        // Legacy behavior: onlyConflicts hides resolved items by default if no status filter is set
        query.andWhere('resp.status_v2 != :completeStatus', { completeStatus });
      }

      if (excludeTrainings) {
        query.andWhere('cj.training_id IS NULL');
      }

      if (search && search.trim() !== '') {
        const searchPattern = `%${search.trim().toLowerCase()}%`;
        query.andWhere(
          '(LOWER(u.name) LIKE :searchPattern OR LOWER(resp.variableid) LIKE :searchPattern OR LOWER(p.login) LIKE :searchPattern OR LOWER(p.code) LIKE :searchPattern OR LOWER(p.group) LIKE :searchPattern)',
          { searchPattern }
        );
      }

      if (coderId) {
        // Filter by responses where the specific coder is involved
        query.andWhere(subQuery => {
          const sub = subQuery
            .subQuery()
            .select('cju2.response_id')
            .from('coding_job_unit', 'cju2')
            .leftJoin('cju2.coding_job', 'cj2')
            .leftJoin('cj2.codingJobCoders', 'cjc2')
            .where('cjc2.user_id = :coderId', { coderId })
            .getQuery();
          return `cju.response_id IN ${sub}`;
        });
      }

      if (statusFilter === 'done') {
        query.andHaving('COUNT(cju.code) = COUNT(cju.coding_job_id)');
      } else if (statusFilter === 'pending') {
        query.andHaving('COUNT(cju.code) < COUNT(cju.coding_job_id)');
      }

      const [sql, params] = query.getQueryAndParameters();
      const countResult = await this.codingJobUnitRepository.query(
        `SELECT COUNT(*) as "total" FROM (${sql}) "subquery"`,
        params
      );

      const total = parseInt(countResult[0]?.total || '0', 10);

      if (total === 0) {
        return {
          data: [],
          total: 0,
          page,
          limit
        };
      }

      query.orderBy('cju.response_id', 'ASC');
      query.offset((page - 1) * limit).limit(limit);
      const paginatedRawResults = await query.getRawMany();
      const paginatedResponseIds = paginatedRawResults.map(row => row.responseId);

      // Store raw status info to map it back after relation fetch
      const statusMap = new Map<number, number>();
      paginatedRawResults.forEach(row => {
        statusMap.set(row.responseId, row.responseStatus);
      });

      const relations = includeRelations ? [
        'coding_job',
        'coding_job.codingJobCoders',
        'coding_job.codingJobCoders.user',
        'response',
        'response.unit',
        'response.unit.booklet',
        'response.unit.booklet.person'
      ] : [
        'coding_job',
        'coding_job.codingJobCoders',
        'coding_job.codingJobCoders.user'
      ];

      const codingJobUnits = await this.codingJobUnitRepository.find({
        where: { response_id: In(paginatedResponseIds) },
        relations
      });

      const finalCodingJobUnits = codingJobUnits.filter(unit => {
        // Ignore orphaned coding_job_unit rows from deleted jobs.
        if (!unit.coding_job) {
          return false;
        }

        // Keep result assembly aligned with the workspace-scoped base query.
        if (unit.coding_job.workspace_id !== workspaceId) {
          return false;
        }

        if (excludeTrainings && unit.coding_job.training_id) {
          return false;
        }

        return true;
      });

      const responseGroups = new Map<
      number,
      {
        responseId: number;
        unitName: string;
        variableId: string;
        personLogin: string;
        personCode: string;
        bookletName: string;
        givenAnswer: string;
        isResolved: boolean;
        coderResults: Array<{
          coderId: number;
          coderName: string;
          jobId: number;
          jobName: string;
          code: number | null;
          score: number | null;
          notes: string | null;
          supervisorComment: string | null;
          codedAt: Date;
        }>;
      }
      >();

      for (const unit of finalCodingJobUnits) {
        const responseId = unit.response_id;

        if (!responseGroups.has(responseId)) {
          const responseStatus = statusMap.get(responseId);
          responseGroups.set(responseId, {
            responseId: responseId,
            unitName: unit.response?.unit?.name || '',
            variableId: unit.variable_id,
            personLogin: unit.response?.unit?.booklet?.person?.login || '',
            personCode: unit.response?.unit?.booklet?.person?.code || '',
            bookletName: unit.response?.unit?.booklet?.bookletinfo?.name || '',
            givenAnswer: unit.response?.value || '',
            isResolved: responseStatus === completeStatus,
            coderResults: []
          });
        }

        const group = responseGroups.get(responseId)!;

        const coder = unit.coding_job?.codingJobCoders?.[0];
        if (coder) {
          group.coderResults.push({
            coderId: coder.user_id,
            coderName: coder.user?.username || `Coder ${coder.user_id}`,
            jobId: unit.coding_job_id,
            jobName: unit.coding_job?.name || '',
            code: unit.code,
            score: unit.score,
            notes: unit.notes,
            supervisorComment: unit.supervisor_comment || null,
            codedAt: unit.created_at
          });
        }
      }

      const data = Array.from(responseGroups.values());

      this.logger.log(
        `Found ${total} double-coded variables for review in workspace ${workspaceId}, returning page ${page} with ${data.length} items`
      );

      return {
        data,
        total,
        page,
        limit
      };
    } catch (error) {
      this.logger.error(
        `Error getting double-coded variables for review: ${error.message}`,
        error.stack
      );
      throw new Error(
        'Could not get double-coded variables for review. Please check the database connection.'
      );
    }
  }

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
      this.logger.log(
        `Applying ${decisions.length} double-coded resolutions in workspace ${workspaceId}`
      );

      let appliedCount = 0;
      let failedCount = 0;
      let skippedCount = 0;

      await this.responseRepository.manager.transaction(async transactionalEntityManager => {
        for (const decision of decisions) {
          try {
            const selectedCodingJobUnit =
              await transactionalEntityManager.findOne(CodingJobUnit, {
                where: {
                  response_id: decision.responseId,
                  coding_job_id: decision.selectedJobId
                },
                relations: ['response', 'coding_job']
              });

            if (!selectedCodingJobUnit) {
              this.logger.warn(
                `Could not find coding_job_unit for responseId ${decision.responseId} and jobId ${decision.selectedJobId}`
              );
              skippedCount += 1;
              continue;
            }

            if (selectedCodingJobUnit.coding_job?.workspace_id !== workspaceId) {
              this.logger.warn(
                `Workspace mismatch for responseId ${decision.responseId}`
              );
              skippedCount += 1;
              continue;
            }

            const response = selectedCodingJobUnit.response;
            if (!response) {
              this.logger.warn(
                `Could not find response for responseId ${decision.responseId}`
              );
              skippedCount += 1;
              continue;
            }

            let updatedValue = response.value || '';
            const boundary = '\n\n--- ORIGINAL RESPONSE ---\n';

            if (updatedValue.includes(boundary)) {
              const parts = updatedValue.split(boundary);
              updatedValue = parts[parts.length - 1];
            }

            await transactionalEntityManager.update(
              CodingJobUnit,
              { response_id: decision.responseId },
              { supervisor_comment: null }
            );

            if (decision.resolutionComment && decision.resolutionComment.trim()) {
              selectedCodingJobUnit.supervisor_comment = decision.resolutionComment.trim();
              await transactionalEntityManager.save(CodingJobUnit, selectedCodingJobUnit);
            }

            response.status_v2 = statusStringToNumber('CODING_COMPLETE');
            response.code_v2 = selectedCodingJobUnit.code;
            response.score_v2 = selectedCodingJobUnit.score;
            response.value = updatedValue;

            await transactionalEntityManager.save(ResponseEntity, response);
            appliedCount += 1;

            this.logger.debug(
              `Applied resolution for responseId ${decision.responseId}: code=${selectedCodingJobUnit.code}, score=${selectedCodingJobUnit.score}`
            );
          } catch (error) {
            this.logger.error(
              `Error applying resolution for responseId ${decision.responseId}: ${error.message}`,
              error.stack
            );
            failedCount += 1;
          }
        }
      });

      const message = `Applied ${appliedCount} resolutions successfully. ${failedCount > 0 ? `${failedCount} failed.` : ''
      } ${skippedCount > 0 ? `${skippedCount} skipped.` : ''}`;
      this.logger.log(message);

      return {
        success: appliedCount > 0,
        appliedCount,
        failedCount,
        skippedCount,
        message
      };
    } catch (error) {
      this.logger.error(
        `Error applying double-coded resolutions: ${error.message}`,
        error.stack
      );
      throw new Error(
        'Could not apply double-coded resolutions. Please check the database connection.'
      );
    }
  }

  async getWorkspaceCohensKappaSummary(
    workspaceId: number,
    weightedMean: boolean = true,
    excludeTrainings: boolean = true
  ): Promise<{
      coderPairs: Array<{
        coder1Id: number;
        coder1Name: string;
        coder2Id: number;
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
        weightingMethod: 'weighted' | 'unweighted';
      };
    }> {
    try {
      this.logger.log(
        `Calculating workspace-wide Cohen's Kappa for double-coded incomplete variables in workspace ${workspaceId}${excludeTrainings ? ' (excluding trainings)' : ''}`
      );

      let totalDoubleCodedResponses = 0;
      let currentPage = 1;
      const batchSize = 1000;
      let hasMore = true;

      const coderPairData = new Map<
      string,
      {
        coder1Id: number;
        coder1Name: string;
        coder2Id: number;
        coder2Name: string;
        codes: Array<{ code1: number | null; code2: number | null }>;
      }
      >();

      const uniqueVariables = new Set<string>();
      const uniqueCoders = new Set<number>();

      while (hasMore) {
        const doubleCodedData = await this.getDoubleCodedVariablesForReview(
          workspaceId,
          currentPage,
          batchSize,
          false, // onlyConflicts = false
          excludeTrainings,
          undefined, // search
          undefined, // coderId
          undefined, // statusFilter
          undefined, // resolvedFilter
          undefined, // agreementFilter
          false // includeRelations = false
        );

        if (currentPage === 1) {
          totalDoubleCodedResponses = doubleCodedData.total;
        }

        for (const item of doubleCodedData.data) {
          uniqueVariables.add(`${item.unitName}:${item.variableId}`);

          const coders = item.coderResults;
          for (let i = 0; i < coders.length; i++) {
            for (let j = i + 1; j < coders.length; j++) {
              const coder1 = coders[i];
              const coder2 = coders[j];

              uniqueCoders.add(coder1.coderId);
              uniqueCoders.add(coder2.coderId);

              const pairKey =
                coder1.coderId < coder2.coderId ?
                  `${coder1.coderId}-${coder2.coderId}` :
                  `${coder2.coderId}-${coder1.coderId}`;

              if (!coderPairData.has(pairKey)) {
                coderPairData.set(pairKey, {
                  coder1Id:
                    coder1.coderId < coder2.coderId ?
                      coder1.coderId :
                      coder2.coderId,
                  coder1Name:
                    coder1.coderId < coder2.coderId ?
                      coder1.coderName :
                      coder2.coderName,
                  coder2Id:
                    coder1.coderId < coder2.coderId ?
                      coder2.coderId :
                      coder1.coderId,
                  coder2Name:
                    coder1.coderId < coder2.coderId ?
                      coder2.coderName :
                      coder1.coderName,
                  codes: []
                });
              }

              const pair = coderPairData.get(pairKey)!;
              if (coder1.coderId < coder2.coderId) {
                pair.codes.push({
                  code1: coder1.code,
                  code2: coder2.code
                });
              } else {
                pair.codes.push({
                  code1: coder2.code,
                  code2: coder1.code
                });
              }
            }
          }
        }

        if ((currentPage * batchSize) >= totalDoubleCodedResponses || doubleCodedData.data.length === 0) {
          hasMore = false;
        } else {
          currentPage += 1;
        }
      }

      const coderPairs = [];

      for (const pair of coderPairData.values()) {
        const kappaResults = this.codingStatisticsService.calculateCohensKappa([
          pair
        ]);

        if (kappaResults.length > 0) {
          const result = kappaResults[0];
          coderPairs.push(result);
        }
      }

      let averageKappa: number | null;

      if (weightedMean) {
        let totalWeightedKappa = 0;
        let totalWeight = 0;

        for (const result of coderPairs) {
          if (result.kappa !== null && !Number.isNaN(result.kappa)) {
            const weight = result.validPairs;
            totalWeightedKappa += result.kappa * weight;
            totalWeight += weight;
          }
        }

        averageKappa = totalWeight > 0 ? totalWeightedKappa / totalWeight : null;
      } else {
        let totalKappa = 0;
        let validKappaCount = 0;

        for (const result of coderPairs) {
          if (result.kappa !== null && !Number.isNaN(result.kappa)) {
            totalKappa += result.kappa;
            validKappaCount += 1;
          }
        }

        averageKappa = validKappaCount > 0 ? totalKappa / validKappaCount : null;
      }

      const workspaceSummary = {
        totalDoubleCodedResponses,
        totalCoderPairs: coderPairs.length,
        averageKappa: averageKappa !== null ? Math.round(averageKappa * 1000) / 1000 : null,
        variablesIncluded: uniqueVariables.size,
        codersIncluded: uniqueCoders.size,
        weightingMethod: (weightedMean ? 'weighted' : 'unweighted') as 'weighted' | 'unweighted'
      };

      this.logger.log(
        `Calculated workspace-wide Cohen's Kappa: ${coderPairs.length} coder pairs, ${uniqueVariables.size} variables, ${uniqueCoders.size} coders, average kappa: ${averageKappa}`
      );

      return {
        coderPairs,
        workspaceSummary
      };
    } catch (error) {
      this.logger.error(
        `Error calculating workspace-wide Cohen's Kappa: ${error.message}`,
        error.stack
      );
      throw new Error(
        "Could not calculate workspace-wide Cohen's Kappa. Please check the database connection."
      );
    }
  }
}
