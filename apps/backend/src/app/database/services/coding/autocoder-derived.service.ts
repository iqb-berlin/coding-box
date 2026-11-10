import { Injectable, Logger } from '@nestjs/common';
import * as Autocoder from '@iqb/responses';
import { VariableCodingData } from '@iqbspecs/coding-scheme';
import { ResponseEntity } from '../../entities/response.entity';
import { STATISTICS_IGNORED_STATUSES, statusStringToNumber } from '../../utils/response-status-converter';
import {
  AutocoderResponse, CompleteDerivedTuple, CompleteDerivedTupleResolution, CompleteDerivedTuplePreservationReason, CompleteDerivedRecalculation
} from './coding-process.types';
import { normalizeVariableId, autocoderResultKey, normalizeAutocoderValueForComparison } from './autocoder-response.util';
import { AutocoderEngineService } from './autocoder-engine.service';

const CODING_COMPLETE_STATUS = statusStringToNumber('CODING_COMPLETE');
const CODING_INCOMPLETE_STATUS = statusStringToNumber('CODING_INCOMPLETE');
const DERIVE_ERROR_STATUS = statusStringToNumber('DERIVE_ERROR');
const INVALID_STATUS = statusStringToNumber('INVALID');
const COMPARABLE_RECALCULATED_STATUSES = new Set([
  'VALUE_CHANGED',
  'NO_CODING',
  'CODING_INCOMPLETE',
  'CODING_COMPLETE'
]);
const NON_AUTHORITATIVE_V2_RECALCULATION_STATUSES = new Set([
  'DERIVE_ERROR',
  'CODING_INCOMPLETE',
  'INVALID'
]);

type DerivedTarget = {
  outputId: string;
  codingId: string;
  inputId: string;
  subform: string;
  response: ResponseEntity;
  tuple: CompleteDerivedTuple | null;
};

/** Recalculates derived dependencies and decides when completed coding tuples remain authoritative. */
@Injectable()
export class AutocoderDerivedService {
  private readonly logger = new Logger(AutocoderDerivedService.name);

  constructor(private readonly engine: AutocoderEngineService) {}

  isLegacyGeneratedInvalidDerivedResponse(
    response: ResponseEntity,
    inputStatus: number | null,
    inputCode: number | undefined,
    inputScore: number | undefined,
    variableCodings: VariableCodingData[]
  ): boolean {
    if (
      response.is_autocoder_generated !== true ||
      response.autocoder_invalidated_version !== null ||
      inputStatus !== INVALID_STATUS ||
      inputCode !== undefined ||
      inputScore !== undefined ||
      response.status_v2 !== null ||
      response.code_v2 !== null ||
      response.score_v2 !== null
    ) {
      return false;
    }

    const normalizedVariableId = normalizeVariableId(
      response.variableid
    );
    const isDerivedCoding = (coding: VariableCodingData) => (
      (coding.deriveSources?.length || 0) > 0
    );
    const outputMatches = variableCodings.filter(coding => (
      normalizeVariableId(coding.alias || coding.id) ===
        normalizedVariableId
    ));
    if (outputMatches.length > 0) {
      return outputMatches.filter(isDerivedCoding).length === 1;
    }

    const matchingDerivedCodings = variableCodings.filter(coding => (
      isDerivedCoding(coding) &&
      normalizeVariableId(coding.id) === normalizedVariableId
    ));

    return matchingDerivedCodings.length === 1;
  }

  resolveCompleteDerivedTuple(
    autoCoderRun: 1 | 2,
    existingResponse: ResponseEntity | undefined,
    codedResultId: string,
    codedSubform: string,
    independentlyRecalculatedResults: Map<string, AutocoderResponse>,
    independentRecalculationAvailable: boolean,
    variableCodings: VariableCodingData[]
  ): CompleteDerivedTupleResolution {
    if (
      autoCoderRun !== 2 ||
      !existingResponse ||
      !independentRecalculationAvailable
    ) {
      return { action: 'NOT_APPLICABLE' };
    }

    const tuple = this.getCompleteDerivedTuple(existingResponse);
    const hasInvalidatedTuple =
      this.hasInvalidatedCompleteDerivedTuple(existingResponse);
    if (!tuple && !hasInvalidatedTuple) {
      return { action: 'NOT_APPLICABLE' };
    }

    const normalizedResultId = normalizeVariableId(codedResultId);
    const matchingCodings = variableCodings.filter(coding => (
      normalizeVariableId(coding.alias || coding.id) ===
        normalizedResultId
    ));

    if (
      matchingCodings.length !== 1 ||
      (matchingCodings[0].deriveSources?.length || 0) === 0
    ) {
      return { action: 'NOT_APPLICABLE' };
    }

    const recalculatedResult = independentlyRecalculatedResults.get(
      autocoderResultKey(codedResultId, codedSubform)
    );

    if (!recalculatedResult) {
      throw new Error(
        'Autocoder did not return independently recalculated result ' +
        `"${codedResultId}" for response ${existingResponse.id}.`
      );
    }

    if (!tuple) {
      return {
        action: 'RECALCULATE_INVALIDATED',
        recalculatedResult
      };
    }

    const preservationReason = this.getCompleteDerivedTuplePreservationReason(
      tuple,
      existingResponse,
      recalculatedResult
    );

    return preservationReason ?
      { action: 'PRESERVE', tuple, reason: preservationReason } :
      { action: 'DERIVED_VALUE_CHANGED', tuple, recalculatedResult };
  }

  private getCompleteDerivedTuple(
    response: ResponseEntity
  ): CompleteDerivedTuple | null {
    if (response.is_autocoder_generated !== true) {
      return null;
    }

    const hasV2Tuple = response.code_v2 !== null || response.score_v2 !== null;
    const canRecoverFromNonAuthoritativeV3Result =
      response.autocoder_invalidated_version === 'v2' &&
      (
        response.status_v3 === DERIVE_ERROR_STATUS ||
        response.status_v3 === CODING_INCOMPLETE_STATUS ||
        response.status_v3 === INVALID_STATUS
      );
    if (
      (
        response.autocoder_invalidated_version !== 'v2' ||
        canRecoverFromNonAuthoritativeV3Result
      ) &&
      response.status_v2 === CODING_COMPLETE_STATUS &&
      hasV2Tuple
    ) {
      return {
        version: 'v2',
        code: response.code_v2,
        score: response.score_v2
      };
    }

    if (response.autocoder_invalidated_version) {
      return null;
    }

    const hasNoV2Result = this.hasNoV2Result(response);
    const hasV1Tuple = response.code_v1 !== null || response.score_v1 !== null;
    if (
      hasNoV2Result &&
      response.status_v1 === CODING_COMPLETE_STATUS &&
      hasV1Tuple
    ) {
      return {
        version: 'v1',
        code: response.code_v1,
        score: response.score_v1
      };
    }

    return null;
  }

  private hasInvalidatedCompleteDerivedTuple(
    response: ResponseEntity
  ): boolean {
    return response.is_autocoder_generated === true &&
      (
        response.autocoder_invalidated_version === 'v1' ||
        response.autocoder_invalidated_version === 'v2'
      );
  }

  recalculateCompleteDerivedResults(
    autoCoderRun: 1 | 2,
    responses: ResponseEntity[],
    inputResponses: AutocoderResponse[],
    variableCodings: VariableCodingData[]
  ): CompleteDerivedRecalculation {
    if (autoCoderRun !== 2) {
      return {
        targetResults: new Map(),
        authoritativeResults: null,
        independentRecalculationAvailable: true
      };
    }

    const targetsWithoutLevels = this.findRecalculationTargets(responses, variableCodings);

    if (targetsWithoutLevels.length === 0) {
      return {
        targetResults: new Map(),
        authoritativeResults: null,
        independentRecalculationAvailable: true
      };
    }

    let dependencyLevels: Map<string, number>;
    try {
      dependencyLevels = new Map(
        Autocoder.CodingSchemeFactory.getVariableDependencyTree(variableCodings)
          .map(node => [node.id, node.level] as const)
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        'Skipping independent complete-derived-result recalculation because ' +
        `the coding-scheme dependency graph cannot be ordered: ${message}. ` +
        'Falling back to the regular autocoder result.'
      );
      return {
        targetResults: new Map(),
        authoritativeResults: null,
        independentRecalculationAvailable: false
      };
    }
    const targets = targetsWithoutLevels.map(target => {
      const level = dependencyLevels.get(target.codingId);
      if (level === undefined) {
        throw new Error(
          `Autocoder dependency level is missing for derived target "${target.outputId}".`
        );
      }
      return { ...target, level };
    });

    const resultsByTarget = new Map<string, AutocoderResponse>();
    let requiresAuthoritativeRecalculation = false;
    let workingInput: AutocoderResponse[] = inputResponses.map(response => ({
      ...response,
      // The response library treats null and empty subforms as no subform.
      // Normalize them to undefined so its no-subform pipeline does not
      // duplicate stale pass-through responses during recalculation.
      subform: response.subform || undefined
    }));
    const levels = Array.from(new Set(targets.map(target => target.level)))
      .sort((a, b) => a - b);

    levels.forEach(level => {
      const levelTargets = targets.filter(target => target.level === level);
      const next = this.recalculateLevel(levelTargets, workingInput, variableCodings, resultsByTarget);
      requiresAuthoritativeRecalculation ||= next.requiresAuthoritativeRecalculation;
      workingInput = next.workingInput;
    });

    return {
      targetResults: resultsByTarget,
      authoritativeResults: requiresAuthoritativeRecalculation ?
        this.engine.codeAutocoderResponses(workingInput, variableCodings) :
        null,
      independentRecalculationAvailable: true
    };
  }

  private hasNoV2Result(response: ResponseEntity): boolean {
    const hasNoV2Tuple =
      response.code_v2 === null &&
      response.score_v2 === null;
    const inheritsV1Status =
      response.status_v2 === null ||
      (
        response.status_v2 === CODING_INCOMPLETE_STATUS &&
        response.inherits_v1_for_v2 === true
      ) ||
      (
        response.status_v2 !== null &&
        STATISTICS_IGNORED_STATUSES.includes(response.status_v2)
      );
    const hasNoV2Result = hasNoV2Tuple && inheritsV1Status;

    return hasNoV2Result;
  }

  private findRecalculationTargets(
    responses: ResponseEntity[],
    variableCodings: VariableCodingData[]
  ): DerivedTarget[] {
    return variableCodings.flatMap(coding => {
      if ((coding.deriveSources?.length || 0) === 0) {
        return [];
      }

      const outputId = coding.alias || coding.id;
      const normalizedOutputId = normalizeVariableId(outputId);
      const exactOutputResponses = responses
        .filter(response => (
          normalizeVariableId(response.variableid) ===
            normalizedOutputId &&
          (
            this.getCompleteDerivedTuple(response) !== null ||
            this.hasInvalidatedCompleteDerivedTuple(response)
          )
        ));
      const legacyTechnicalIdResponses = exactOutputResponses.length === 0 &&
        coding.alias ?
        responses.filter(response => (
          response.is_autocoder_generated === true &&
          normalizeVariableId(response.variableid) ===
            normalizeVariableId(coding.id) &&
          (
            this.getCompleteDerivedTuple(response) !== null ||
            this.hasInvalidatedCompleteDerivedTuple(response)
          )
        )) :
        [];
      return [...exactOutputResponses, ...legacyTechnicalIdResponses]
        .map(response => {
          const tuple = this.getCompleteDerivedTuple(response);
          return {
            outputId,
            codingId: coding.id,
            inputId: normalizeVariableId(response.variableid),
            subform: String(response.subform || ''),
            response,
            tuple
          };
        })
        .filter(target => target !== null);
    });
  }

  private recalculateLevel(
    levelTargets: DerivedTarget[],
    workingInput: AutocoderResponse[],
    variableCodings: VariableCodingData[],
    resultsByTarget: Map<string, AutocoderResponse>
  ) {
    const levelResults = this.recalculateLevelResults(levelTargets, workingInput, variableCodings);
    let requiresAuthoritativeRecalculation = false;
    const nextStatesByInput = new Map<string, AutocoderResponse>();
    levelTargets.forEach(target => {
      const outputKey = autocoderResultKey(
        target.outputId,
        target.subform
      );
      const recalculatedResult = levelResults.get(outputKey);
      if (!recalculatedResult) {
        throw new Error(
          'Autocoder did not return independently recalculated result ' +
          `"${target.outputId}" for response ${target.response.id}.`
        );
      }
      resultsByTarget.set(outputKey, recalculatedResult);

      const inputKey = autocoderResultKey(
        target.inputId,
        target.subform
      );
      const currentInput = workingInput.find(response => (
        autocoderResultKey(
          response.id,
          String(response.subform || '')
        ) === inputKey
      ));
      if (!currentInput) {
        throw new Error(
          `Autocoder input is missing for derived response ${target.response.id}.`
        );
      }

      const shouldRestoreTuple = target.tuple &&
        this.getCompleteDerivedTuplePreservationReason(
          target.tuple,
          target.response,
          recalculatedResult
        ) !== null;
      if (!shouldRestoreTuple) {
        requiresAuthoritativeRecalculation = true;
      }
      nextStatesByInput.set(inputKey, shouldRestoreTuple ? {
        ...currentInput,
        status: 'CODING_COMPLETE',
        code: target.tuple?.code ?? undefined,
        score: target.tuple?.score ?? undefined
      } : {
        ...currentInput,
        value: recalculatedResult.value,
        status: recalculatedResult.status,
        code: recalculatedResult.code,
        score: recalculatedResult.score
      });
    });

    const nextInput = workingInput.map(response => (
      nextStatesByInput.get(autocoderResultKey(
        response.id,
        String(response.subform || '')
      )) || response
    ));
    return { workingInput: nextInput, requiresAuthoritativeRecalculation };
  }

  private recalculateLevelResults(
    levelTargets: DerivedTarget[],
    workingInput: AutocoderResponse[],
    variableCodings: VariableCodingData[]
  ): Map<string, AutocoderResponse> {
    const levelInputKeys = new Set(levelTargets.map(target => (
      autocoderResultKey(target.inputId, target.subform)
    )));
    const levelOutputKeys = new Set(levelTargets.map(target => (
      autocoderResultKey(target.outputId, target.subform)
    )));
    const recalculationInput = workingInput.map(response => {
      const key = autocoderResultKey(
        response.id,
        String(response.subform || '')
      );
      return levelInputKeys.has(key) ? {
        ...response,
        status: 'UNSET' as const,
        code: undefined,
        score: undefined
      } : response;
    });
    const recalculatedResults = this.engine.codeAutocoderResponses(
      recalculationInput,
      variableCodings
    );
    const levelResults = new Map<string, AutocoderResponse>();

    recalculatedResults.forEach(result => {
      const key = autocoderResultKey(
        result.id,
        String(result.subform || '')
      );
      if (!levelOutputKeys.has(key)) {
        return;
      }
      if (levelResults.has(key)) {
        throw new Error(
          'Autocoder returned multiple independently recalculated results ' +
          `for derived target "${result.id}".`
        );
      }
      levelResults.set(key, result);
    });

    return levelResults;
  }

  private hasUnchangedDerivedValue(
    response: ResponseEntity,
    recalculatedResult: AutocoderResponse
  ): boolean {
    return COMPARABLE_RECALCULATED_STATUSES.has(recalculatedResult.status) &&
      normalizeAutocoderValueForComparison(recalculatedResult.value) ===
        normalizeAutocoderValueForComparison(response.value);
  }

  private getCompleteDerivedTuplePreservationReason(
    tuple: CompleteDerivedTuple,
    response: ResponseEntity,
    recalculatedResult: AutocoderResponse
  ): CompleteDerivedTuplePreservationReason | null {
    if (
      tuple.version === 'v2' &&
      NON_AUTHORITATIVE_V2_RECALCULATION_STATUSES.has(
        recalculatedResult.status
      )
    ) {
      return 'V2_RECALCULATION_NOT_COMPLETE';
    }

    return this.hasUnchangedDerivedValue(response, recalculatedResult) ?
      'UNCHANGED' :
      null;
  }
}
