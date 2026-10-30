import { Injectable } from '@nestjs/common';
import type { CaseSelectionMode, ReferenceMode } from '../../entities/coder-training.entity';
import { CoderTrainingResponse, TrainingBundleConfig, TrainingResponseIdsMap } from './coder-training.types';

@Injectable()
export class CoderTrainingSamplingService {
  applyReferenceFilter(
    responses: CoderTrainingResponse[],
    referenceMode: ReferenceMode | undefined,
    referenceResponseIdsByConfig: TrainingResponseIdsMap | null,
    configKey: string
  ): CoderTrainingResponse[] {
    if (!referenceMode || !referenceResponseIdsByConfig) {
      return responses;
    }

    const refIds = referenceResponseIdsByConfig[configKey] ?
      new Set(referenceResponseIdsByConfig[configKey]) :
      null;

    if (referenceMode === 'same') {
      return refIds ? responses.filter(r => refIds.has(r.responseId)) : [];
    }

    if (referenceMode === 'different' && refIds) {
      return responses.filter(r => !refIds.has(r.responseId));
    }

    return responses;
  }

  makeTrainingConfigKey(unitName: string, variableId: string): string {
    return `${unitName}:${variableId}`;
  }

  private shuffle<T>(arr: T[]): T[] {
    const result = [...arr];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  sampleResponses(
    responses: CoderTrainingResponse[],
    sampleCount: number,
    caseSelectionMode: CaseSelectionMode = 'oldest_first'
  ): CoderTrainingResponse[] {
    if (responses.length <= sampleCount) {
      return responses;
    }

    const arr = [...responses];

    switch (caseSelectionMode) {
      case 'oldest_first': {
        arr.sort((a, b) => {
          const tsA = a.chunkTs ?? a.responseId;
          const tsB = b.chunkTs ?? b.responseId;
          if (tsA !== tsB) return tsA - tsB;
          return a.responseId - b.responseId;
        });
        return arr.slice(0, sampleCount);
      }
      case 'newest_first': {
        arr.sort((a, b) => {
          const tsA = a.chunkTs ?? a.responseId;
          const tsB = b.chunkTs ?? b.responseId;
          if (tsA !== tsB) return tsB - tsA;
          return b.responseId - a.responseId;
        });
        return arr.slice(0, sampleCount);
      }
      case 'random': {
        return this.shuffle(arr).slice(0, sampleCount);
      }
      case 'random_per_testgroup': {
        const byGroup = new Map<string, CoderTrainingResponse[]>();
        for (const r of arr) {
          const key = r.personGroup || '_ungrouped';
          if (!byGroup.has(key)) byGroup.set(key, []);
          byGroup.get(key)!.push(r);
        }
        const groups = this.shuffle(Array.from(byGroup.values()).map(group => this.shuffle(group)));
        const result: CoderTrainingResponse[] = [];

        while (result.length < sampleCount && groups.some(group => group.length > 0)) {
          for (const group of groups) {
            if (result.length >= sampleCount) break;
            const response = group.shift();
            if (response) {
              result.push(response);
            }
          }
        }

        return result;
      }
      case 'random_testgroups': {
        const byGroup = new Map<string, CoderTrainingResponse[]>();
        for (const r of arr) {
          const key = r.personGroup || '_ungrouped';
          if (!byGroup.has(key)) byGroup.set(key, []);
          byGroup.get(key)!.push(r);
        }
        const shuffledGroups = this.shuffle(Array.from(byGroup.entries()));
        const result: CoderTrainingResponse[] = [];
        for (const [, groupResponses] of shuffledGroups) {
          if (result.length >= sampleCount) break;
          const shuffled = this.shuffle(groupResponses);
          const remaining = sampleCount - result.length;
          result.push(...shuffled.slice(0, remaining));
        }
        return result;
      }
      default:
        arr.sort((a, b) => a.responseId - b.responseId);
        return arr.slice(0, sampleCount);
    }
  }

  private getTrainingBundleCaseKey(response: CoderTrainingResponse): string {
    return [
      response.personLogin,
      response.personCode,
      response.personGroup,
      response.bookletName
    ].join('\u0000');
  }

  sampleBundleResponses(
    bundle: TrainingBundleConfig,
    responsesByConfig: Map<string, CoderTrainingResponse[]>,
    caseSelectionMode: CaseSelectionMode
  ): Map<string, CoderTrainingResponse[]> {
    const responsesByCase = new Map<string, CoderTrainingResponse[]>();

    bundle.variables.forEach(variable => {
      const configKey = this.makeTrainingConfigKey(
        variable.unitId,
        variable.variableId
      );
      const responses = responsesByConfig.get(configKey) || [];
      responses.forEach(response => {
        const caseKey = this.getTrainingBundleCaseKey(response);
        const caseResponses = responsesByCase.get(caseKey) || [];
        caseResponses.push(response);
        responsesByCase.set(caseKey, caseResponses);
      });
    });

    const representatives = Array.from(responsesByCase.entries()).map(
      ([caseKey, responses]) => {
        const sortedResponses = [...responses].sort((a, b) => a.responseId - b.responseId);
        const chunkTsValues = sortedResponses
          .map(response => response.chunkTs)
          .filter((chunkTs): chunkTs is number => chunkTs !== undefined);
        return {
          caseKey,
          response: {
            ...sortedResponses[0],
            responseId: Math.min(
              ...sortedResponses.map(response => response.responseId)
            ),
            chunkTs:
              chunkTsValues.length > 0 ?
                Math.min(...chunkTsValues) :
                sortedResponses[0].chunkTs
          }
        };
      }
    );
    const caseKeyByRepresentativeResponseId = new Map(
      representatives.map(entry => [entry.response.responseId, entry.caseKey])
    );
    const sampledRepresentatives = this.sampleResponses(
      representatives.map(entry => entry.response),
      bundle.sampleCount,
      caseSelectionMode
    );
    const sampledCaseKeys = new Set(
      sampledRepresentatives
        .map(response => caseKeyByRepresentativeResponseId.get(response.responseId))
        .filter((caseKey): caseKey is string => !!caseKey)
    );
    const sampledResponsesByConfig = new Map<string, CoderTrainingResponse[]>();

    bundle.variables.forEach(variable => {
      sampledResponsesByConfig.set(
        this.makeTrainingConfigKey(variable.unitId, variable.variableId),
        []
      );
    });

    sampledCaseKeys.forEach(caseKey => {
      const caseResponses = responsesByCase.get(caseKey) || [];
      caseResponses.forEach(response => {
        const configKey = this.makeTrainingConfigKey(
          response.unitName,
          response.variableId
        );
        const responses = sampledResponsesByConfig.get(configKey);
        if (responses) {
          responses.push(response);
        }
      });
    });

    return sampledResponsesByConfig;
  }

  sortTrainingResponses(
    responses: CoderTrainingResponse[],
    caseOrderingMode: 'continuous' | 'alternating' = 'continuous'
  ): CoderTrainingResponse[] {
    const cmp = (v1: string, v2: string) => v1.localeCompare(v2);

    return [...responses].sort((a, b) => {
      if (caseOrderingMode === 'alternating') {
        // Alternating: person first, then booklet, then unit, then variable
        if (a.personLogin !== b.personLogin) return cmp(a.personLogin, b.personLogin);
        if (a.personCode !== b.personCode) return cmp(a.personCode, b.personCode);
        if (a.personGroup !== b.personGroup) return cmp(a.personGroup, b.personGroup);
        if (a.bookletName !== b.bookletName) return cmp(a.bookletName, b.bookletName);
        if (a.unitName !== b.unitName) return cmp(a.unitName, b.unitName);
        if (a.variableId !== b.variableId) return cmp(a.variableId, b.variableId);
        return a.responseId - b.responseId;
      }
      // Continuous: variable first, then unit, then person
      if (a.variableId !== b.variableId) return cmp(a.variableId, b.variableId);
      if (a.unitName !== b.unitName) return cmp(a.unitName, b.unitName);
      if (a.personLogin !== b.personLogin) return cmp(a.personLogin, b.personLogin);
      if (a.personCode !== b.personCode) return cmp(a.personCode, b.personCode);
      if (a.personGroup !== b.personGroup) return cmp(a.personGroup, b.personGroup);
      if (a.bookletName !== b.bookletName) return cmp(a.bookletName, b.bookletName);
      return a.responseId - b.responseId;
    });
  }
}
