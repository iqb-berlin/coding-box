import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  In, IsNull, Not, Repository
} from 'typeorm';
import { statusStringToNumber } from '../utils/response-status-converter';
import { ResponseEntity } from '../entities/response.entity';
import { CodingJobUnit } from '../entities/coding-job-unit.entity';
import { JobDefinition } from '../entities/job-definition.entity';
import { VariableBundle } from '../entities/variable-bundle.entity';

@Injectable()
export class CodingProgressService {
  private readonly logger = new Logger(CodingProgressService.name);

  constructor(
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    @InjectRepository(CodingJobUnit)
    private codingJobUnitRepository: Repository<CodingJobUnit>,
    @InjectRepository(JobDefinition)
    private jobDefinitionRepository: Repository<JobDefinition>,
    @InjectRepository(VariableBundle)
    private variableBundleRepository: Repository<VariableBundle>
  ) { }

  async getCodingProgressOverview(workspaceId: number): Promise<{
    totalCasesToCode: number;
    completedCases: number;
    completionPercentage: number;
  }> {
    const totalCasesToCode = await this.responseRepository
      .createQueryBuilder('response')
      .leftJoin('response.unit', 'unit')
      .leftJoin('unit.booklet', 'booklet')
      .leftJoin('booklet.person', 'person')
      .where('response.status_v1 = :status', {
        status: statusStringToNumber('CODING_INCOMPLETE')
      })
      .andWhere('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      .getCount();

    const completedCases = await this.codingJobUnitRepository.count({
      where: {
        coding_job: {
          workspace_id: workspaceId,
          training_id: IsNull()
        },
        code: Not(IsNull())
      }
    });

    const completionPercentage =
            totalCasesToCode > 0 ? (completedCases / totalCasesToCode) * 100 : 0;

    return {
      totalCasesToCode,
      completedCases,
      completionPercentage
    };
  }

  async getCaseCoverageOverview(workspaceId: number): Promise<{
    totalCasesToCode: number;
    casesInJobs: number;
    doubleCodedCases: number;
    singleCodedCases: number;
    unassignedCases: number;
    coveragePercentage: number;
  }> {
    const totalCasesToCode = await this.responseRepository
      .createQueryBuilder('response')
      .leftJoin('response.unit', 'unit')
      .leftJoin('unit.booklet', 'booklet')
      .leftJoin('booklet.person', 'person')
      .where('response.status_v1 = :status', {
        status: statusStringToNumber('CODING_INCOMPLETE')
      })
      .andWhere('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      .getCount();

    const casesInJobs = await this.codingJobUnitRepository
      .createQueryBuilder('cju')
      .innerJoin('cju.response', 'response')
      .leftJoin('cju.coding_job', 'coding_job')
      .leftJoin('response.unit', 'unit')
      .leftJoin('unit.booklet', 'booklet')
      .leftJoin('booklet.person', 'person')
      .where('response.status_v1 = :status', {
        status: statusStringToNumber('CODING_INCOMPLETE')
      })
      .andWhere('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      .andWhere('coding_job.training_id IS NULL')
      .getCount();

    const uniqueCasesInJobsResult = await this.codingJobUnitRepository
      .createQueryBuilder('cju')
      .innerJoin('cju.response', 'response')
      .leftJoin('cju.coding_job', 'coding_job')
      .leftJoin('response.unit', 'unit')
      .leftJoin('unit.booklet', 'booklet')
      .leftJoin('booklet.person', 'person')
      .where('response.status_v1 = :status', {
        status: statusStringToNumber('CODING_INCOMPLETE')
      })
      .andWhere('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      .andWhere('coding_job.training_id IS NULL')
      .select('COUNT(DISTINCT cju.response_id)', 'count')
      .getRawOne();

    const uniqueCasesInJobs = parseInt(
      uniqueCasesInJobsResult?.count || '0',
      10
    );

    const doubleCodedCases = casesInJobs - uniqueCasesInJobs;

    const singleCodedCases = uniqueCasesInJobs;
    const unassignedCases = totalCasesToCode - uniqueCasesInJobs;
    const coveragePercentage =
            totalCasesToCode > 0 ? (uniqueCasesInJobs / totalCasesToCode) * 100 : 0;

    return {
      totalCasesToCode,
      casesInJobs,
      doubleCodedCases,
      singleCodedCases,
      unassignedCases,
      coveragePercentage
    };
  }

  async getVariableCoverageOverview(workspaceId: number): Promise<{
    totalVariables: number;
    coveredVariables: number;
    coveredByDraft: number;
    coveredByPendingReview: number;
    coveredByApproved: number;
    conflictedVariables: number;
    missingVariables: number;
    partiallyAbgedeckteVariablen: number;
    fullyAbgedeckteVariablen: number;
    coveragePercentage: number;
    variableCaseCounts: {
      unitName: string;
      variableId: string;
      caseCount: number;
    }[];
    coverageByStatus: {
      draft: string[];
      pending_review: string[];
      approved: string[];
      conflicted: Array<{
        variableKey: string;
        conflictingDefinitions: Array<{
          id: number;
          status: string;
        }>;
      }>;
    };
  }> {
    try {
      this.logger.log(
        `Getting variable coverage overview for workspace ${workspaceId} (CODING_INCOMPLETE variables only)`
      );

      const incompleteVariablesResult = await this.responseRepository
        .createQueryBuilder('response')
        .select('unit.name', 'unitName')
        .addSelect('response.variableid', 'variableId')
        .addSelect('COUNT(response.id)', 'caseCount')
        .leftJoin('response.unit', 'unit')
        .leftJoin('unit.booklet', 'booklet')
        .leftJoin('booklet.person', 'person')
        .where('response.status_v1 = :status', {
          status: statusStringToNumber('CODING_INCOMPLETE')
        })
        .andWhere('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('person.consider = :consider', { consider: true })
        .groupBy('unit.name')
        .addGroupBy('response.variableid')
        .getRawMany();

      const variablesNeedingCoding = new Set<string>();
      const variableCaseCounts: {
        unitName: string;
        variableId: string;
        caseCount: number;
      }[] = [];

      incompleteVariablesResult.forEach(row => {
        const variableKey = `${row.unitName}:${row.variableId}`;
        variablesNeedingCoding.add(variableKey);
        variableCaseCounts.push({
          unitName: row.unitName,
          variableId: row.variableId,
          caseCount: parseInt(row.caseCount, 10)
        });
      });

      const jobDefinitions = await this.jobDefinitionRepository.find({
        where: { workspace_id: workspaceId }
      });

      const coveredVariables = new Set<string>();
      const coverageByStatus = {
        draft: new Set<string>(),
        pending_review: new Set<string>(),
        approved: new Set<string>()
      };

      const variableToDefinitions = new Map<
      string,
      Array<{ id: number; status: string }>
      >();

      for (const definition of jobDefinitions) {
        const definitionVariables = new Set<string>();

        if (definition.assigned_variables) {
          definition.assigned_variables.forEach(variable => {
            const variableKey = `${variable.unitName}:${variable.variableId}`;
            if (variablesNeedingCoding.has(variableKey)) {
              definitionVariables.add(variableKey);
            }
          });
        }

        if (definition.assigned_variable_bundles) {
          const bundleIds = definition.assigned_variable_bundles.map(
            bundle => bundle.id
          );
          const variableBundles = await this.variableBundleRepository.find({
            where: { id: In(bundleIds) }
          });

          variableBundles.forEach(bundle => {
            if (bundle.variables) {
              bundle.variables.forEach(variable => {
                const variableKey = `${variable.unitName}:${variable.variableId}`;
                if (variablesNeedingCoding.has(variableKey)) {
                  definitionVariables.add(variableKey);
                }
              });
            }
          });
        }

        definitionVariables.forEach(variableKey => {
          coveredVariables.add(variableKey);
          coverageByStatus[definition.status].add(variableKey);

          if (!variableToDefinitions.has(variableKey)) {
            variableToDefinitions.set(variableKey, []);
          }
          variableToDefinitions.get(variableKey)!.push({
            id: definition.id,
            status: definition.status
          });
        });
      }

      // Get cases in jobs map for conflict detection
      const casesInJobsMap = await this.getVariableCasesInJobs(workspaceId);

      const conflictedVariables = new Map<
      string,
      Array<{ id: number; status: string }>
      >();
      variableToDefinitions.forEach((definitions, variableKey) => {
        if (definitions.length > 1) {
          // Only report as conflict if there aren't enough available cases
          const [unitName, variableId] = variableKey.split(':');
          const variableCaseInfo = variableCaseCounts.find(
            v => v.unitName === unitName && v.variableId === variableId
          );

          if (variableCaseInfo) {
            const casesInJobs =
                            casesInJobsMap.get(
                              `${variableCaseInfo.unitName}::${variableCaseInfo.variableId}`
                            ) || 0;
            const availableCases = variableCaseInfo.caseCount - casesInJobs;

            // Only mark as conflict if there are no available cases left
            if (availableCases <= 0) {
              conflictedVariables.set(variableKey, definitions);
            }
          }
        }
      });

      const missingVariables = new Set<string>();
      const partiallyAbgedeckteVariablen = new Set<string>();
      const fullyAbgedeckteVariablen = new Set<string>();

      variablesNeedingCoding.forEach(variableKey => {
        if (!coveredVariables.has(variableKey)) {
          missingVariables.add(variableKey);
          return;
        }

        // Check if variable is fully or partially covered based on cases in jobs
        const variableCaseInfo = variableCaseCounts.find(
          v => `${v.unitName}:${v.variableId}` === variableKey
        );

        if (variableCaseInfo) {
          const casesInJobs =
                        casesInJobsMap.get(
                          `${variableCaseInfo.unitName}::${variableCaseInfo.variableId}`
                        ) || 0;

          if (casesInJobs >= variableCaseInfo.caseCount) {
            fullyAbgedeckteVariablen.add(variableKey);
          } else if (casesInJobs > 0) {
            partiallyAbgedeckteVariablen.add(variableKey);
          }
        }
      });

      const totalVariables = variablesNeedingCoding.size;
      const coveredCount = coveredVariables.size;
      const draftCount = coverageByStatus.draft.size;
      const pendingReviewCount = coverageByStatus.pending_review.size;
      const approvedCount = coverageByStatus.approved.size;
      const conflictCount = conflictedVariables.size;
      const missingCount = missingVariables.size;
      const partiallyAbgedeckteCount = partiallyAbgedeckteVariablen.size;
      const fullyAbgedeckteCount = fullyAbgedeckteVariablen.size;
      const coveragePercentage =
                totalVariables > 0 ? (coveredCount / totalVariables) * 100 : 0;

      this.logger.log(
        `Variable coverage for workspace ${workspaceId}: ${coveredCount}/${totalVariables} CODING_INCOMPLETE variables covered (${coveragePercentage.toFixed(
          1
        )}%) - Draft: ${draftCount}, Pending: ${pendingReviewCount}, Approved: ${approvedCount}, Conflicted: ${conflictCount}, Fully covered: ${fullyAbgedeckteCount}, Partially covered: ${partiallyAbgedeckteCount}`
      );

      return {
        totalVariables,
        coveredVariables: coveredCount,
        coveredByDraft: draftCount,
        coveredByPendingReview: pendingReviewCount,
        coveredByApproved: approvedCount,
        conflictedVariables: conflictCount,
        missingVariables: missingCount,
        partiallyAbgedeckteVariablen: partiallyAbgedeckteCount,
        fullyAbgedeckteVariablen: fullyAbgedeckteCount,
        coveragePercentage,
        variableCaseCounts,
        coverageByStatus: {
          draft: Array.from(coverageByStatus.draft),
          pending_review: Array.from(coverageByStatus.pending_review),
          approved: Array.from(coverageByStatus.approved),
          conflicted: Array.from(conflictedVariables.entries()).map(
            ([variableKey, definitions]) => ({
              variableKey,
              conflictingDefinitions: definitions
            })
          )
        }
      };
    } catch (error) {
      this.logger.error(
        `Error getting variable coverage overview: ${error.message}`,
        error.stack
      );
      throw new Error(
        'Could not get variable coverage overview. Please check the database connection.'
      );
    }
  }

  private async getVariableCasesInJobs(
    workspaceId: number
  ): Promise<Map<string, number>> {
    const rawResults = await this.codingJobUnitRepository
      .createQueryBuilder('cju')
      .select('cju.unit_name', 'unitName')
      .addSelect('cju.variable_id', 'variableId')
      .addSelect('COUNT(DISTINCT cju.response_id)', 'casesInJobs')
      .leftJoin('cju.coding_job', 'coding_job')
      .where('coding_job.workspace_id = :workspaceId', { workspaceId })
      .andWhere('coding_job.training_id IS NULL')
      .groupBy('cju.unit_name')
      .addGroupBy('cju.variable_id')
      .getRawMany();

    const casesInJobsMap = new Map<string, number>();

    rawResults.forEach(row => {
      const key = `${row.unitName}::${row.variableId}`;
      casesInJobsMap.set(key, parseInt(row.casesInJobs, 10));
    });

    return casesInJobsMap;
  }
}
