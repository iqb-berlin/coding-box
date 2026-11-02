import {
  Injectable, Logger
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository
} from 'typeorm';
import { CoderTraining } from '../../entities/coder-training.entity';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';
import { CodingJob } from '../../entities/coding-job.entity';
import {
  WorkspaceExclusionService,
  applyResolvedExclusionsToQuery
} from '../workspace/workspace-exclusion.service';
import { CoderTrainingDisplayService } from './coder-training-display.service';
import {
  KappaCoderValue, MissingCodeDisplayContext, TrainingCohensKappaStatistics, TrainingFleissKappaByVariable, TrainingKappaCalculationLevel, TrainingKappaCoderPairInput, TrainingKappaOptions, WithinTrainingKappaCase, WithinTrainingKappaCaseRow, WithinTrainingKappaValueRow
} from './coder-training.types';
import { getWithinTrainingComparisonSelectedJobIds, getWithinTrainingJobCoderName, toFreshnessNumber } from './coder-training.util';
import {
  CodingStatisticsService,
  KappaCalculationResult
} from './coding-statistics.service';
import { calculateMetricMean } from './interrater-reliability.calculator';

@Injectable()
export class CoderTrainingKappaService {
  private readonly logger = new Logger('CoderTrainingService');

  constructor(
    @InjectRepository(CodingJob)
    private codingJobRepository: Repository<CodingJob>,
    @InjectRepository(CodingJobUnit)
    private codingJobUnitRepository: Repository<CodingJobUnit>,
    @InjectRepository(CoderTraining)
    private coderTrainingRepository: Repository<CoderTraining>,
    private workspaceExclusionService: WorkspaceExclusionService,
    private codingStatisticsService: CodingStatisticsService,
    private readonly display: CoderTrainingDisplayService
  ) {}

  private async getWithinTrainingKappaCaseRows(
    workspaceId: number,
    trainingId: number,
    selectedJobIds: number[],
    calculationLevel: TrainingKappaCalculationLevel,
    missingCodesByJobId: Map<number, MissingCodeDisplayContext>,
    defaultMissingCodeContext: MissingCodeDisplayContext,
    exclusions: Awaited<ReturnType<WorkspaceExclusionService['resolveExclusionsForQueries']>>
  ): Promise<WithinTrainingKappaCaseRow[]> {
    const selectedJobParameterName = 'withinTrainingKappaCaseSelectedJobIds';
    const valueExpression = calculationLevel === 'score' ?
      this.display.buildComparisonDisplayScoreSqlExpression(missingCodesByJobId, defaultMissingCodeContext) :
      this.display.buildComparisonDisplayCodeSqlExpression(missingCodesByJobId, defaultMissingCodeContext);
    const query = this.codingJobUnitRepository
      .createQueryBuilder('cju')
      .innerJoin('cju.coding_job', 'cj')
      .select('cju.response_id', 'responseId')
      .addSelect('cju.unit_name', 'unitName')
      .addSelect('cju.variable_id', 'variableId')
      .addSelect(
        `COUNT(DISTINCT cj.id) FILTER (
          WHERE cj.id IN (:...${selectedJobParameterName})
          AND (${valueExpression}) IS NOT NULL
        )`,
        'validValueCount'
      )
      .where('cj.workspace_id = :workspaceId', { workspaceId })
      .andWhere('cj.training_id = :trainingId', { trainingId })
      .groupBy('cju.response_id')
      .addGroupBy('cju.unit_name')
      .addGroupBy('cju.variable_id')
      .orderBy('cju.unit_name', 'ASC')
      .addOrderBy('cju.variable_id', 'ASC')
      .addOrderBy('cju.response_id', 'ASC')
      .setParameter(selectedJobParameterName, selectedJobIds);

    applyResolvedExclusionsToQuery(query, exclusions, {
      unitNameExpression: 'cju.unit_name',
      bookletNameExpression: 'cju.booklet_name',
      parameterPrefix: 'withinTrainingKappaCases'
    });

    return query.getRawMany<WithinTrainingKappaCaseRow>();
  }

  private async getWithinTrainingKappaValueRows(
    workspaceId: number,
    trainingId: number,
    selectedJobIds: number[],
    missingCodesByJobId: Map<number, MissingCodeDisplayContext>,
    defaultMissingCodeContext: MissingCodeDisplayContext,
    exclusions: Awaited<ReturnType<WorkspaceExclusionService['resolveExclusionsForQueries']>>
  ): Promise<WithinTrainingKappaValueRow[]> {
    if (selectedJobIds.length === 0) {
      return [];
    }

    const displayCodeExpression = this.display.buildComparisonDisplayCodeSqlExpression(
      missingCodesByJobId,
      defaultMissingCodeContext
    );
    const displayScoreExpression = this.display.buildComparisonDisplayScoreSqlExpression(
      missingCodesByJobId,
      defaultMissingCodeContext
    );
    const query = this.codingJobUnitRepository
      .createQueryBuilder('cju')
      .innerJoin('cju.coding_job', 'cj')
      .select('cj.id', 'jobId')
      .addSelect('cju.response_id', 'responseId')
      .addSelect('cju.unit_name', 'unitName')
      .addSelect('cju.variable_id', 'variableId')
      .addSelect(displayCodeExpression, 'code')
      .addSelect(displayScoreExpression, 'score')
      .where('cj.workspace_id = :workspaceId', { workspaceId })
      .andWhere('cj.training_id = :trainingId', { trainingId })
      .andWhere('cj.id IN (:...withinTrainingKappaValueJobIds)', {
        withinTrainingKappaValueJobIds: selectedJobIds
      })
      .orderBy('cju.id', 'ASC')
      .addOrderBy('cj.id', 'ASC');

    applyResolvedExclusionsToQuery(query, exclusions, {
      unitNameExpression: 'cju.unit_name',
      bookletNameExpression: 'cju.booklet_name',
      parameterPrefix: 'withinTrainingKappaValues'
    });

    return query.getRawMany<WithinTrainingKappaValueRow>();
  }

  private normalizeWithinTrainingKappaCases(
    rows: WithinTrainingKappaCaseRow[]
  ): WithinTrainingKappaCase[] {
    return rows
      .map(row => {
        const responseId = this.display.toNullableScore(row.responseId);
        if (responseId === null) {
          return null;
        }
        return {
          responseId,
          unitName: row.unitName,
          variableId: row.variableId,
          validValueCount: toFreshnessNumber(row.validValueCount)
        };
      })
      .filter((row): row is WithinTrainingKappaCase => row !== null);
  }

  private toKappaCode(value: string | null): number | null {
    if (value === null) {
      return null;
    }

    const parsed = parseInt(value, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }

  private buildTrainingKappaValuesByResponseAndJob(
    valueRows: WithinTrainingKappaValueRow[],
    selectedJobIds: number[]
  ): Map<string, KappaCoderValue> {
    const selectedJobIdSet = new Set(selectedJobIds);
    const values = new Map<string, KappaCoderValue>();
    valueRows.forEach(row => {
      const responseId = this.display.toNullableScore(row.responseId);
      const jobId = this.display.toNullableScore(row.jobId);
      if (responseId === null || jobId === null || !selectedJobIdSet.has(jobId)) return;
      values.set(
        this.getTrainingKappaValueKey(responseId, row.unitName, row.variableId, jobId),
        { code: this.toKappaCode(row.code), score: this.display.toNullableScore(row.score) }
      );
    });
    return values;
  }

  private buildWithinTrainingKappaCoderPairs(
    cases: WithinTrainingKappaCase[],
    valueRows: WithinTrainingKappaValueRow[],
    selectedJobs: Array<Pick<CodingJob, 'id' | 'name'> & {
      codingJobCoders?: Array<{ user?: { username?: string | null } | null }> | null;
    }>
  ): TrainingKappaCoderPairInput[] {
    const valuesByResponseAndJob = this.buildTrainingKappaValuesByResponseAndJob(
      valueRows,
      selectedJobs.map(job => job.id)
    );

    const casesByVariable = new Map<string, WithinTrainingKappaCase[]>();
    cases.forEach(item => {
      const key = this.getTrainingKappaVariableKey(item.unitName, item.variableId);
      if (!casesByVariable.has(key)) {
        casesByVariable.set(key, []);
      }
      casesByVariable.get(key)!.push(item);
    });

    const coderPairs: TrainingKappaCoderPairInput[] = [];
    Array.from(casesByVariable.values()).forEach(variableCases => {
      variableCases.sort((a, b) => a.responseId - b.responseId);
      const firstCase = variableCases[0];
      if (!firstCase) {
        return;
      }

      for (let i = 0; i < selectedJobs.length; i++) {
        for (let j = i + 1; j < selectedJobs.length; j++) {
          const coder1 = selectedJobs[i];
          const coder2 = selectedJobs[j];
          const codes: Array<{ code1: number | null; code2: number | null }> = [];
          const scores: Array<{ score1: number | null; score2: number | null }> = [];

          variableCases.forEach(item => {
            const coder1Value = valuesByResponseAndJob.get(
              this.getTrainingKappaValueKey(
                item.responseId,
                item.unitName,
                item.variableId,
                coder1.id
              )
            );
            const coder2Value = valuesByResponseAndJob.get(
              this.getTrainingKappaValueKey(
                item.responseId,
                item.unitName,
                item.variableId,
                coder2.id
              )
            );
            codes.push({
              code1: coder1Value?.code ?? null,
              code2: coder2Value?.code ?? null
            });
            scores.push({
              score1: coder1Value?.score ?? null,
              score2: coder2Value?.score ?? null
            });
          });

          if (codes.length > 0) {
            coderPairs.push({
              coder1Id: coder1.id,
              coder1Name: getWithinTrainingJobCoderName(coder1),
              coder2Id: coder2.id,
              coder2Name: getWithinTrainingJobCoderName(coder2),
              unitName: firstCase.unitName,
              variableId: firstCase.variableId,
              codes,
              scores
            });
          }
        }
      }
    });

    return coderPairs;
  }

  private calculateWithinTrainingFleissKappa(
    cases: WithinTrainingKappaCase[],
    valueRows: WithinTrainingKappaValueRow[],
    selectedJobIds: number[],
    calculationLevel: TrainingKappaCalculationLevel
  ): TrainingFleissKappaByVariable {
    const valuesByResponseAndJob = this.buildTrainingKappaValuesByResponseAndJob(
      valueRows,
      selectedJobIds
    );

    const ratingsByVariable = new Map<string, Array<Array<number | null>>>();
    cases.forEach(item => {
      const key = this.getTrainingKappaVariableKey(item.unitName, item.variableId);
      if (!ratingsByVariable.has(key)) ratingsByVariable.set(key, []);
      ratingsByVariable.get(key)!.push(selectedJobIds.map(jobId => {
        const value = valuesByResponseAndJob.get(
          this.getTrainingKappaValueKey(item.responseId, item.unitName, item.variableId, jobId)
        );
        return calculationLevel === 'score' ? value?.score ?? null : value?.code ?? null;
      }));
    });

    return new Map(Array.from(ratingsByVariable.entries()).map(([key, ratings]) => {
      const result = this.codingStatisticsService.calculateFleissKappa(ratings);
      return [key, {
        fleissKappa: result.fleissKappa,
        completeCaseCount: result.completeCaseCount,
        possibleCaseCount: ratings.length
      }];
    }));
  }

  async getWithinTrainingCohensKappa(
    workspaceId: number,
    trainingId: number,
    options: TrainingKappaOptions = {}
  ): Promise<TrainingCohensKappaStatistics> {
    const useWeightedMean = options.weightedMean ?? true;
    const calculationLevel = options.level ?? 'code';
    const emptyStatistics = this.createEmptyTrainingKappaStatistics(useWeightedMean, calculationLevel);
    const training = await this.coderTrainingRepository.findOne({
      where: {
        workspace_id: workspaceId,
        id: trainingId
      }
    });

    if (!training) {
      return emptyStatistics;
    }

    const jobs = await this.codingJobRepository.find({
      where: {
        workspace_id: workspaceId,
        training_id: trainingId
      },
      relations: ['codingJobCoders.user'],
      order: { id: 'ASC' }
    });
    const selectedJobIds = getWithinTrainingComparisonSelectedJobIds(options.selectedJobIds, jobs);
    const jobById = new Map(jobs.map(job => [job.id, job]));
    const selectedJobs = selectedJobIds
      .map(jobId => jobById.get(jobId))
      .filter((job): job is CodingJob => job !== undefined);

    if (selectedJobs.length < 2) {
      return emptyStatistics;
    }

    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    const [missingCodesByJobId, defaultMissingCodeContext] = await Promise.all([
      this.display.buildMissingCodesByJobId(workspaceId, selectedJobs),
      this.display.getDefaultMissingCodeDisplayContext(workspaceId)
    ]);
    const [caseRows, valueRows] = await Promise.all([
      this.getWithinTrainingKappaCaseRows(
        workspaceId,
        trainingId,
        selectedJobIds,
        calculationLevel,
        missingCodesByJobId,
        defaultMissingCodeContext,
        exclusions
      ),
      this.getWithinTrainingKappaValueRows(
        workspaceId,
        trainingId,
        selectedJobIds,
        missingCodesByJobId,
        defaultMissingCodeContext,
        exclusions
      )
    ]);
    const cases = this.normalizeWithinTrainingKappaCases(caseRows);
    const coderPairs = this.buildWithinTrainingKappaCoderPairs(cases, valueRows, selectedJobs);

    if (coderPairs.length === 0) {
      return emptyStatistics;
    }

    const kappaResults = this.codingStatisticsService.calculateCohensKappa(coderPairs, calculationLevel);
    const caseCountsByVariable = this.calculateTrainingKappaCaseCountsByVariable(cases);
    const fleissKappaByVariable = this.calculateWithinTrainingFleissKappa(
      cases,
      valueRows,
      selectedJobIds,
      calculationLevel
    );

    return this.createTrainingKappaStatistics(
      kappaResults,
      caseCountsByVariable,
      fleissKappaByVariable,
      useWeightedMean,
      calculationLevel
    );
  }

  private getTrainingKappaVariableKey(unitName: string, variableId: string): string {
    return `${unitName}:${variableId}`;
  }

  private getTrainingKappaValueKey(
    responseId: number,
    unitName: string,
    variableId: string,
    jobId: number
  ): string {
    return `${responseId}:${unitName}:${variableId}:${jobId}`;
  }

  private createEmptyTrainingKappaStatistics(
    useWeightedMean: boolean,
    calculationLevel: TrainingKappaCalculationLevel
  ): TrainingCohensKappaStatistics {
    return {
      variables: [],
      workspaceSummary: {
        totalDoubleCodedResponses: 0,
        totalCoderPairs: 0,
        averageKappa: null,
        averageBrennanPredigerKappa: null,
        variablesIncluded: 0,
        codersIncluded: 0,
        weightingMethod: useWeightedMean ? 'weighted' : 'unweighted',
        calculationLevel
      }
    };
  }

  private calculateTrainingKappaCaseCountsByVariable(
    cases: WithinTrainingKappaCase[]
  ): Map<string, number> {
    const caseCountsByVariable = new Map<string, number>();

    cases.forEach(item => {
      if (item.validValueCount < 2) return;

      const key = this.getTrainingKappaVariableKey(item.unitName, item.variableId);
      caseCountsByVariable.set(key, (caseCountsByVariable.get(key) ?? 0) + 1);
    });

    return caseCountsByVariable;
  }

  private createTrainingKappaStatistics(
    kappaResults: KappaCalculationResult[],
    caseCountsByVariable: Map<string, number>,
    fleissKappaByVariable: TrainingFleissKappaByVariable,
    useWeightedMean: boolean,
    calculationLevel: TrainingKappaCalculationLevel
  ): TrainingCohensKappaStatistics {
    const variableMap = new Map<string, {
      unitName: string;
      variableId: string;
      coderPairs: KappaCalculationResult[];
    }>();

    kappaResults.forEach(result => {
      const unitName = result.unitName as string;
      const variableId = result.variableId as string;
      const key = this.getTrainingKappaVariableKey(unitName, variableId);
      if (!variableMap.has(key)) {
        variableMap.set(key, {
          unitName,
          variableId,
          coderPairs: []
        });
      }
      variableMap.get(key)!.coderPairs.push(result);
    });

    const variables = Array.from(variableMap.entries())
      .map(([key, variable]) => ({
        ...variable,
        coderPairs: variable.coderPairs.map(result => (
          this.codingStatisticsService.roundKappaCalculationResult(result)
        )),
        caseCount: caseCountsByVariable.get(key) ?? 0,
        fleissKappa: fleissKappaByVariable.get(key)?.fleissKappa ?? null,
        fleissCaseCount: fleissKappaByVariable.get(key)?.completeCaseCount ?? 0,
        fleissPossibleCaseCount: fleissKappaByVariable.get(key)?.possibleCaseCount ?? 0,
        ...this.codingStatisticsService.calculateKappaVariableSummary(
          variable.coderPairs,
          useWeightedMean
        )
      }));

    const uniqueCoders = new Set<number>();

    kappaResults.forEach(result => {
      uniqueCoders.add(result.coder1Id);
      uniqueCoders.add(result.coder2Id);
    });

    const averageKappa = calculateMetricMean(
      kappaResults,
      result => result.kappa,
      result => result.validPairs,
      useWeightedMean
    );
    const averageBrennanPredigerKappa = calculateMetricMean(
      kappaResults,
      result => result.brennanPredigerKappa,
      result => result.validPairs,
      useWeightedMean
    );
    const totalDoubleCodedResponses = Array.from(caseCountsByVariable.values())
      .reduce((sum, caseCount) => sum + caseCount, 0);

    return {
      variables,
      workspaceSummary: {
        totalDoubleCodedResponses,
        totalCoderPairs: kappaResults.length,
        averageKappa,
        averageBrennanPredigerKappa,
        variablesIncluded: variableMap.size,
        codersIncluded: uniqueCoders.size,
        weightingMethod: useWeightedMean ? 'weighted' : 'unweighted',
        calculationLevel
      }
    };
  }

  /**
   * Transform within-training comparison data to format expected by Cohen's Kappa calculation
   * This allows reuse of existing Cohen's Kappa calculation logic
   */
  transformToCoderPairs(
    comparisonData: Array<{
      unitName: string;
      variableId: string;
      personCode: string;
      personLogin: string;
      personGroup: string;
      testPerson: string;
      givenAnswer: string;
      coders: Array<{
        jobId: number;
        coderName: string;
        code: string | null;
        score: number | null;
      }>;
    }>
  ): Array<{
    coder1Id: number;
    coder1Name: string;
    coder2Id: number;
    coder2Name: string;
    unitName: string;
    variableId: string;
    codes: Array<{ code1: number | null; code2: number | null }>;
    scores: Array<{ score1: number | null; score2: number | null }>;
  }> {
    this.logger.log(`Transforming ${comparisonData.length} comparison items to coder pairs format`);

    // Group by unit/variable to get all responses for each variable
    const variableMap = new Map<string, typeof comparisonData>();

    for (const item of comparisonData) {
      const key = `${item.unitName}:${item.variableId}`;
      if (!variableMap.has(key)) {
        variableMap.set(key, []);
      }
      variableMap.get(key)!.push(item);
    }

    const allCoderPairs: Array<{
      coder1Id: number;
      coder1Name: string;
      coder2Id: number;
      coder2Name: string;
      unitName: string;
      variableId: string;
      codes: Array<{ code1: number | null; code2: number | null }>;
      scores: Array<{ score1: number | null; score2: number | null }>;
    }> = [];

    // For each variable, create coder pairs
    for (const [variableKey, items] of variableMap.entries()) {
      if (items.length === 0) continue;

      // Get all unique coders from the first item (all items should have same coders)
      const coders = items[0].coders;

      if (coders.length < 2) {
        this.logger.warn(`Variable ${variableKey} has less than 2 coders, skipping`);
        continue;
      }

      // Create all possible pairs of coders
      for (let i = 0; i < coders.length; i++) {
        for (let j = i + 1; j < coders.length; j++) {
          const coder1 = coders[i];
          const coder2 = coders[j];

          // Collect code and score pairs for this coder pair across all responses
          const codePairs: Array<{ code1: number | null; code2: number | null }> = [];
          const scorePairs: Array<{ score1: number | null; score2: number | null }> = [];

          for (const item of items) {
            const coder1Data = item.coders.find(c => c.jobId === coder1.jobId);
            const coder2Data = item.coders.find(c => c.jobId === coder2.jobId);

            if (coder1Data && coder2Data) {
              // Convert string codes to numbers (codes are stored as strings in the comparison data)
              const code1 = coder1Data.code !== null ? parseInt(coder1Data.code, 10) : null;
              const code2 = coder2Data.code !== null ? parseInt(coder2Data.code, 10) : null;

              codePairs.push({
                code1: Number.isNaN(code1) ? null : code1,
                code2: Number.isNaN(code2) ? null : code2
              });

              // Collect score pairs
              scorePairs.push({
                score1: coder1Data.score,
                score2: coder2Data.score
              });
            }
          }

          if (codePairs.length > 0) {
            allCoderPairs.push({
              coder1Id: coder1.jobId,
              coder1Name: coder1.coderName,
              coder2Id: coder2.jobId,
              coder2Name: coder2.coderName,
              unitName: items[0].unitName,
              variableId: items[0].variableId,
              codes: codePairs,
              scores: scorePairs
            });
          }
        }
      }
    }

    this.logger.log(`Created ${allCoderPairs.length} coder pairs from ${variableMap.size} variables`);
    return allCoderPairs;
  }
}
