import { Injectable, Logger } from '@nestjs/common';
import { CodingStatisticsService } from './coding-statistics.service';
import { DoubleCodingReviewQueryService } from './double-coding-review-query.service';
import {
  KappaAgreementInput,
  KappaCalculationLevel,
  KappaCoderPairStatistics,
  KappaMeanInput,
  KappaPairMetadata,
  KappaSourceItem,
  KappaStatisticsBuildResult,
  KappaStatisticsOptions,
  KappaStatisticsResponse
} from './cohens-kappa.types';

@Injectable()
export class CohensKappaStatisticsService {
  private readonly logger = new Logger(CohensKappaStatisticsService.name);

  constructor(
    private readonly doubleCodingReviewQueryService: DoubleCodingReviewQueryService,
    private readonly codingStatisticsService: CodingStatisticsService
  ) { }

  private calculateMeanKappa(
    kappaResults: KappaMeanInput[],
    weightedMean: boolean
  ): number | null {
    if (weightedMean) {
      let totalWeightedKappa = 0;
      let totalWeight = 0;

      for (const result of kappaResults) {
        if (result.kappa !== null && !Number.isNaN(result.kappa)) {
          totalWeightedKappa += result.kappa * result.validPairs;
          totalWeight += result.validPairs;
        }
      }

      return totalWeight > 0 ?
        Math.round((totalWeightedKappa / totalWeight) * 1000) / 1000 :
        null;
    }

    let totalKappa = 0;
    let validKappaCount = 0;

    for (const result of kappaResults) {
      if (result.kappa !== null && !Number.isNaN(result.kappa)) {
        totalKappa += result.kappa;
        validKappaCount += 1;
      }
    }

    return validKappaCount > 0 ?
      Math.round((totalKappa / validKappaCount) * 1000) / 1000 :
      null;
  }

  private calculateMeanAgreement(
    kappaResults: KappaAgreementInput[],
    weightedMean: boolean
  ): number | null {
    if (weightedMean) {
      let weightedAgreement = 0;
      let totalWeight = 0;

      for (const result of kappaResults) {
        if (result.validPairs > 0) {
          weightedAgreement += result.agreement * result.validPairs;
          totalWeight += result.validPairs;
        }
      }

      return totalWeight > 0 ?
        Math.round((weightedAgreement / totalWeight) * 1000) / 1000 :
        null;
    }

    let agreementSum = 0;
    let agreementCount = 0;

    for (const result of kappaResults) {
      if (result.validPairs > 0) {
        agreementSum += result.agreement;
        agreementCount += 1;
      }
    }

    return agreementCount > 0 ?
      Math.round((agreementSum / agreementCount) * 1000) / 1000 :
      null;
  }

  private getVariableKey(unitName: string, variableId: string): string {
    return JSON.stringify([unitName, variableId]);
  }

  private getCompletedValueCount(
    item: KappaSourceItem,
    calculationLevel: KappaCalculationLevel
  ): number {
    return item.coderResults.filter(result => (
      calculationLevel === 'score' ?
        result.score !== null && result.score !== undefined :
        result.code !== null && result.code !== undefined
    )).length;
  }

  private hasKappaValueForLevel(
    result: KappaSourceItem['coderResults'][number],
    calculationLevel: KappaCalculationLevel
  ): boolean {
    return calculationLevel === 'score' ?
      result.score !== null && result.score !== undefined :
      result.code !== null && result.code !== undefined;
  }

  private getCoderPairKey(coder1Id: number, coder2Id: number): string {
    return coder1Id < coder2Id ?
      `${coder1Id}-${coder2Id}` :
      `${coder2Id}-${coder1Id}`;
  }

  private emptyKappaPairMetadata(): KappaPairMetadata {
    return {
      jobNames: [],
      jobDefinitionIds: [],
      trainingIds: [],
      trainingLabels: []
    };
  }

  private addCoderResultMetadata(
    metadata: {
      jobNames: Set<string>;
      jobDefinitionIds: Set<number>;
      trainingIds: Set<number>;
      trainingLabels: Set<string>;
    },
    result: KappaSourceItem['coderResults'][number]
  ): void {
    if (result.jobName) {
      metadata.jobNames.add(result.jobName);
    }
    if (result.jobDefinitionId !== null && result.jobDefinitionId !== undefined) {
      metadata.jobDefinitionIds.add(result.jobDefinitionId);
    }
    if (result.trainingId !== null && result.trainingId !== undefined) {
      metadata.trainingIds.add(result.trainingId);
    }
    if (result.trainingLabel) {
      metadata.trainingLabels.add(result.trainingLabel);
    }
  }

  private toKappaPairMetadata(metadata: {
    jobNames: Set<string>;
    jobDefinitionIds: Set<number>;
    trainingIds: Set<number>;
    trainingLabels: Set<string>;
  }): KappaPairMetadata {
    return {
      jobNames: Array.from(metadata.jobNames).sort((a, b) => a.localeCompare(b)),
      jobDefinitionIds: Array.from(metadata.jobDefinitionIds).sort((a, b) => a - b),
      trainingIds: Array.from(metadata.trainingIds).sort((a, b) => a - b),
      trainingLabels: Array.from(metadata.trainingLabels).sort((a, b) => a.localeCompare(b))
    };
  }

  async buildStatistics(
    workspaceId: number,
    options: KappaStatisticsOptions
  ): Promise<KappaStatisticsBuildResult> {
    this.logger.log(
      `Calculating Cohen's Kappa for workspace ${workspaceId}${options.unitName ? `, unit: ${options.unitName}` : ''
      }${options.variableId ? `, variable: ${options.variableId}` : ''}`
    );

    const allCodedItems = (await this.doubleCodingReviewQueryService.getCodedVariablesForKappa(
      workspaceId,
      options.excludeTrainings,
      options.jobDefinitionIds,
      options.coderTrainingIds,
      options.coderIds,
      options.calculationLevel
    )).map(item => ({
      responseId: item.responseId,
      unitName: item.unitName,
      variableId: item.variableId,
      variableAnchor: item.variableAnchor || item.variableId,
      personLogin: item.personLogin,
      personCode: item.personCode,
      personGroup: item.personGroup,
      bookletName: item.bookletName || '',
      coderResults: item.coderResults.map(result => ({
        coderId: result.coderId,
        coderName: result.coderName,
        jobId: result.jobId,
        jobName: result.jobName,
        jobDefinitionId: result.jobDefinitionId ?? null,
        trainingId: result.trainingId ?? null,
        trainingLabel: result.trainingLabel ?? null,
        code: result.code,
        score: result.score,
        notes: result.notes,
        codedAt: result.codedAt
      }))
    }));

    const groupedData = new Map<string, {
      unitName: string;
      variableId: string;
      items: KappaSourceItem[];
    }>();
    const filteredCodedItems: KappaSourceItem[] = [];

    allCodedItems.forEach(item => {
      if (options.unitName && item.unitName !== options.unitName) return;
      if (options.variableId && item.variableId !== options.variableId) return;

      filteredCodedItems.push(item);
      const key = this.getVariableKey(item.unitName, item.variableId);
      if (!groupedData.has(key)) {
        groupedData.set(key, {
          unitName: item.unitName,
          variableId: item.variableId,
          items: []
        });
      }
      groupedData.get(key)!.items.push(item);
    });

    const variables: KappaStatisticsResponse['variables'] = [];
    const allKappaResults: Array<KappaMeanInput & KappaAgreementInput> = [];
    const uniqueVariables = new Set<string>();
    const uniqueCoders = new Set<number>();

    for (const [key, group] of groupedData.entries()) {
      const { unitName: unitNameKey, variableId: variableIdKey, items } = group;
      const doubleCodedItems = items.filter(
        item => this.getCompletedValueCount(item, options.calculationLevel) >= 2
      );

      uniqueVariables.add(key);

      const allCoders = new Set<number>();
      doubleCodedItems.forEach(item => {
        item.coderResults.forEach(cr => {
          if (this.hasKappaValueForLevel(cr, options.calculationLevel)) {
            allCoders.add(cr.coderId);
            uniqueCoders.add(cr.coderId);
          }
        });
      });

      const coderArray = Array.from(allCoders);
      const coderPairs: Array<{
        coder1Id: number;
        coder1Name: string;
        coder2Id: number;
        coder2Name: string;
        unitName: string;
        variableId: string;
        codes: Array<{ code1: number | null; code2: number | null }>;
        scores: Array<{ score1: number | null; score2: number | null }>;
      }> = [];
      const pairMetadataByKey = new Map<string, KappaPairMetadata>();

      for (let i = 0; i < coderArray.length; i++) {
        for (let j = i + 1; j < coderArray.length; j++) {
          const coder1Id = coderArray[i];
          const coder2Id = coderArray[j];

          let coder1Name = '';
          let coder2Name = '';
          items.forEach(item => {
            item.coderResults.forEach(cr => {
              if (cr.coderId === coder1Id) coder1Name = cr.coderName;
              if (cr.coderId === coder2Id) coder2Name = cr.coderName;
            });
          });

          const codes: Array<{ code1: number | null; code2: number | null }> = [];
          const scores: Array<{ score1: number | null; score2: number | null }> = [];
          const metadata = {
            jobNames: new Set<string>(),
            jobDefinitionIds: new Set<number>(),
            trainingIds: new Set<number>(),
            trainingLabels: new Set<string>()
          };

          doubleCodedItems.forEach(item => {
            const coder1Result = item.coderResults.find(
              cr => cr.coderId === coder1Id
            );
            const coder2Result = item.coderResults.find(
              cr => cr.coderId === coder2Id
            );

            if (coder1Result && coder2Result) {
              codes.push({
                code1: coder1Result.code,
                code2: coder2Result.code
              });
              scores.push({
                score1: coder1Result.score,
                score2: coder2Result.score
              });
              this.addCoderResultMetadata(metadata, coder1Result);
              this.addCoderResultMetadata(metadata, coder2Result);
            }
          });

          if (codes.length > 0) {
            const pairKey = this.getCoderPairKey(coder1Id, coder2Id);
            pairMetadataByKey.set(pairKey, this.toKappaPairMetadata(metadata));
            coderPairs.push({
              coder1Id,
              coder1Name,
              coder2Id,
              coder2Name,
              unitName: unitNameKey,
              variableId: variableIdKey,
              codes,
              scores
            });
          }
        }
      }

      const rawKappaResults = coderPairs.length > 0 ?
        this.codingStatisticsService
          .calculateCohensKappa(coderPairs, options.calculationLevel) :
        [];
      const kappaResults = rawKappaResults
        .map(result => {
          const roundedResult = this.codingStatisticsService
            .roundKappaCalculationResult(result);
          return {
            coder1Id: roundedResult.coder1Id,
            coder1Name: roundedResult.coder1Name,
            coder2Id: roundedResult.coder2Id,
            coder2Name: roundedResult.coder2Name,
            kappa: roundedResult.kappa,
            agreement: roundedResult.agreement,
            totalItems: roundedResult.totalItems,
            validPairs: roundedResult.validPairs,
            interpretation: roundedResult.interpretation,
            ...(pairMetadataByKey.get(
              this.getCoderPairKey(result.coder1Id, result.coder2Id)
            ) ?? this.emptyKappaPairMetadata())
          };
        }) as KappaCoderPairStatistics[];

      allKappaResults.push(...rawKappaResults);
      const validPairCount = rawKappaResults.reduce(
        (sum, result) => sum + (result.validPairs > 0 ? result.validPairs : 0),
        0
      );
      const coderPairCount = rawKappaResults.filter(result => result.validPairs > 0).length;
      const caseCount = items.length;
      const doubleCodedCount = doubleCodedItems.length;

      variables.push({
        unitName: unitNameKey,
        variableId: variableIdKey,
        meanKappa: this.calculateMeanKappa(rawKappaResults, options.weightedMean),
        meanAgreement: this.calculateMeanAgreement(rawKappaResults, options.weightedMean),
        caseCount,
        doubleCodedCount,
        doubleCodedRate: caseCount > 0 ? doubleCodedCount / caseCount : null,
        validPairCount,
        coderPairCount,
        coderPairs: kappaResults
      });
    }

    let validKappaCount = 0;
    allKappaResults.forEach(result => {
      if (result.kappa !== null && !Number.isNaN(result.kappa)) {
        validKappaCount += 1;
      }
    });

    const averageKappa = this.calculateMeanKappa(allKappaResults, options.weightedMean);
    const totalCodedResponses = variables.reduce((sum, variable) => sum + variable.caseCount, 0);
    const totalDoubleCodedResponses = variables.reduce((sum, variable) => sum + variable.doubleCodedCount, 0);
    const workspaceSummary = {
      totalCodedResponses,
      totalDoubleCodedResponses,
      totalCoderPairs: validKappaCount,
      averageKappa,
      meanAgreement: this.calculateMeanAgreement(allKappaResults, options.weightedMean),
      variablesIncluded: uniqueVariables.size,
      codersIncluded: uniqueCoders.size,
      weightingMethod: (options.weightedMean ? 'weighted' : 'unweighted') as 'weighted' | 'unweighted',
      calculationLevel: options.calculationLevel
    };

    this.logger.log(
      `Calculated Cohen's Kappa for ${variables.length} unit/variable combinations in workspace ${workspaceId}, average kappa: ${averageKappa}`
    );

    return {
      variables,
      workspaceSummary,
      sourceItems: filteredCodedItems
    };
  }
}
