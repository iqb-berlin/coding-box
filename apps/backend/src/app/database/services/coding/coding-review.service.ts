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
        `Getting double-coded variables for review in workspace ${workspaceId} (onlyConflicts=${onlyConflicts})`
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
        .where('cju.workspace_id = :workspaceId', { workspaceId })
        .groupBy('cju.response_id')
        .having('COUNT(DISTINCT cju.coding_job_id) > 1'); // Multiple jobs assigned to this response

      if (onlyConflicts) {
        // A conflict exists if there are different codes for the same response.
        // We use COALESCE to handle NULL codes as a distinct value (-999999).
        // If all codes are the same, COUNT(DISTINCT ...) will be 1.
        // If there are differences, it will be > 1.
        query.andHaving('COUNT(DISTINCT COALESCE(cju.code, -999999)) > 1');

        // Also permanently hide items from the conflict list if a supervisor already resolved them
        query.andWhere('resp.status_v2 != :completeStatus', {
          completeStatus: statusStringToNumber('CODING_COMPLETE')
        });
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
        // We use a subquery to find all response IDs that have a job for this coder
        query.andWhere(subQuery => {
          const sub = subQuery
            .subQuery()
            .select('cju2.response_id')
            .from('coding_job_unit', 'cju2')
            .leftJoin('cju2.coding_job', 'cj2')
            .where('cj2.coder_id = :coderId', { coderId })
            .getQuery();
          return `cju.response_id IN ${sub}`;
        });
      }

      if (statusFilter === 'done') {
        // At least one result must exist and COUNT(code) must match COUNT(total jobs)
        query.andHaving('COUNT(cju.code) = COUNT(cju.coding_job_id)');
      } else if (statusFilter === 'pending') {
        // At least one coder hasn't submitted a code
        query.andHaving('COUNT(cju.code) < COUNT(cju.coding_job_id)');
      }

      // Get the total count efficiently using a subquery to avoid loading all IDs into memory
      // This is necessary because of the GROUP BY and HAVING clauses.
      // We use raw query execution here because `query.getQuery()` returns compiled SQL
      // with positional parameters ($1, $2) which cannot be passed cleanly back into another
      // QueryBuilder using `setParameters()` out-of-the-box.
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

      // Apply ordering and pagination at the database level to ensure stable sorts
      query.orderBy('cju.response_id', 'ASC');
      query.offset((page - 1) * limit).limit(limit);
      const paginatedRawResults = await query.getRawMany();
      const paginatedResponseIds = paginatedRawResults.map(row => row.responseId);

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

      // After fetching relations, explicitly remove any individual items that belong to trainings
      // Since `where: { response_id: In() }` indiscriminately loaded all records for these responses.
      const finalCodingJobUnits = excludeTrainings ?
        codingJobUnits.filter(unit => !unit.coding_job?.training_id) :
        codingJobUnits;

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
          responseGroups.set(responseId, {
            responseId: responseId,
            unitName: unit.response?.unit?.name || '',
            variableId: unit.variable_id,
            personLogin: unit.response?.unit?.booklet?.person?.login || '',
            personCode: unit.response?.unit?.booklet?.person?.code || '',
            bookletName: unit.response?.unit?.booklet?.bookletinfo?.name || '',
            givenAnswer: unit.response?.value || '',
            coderResults: []
          });
        }

        const group = responseGroups.get(responseId)!;

        const coder = unit.coding_job?.codingJobCoders?.[0]; // Assuming one coder per job
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
            // Get the selected coder's coding_job_unit entry
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

            // Clean up any historical ghost-append headers that were manually injected previously
            // This restores the student's submission text exactly to full pristine form.
            if (updatedValue.includes(boundary)) {
              const parts = updatedValue.split(boundary);
              updatedValue = parts[parts.length - 1];
            }

            // Purge any stale supervisor comments from ALL coder rows on this specific response
            // This mathematically prevents the "Changed Mind" problem inherently: if a supervisor switches
            // the winning coder tomorrow, the old winning coder automatically loses their legacy comment.
            await transactionalEntityManager.update(
              CodingJobUnit,
              { response_id: decision.responseId },
              { supervisor_comment: null }
            );

            // Reassign the fresh, correct supervisor comment strictly to the winner
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
          false, // onlyConflicts = false (needed for correct Kappa calculation)
          excludeTrainings, // use passed parameter
          undefined, // no search for kappa calc
          undefined, // no coderId for kappa calc
          undefined, // no statusFilter for kappa calc
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

      // Calculate mean kappa
      // Reference: R eatPrep meanKappa function
      // https://github.com/sachseka/eatPrep/blob/8dc0b54748c095508c20fde07843e61b73a42141/R/rater_functions.R#L98
      // R default: weighted.mean(dfr$kappa, dfr$N)
      // R alternative: mean(dfr$kappa, na.rm = TRUE)
      let averageKappa: number | null;

      if (weightedMean) {
        // Weighted mean: weight each pair's kappa by number of valid pairs (N)
        // This matches the R default behavior: weighted.mean(dfr$kappa, dfr$N)
        let totalWeightedKappa = 0;
        let totalWeight = 0;

        for (const result of coderPairs) {
          if (result.kappa !== null && !Number.isNaN(result.kappa)) {
            const weight = result.validPairs; // N = number of valid pairs
            totalWeightedKappa += result.kappa * weight;
            totalWeight += weight;
          }
        }

        averageKappa = totalWeight > 0 ? totalWeightedKappa / totalWeight : null;
      } else {
        // Simple arithmetic mean (unweighted)
        // This matches R behavior with weight.mean = FALSE
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
