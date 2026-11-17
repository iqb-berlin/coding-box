import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { CodingScheme, VariableCodingData } from '@iqbspecs/coding-scheme';
import { Unit } from '../../entities/unit.entity';
import { ResponseEntity } from '../../entities/response.entity';
import { CodedResponse, CodingStatistics } from '../shared';
import { STATISTICS_IGNORED_STATUSES, statusStringToNumber, statusNumberToString } from '../../utils/response-status-converter';
import { omitShadowedGeneratedSourcePlaceholders } from './autocoder-source-placeholder.util';
import {
  AutocoderPersistenceSource, AutocoderPreflightContext, AutocoderResponse, CompleteDerivedRecalculation, CompleteDerivedTupleResolution
} from './coding-process.types';
import { AutocoderEngineService } from './autocoder-engine.service';
import { AutocoderDerivedService } from './autocoder-derived.service';
import { AutocoderSchemeService } from './autocoder-scheme.service';
import {
  getUnitFileId, normalizeVariableId, normalizeAutocoderNumericInput, serializeAutocoderValue, normalizeAutocoderValueForComparison
} from './autocoder-response.util';

const CODING_INCOMPLETE_STATUS = statusStringToNumber('CODING_INCOMPLETE');
const UNSET_STATUS = statusStringToNumber('UNSET') as number;

export type AutocoderResponseBatch = {
  workspaceId: number;
  units: Unit[];
  unitToResponsesMap: Map<number | string, ResponseEntity[]>;
  unitToCodingSchemeRefMap: Map<number, string>;
  fileIdToCodingSchemeMap: Map<string, CodingScheme>;
  statistics: CodingStatistics;
  autoCoderRun: 1 | 2;
  jobId?: string;
  progressCallback?: (progress: number) => void;
  preflightContext?: AutocoderPreflightContext;
  maxCodedResponses?: number;
  preflightManager?: EntityManager;
  isJobCancelled?: () => Promise<boolean>;
};

type PersistedTuple = {
  persistedStatus: string;
  persistedCode: number | null;
  persistedScore: number | null;
  completeTupleResolution: CompleteDerivedTupleResolution;
};

/** Builds response updates and diagnostics in memory; persistence belongs to CodingProcessService. */
@Injectable()
export class AutocoderResponseService {
  private readonly logger = new Logger(AutocoderResponseService.name);

  constructor(
    private readonly engine: AutocoderEngineService,
    private readonly derived: AutocoderDerivedService,
    private readonly schemes: AutocoderSchemeService
  ) {}

  async processAndCodeResponses(
    batch: AutocoderResponseBatch
  ): Promise<{
    allCodedResponses: CodedResponse[];
    statistics: CodingStatistics;
  }> {
    const {
      workspaceId, units, unitToResponsesMap, unitToCodingSchemeRefMap,
      fileIdToCodingSchemeMap, statistics, autoCoderRun, jobId, progressCallback,
      preflightContext, maxCodedResponses = Number.MAX_SAFE_INTEGER,
      preflightManager, isJobCancelled = async () => false
    } = batch;
    const allCodedResponses: CodedResponse[] = [];
    const persistenceSources: AutocoderPersistenceSource[] = [];
    let responseIndex = 0;
    const batchSize = 50;
    const emptyScheme = new CodingScheme({});
    const codingSchemeValidations = preflightContext?.codingSchemeValidations ||
      new Map<string, Promise<void>>();

    for (let i = 0; i < units.length; i += batchSize) {
      const unitBatch = units.slice(i, i + batchSize);

      for (const unit of unitBatch) {
        const unitResponses = unitToResponsesMap.get(unit.id) || [];
        if (unitResponses.length === 0) continue;
        const { codingSchemeRef, scheme } = this.getUnitScheme(
          unit.id, unitToCodingSchemeRefMap, fileIdToCodingSchemeMap, emptyScheme
        );
        const responses = omitShadowedGeneratedSourcePlaceholders(
          unitResponses,
          scheme.variableCodings || []
        );
        statistics.totalResponses += responses.length;

        await this.validateUnitScheme(
          workspaceId, unit, scheme, codingSchemeRef, codingSchemeValidations, preflightManager
        );

        const {
          inputResponses, completeDerivedRecalculation, resultsToPersist,
          technicalIdFallbackByAlias
        } = this.calculateUnitResponses(responses, scheme, autoCoderRun);

        if (responseIndex + resultsToPersist.length > maxCodedResponses) {
          throw new Error(
            'Auto-coding batch exceeds its remaining in-memory plan budget ' +
            `of ${maxCodedResponses} responses.`
          );
        }

        for (const codedResult of resultsToPersist) {
          const existingResponse = this.findExistingResponseForAutocoderResult(
            responses, codedResult.id, codedResult.subform || '', technicalIdFallbackByAlias
          );
          const tuple = this.resolvePersistedTuple(
            codedResult, existingResponse, autoCoderRun, completeDerivedRecalculation, scheme.variableCodings || []
          );
          const { persistedStatus } = tuple;
          statistics.statusCounts[persistedStatus] = (statistics.statusCounts[persistedStatus] || 0) + 1;
          const codedResponse = this.createCodedResponse(
            unit, codedResult, existingResponse, autoCoderRun, completeDerivedRecalculation, tuple
          );
          allCodedResponses.push(codedResponse);
          persistenceSources.push(this.createPersistenceSource(
            unit, codedResult, existingResponse, codingSchemeRef, responseIndex, tuple, inputResponses, scheme.variableCodings || []
          ));
          responseIndex += 1;
        }
      }

      if (jobId && (await isJobCancelled())) {
        this.logger.log(
          `Job ${jobId} was cancelled or paused during response processing`
        );
        return { allCodedResponses, statistics };
      }
    }

    this.assertUniqueAutocoderPersistenceTargets(
      allCodedResponses,
      persistenceSources
    );

    if (progressCallback) {
      progressCallback(95);
    }

    return { allCodedResponses, statistics };
  }

  private getUnitScheme(
    unitId: number,
    unitToCodingSchemeRefMap: Map<number, string>,
    fileIdToCodingSchemeMap: Map<string, CodingScheme>,
    emptyScheme: CodingScheme
  ) {
    const codingSchemeRef = unitToCodingSchemeRefMap.get(unitId);
    const scheme = codingSchemeRef ?
      fileIdToCodingSchemeMap.get(codingSchemeRef) || emptyScheme :
      emptyScheme;

    return { codingSchemeRef, scheme };
  }

  private createPersistenceSource(
    unit: Unit,
    codedResult: AutocoderResponse,
    existingResponse: ResponseEntity | undefined,
    codingSchemeRef: string | undefined,
    index: number,
    tuple: PersistedTuple,
    inputResponses: AutocoderResponse[],
    variableCodings: VariableCodingData[]
  ): AutocoderPersistenceSource {
    return {
      resultId: String(codedResult.id),
      resultIndex: index,
      targetVariableId: String(
        existingResponse?.variableid ?? codedResult.id
      ),
      unitId: unit.id,
      unitName: unit.name,
      codingSchemeRef,
      subform: String(codedResult.subform || ''),
      status: tuple.persistedStatus,
      code: tuple.persistedCode,
      possibleOrigins: this.describeAutocoderResultCandidates(
        String(codedResult.id),
        inputResponses,
        variableCodings
      )
    };
  }

  private calculateUnitResponses(
    responses: ResponseEntity[],
    scheme: CodingScheme,
    autoCoderRun: 1 | 2
  ) {
    const technicalIdFallbackByAlias =
      this.createUnambiguousTechnicalIdFallbacks(
        scheme.variableCodings || []
      );

    const inputResponses = responses.map(response => this.createInputResponse(response, autoCoderRun, scheme.variableCodings || []));

    const codedResults = this.engine.codeAutocoderResponses(
      inputResponses,
      scheme.variableCodings || [],
      responses.map(response => ({
        responseId: response.id,
        storedVariableId: String(response.variableid),
        isAutocoderGenerated: response.is_autocoder_generated === true
      }))
    );
    const completeDerivedRecalculation =
      this.derived.recalculateCompleteDerivedResults(
        autoCoderRun,
        responses,
        inputResponses,
        scheme.variableCodings || []
      );
    const resultsToPersist =
      completeDerivedRecalculation.authoritativeResults || codedResults;
    return {
      inputResponses, completeDerivedRecalculation, resultsToPersist, technicalIdFallbackByAlias
    };
  }

  private createInputResponse(
    response: ResponseEntity,
    autoCoderRun: 1 | 2,
    variableCodings: VariableCodingData[]
  ): AutocoderResponse {
    let inputStatus = response.status;
    let inputCode: number | undefined;
    let inputScore: number | undefined;
    if (autoCoderRun === 2) {
      ({ inputStatus, inputCode, inputScore } = this.getSecondRunInput(response));

      // Older run-1 data can contain empty generated derived targets as
      // INVALID. Re-open only those untouched legacy targets so run 2
      // derives them again; imported and V2-reviewed rows stay intact.
      if (
        this.derived.isLegacyGeneratedInvalidDerivedResponse(
          response,
          inputStatus,
          inputCode,
          inputScore,
          variableCodings
        )
      ) {
        inputStatus = UNSET_STATUS;
      }
    }
    let responseValue = response.value as import('@iqbspecs/response/response.interface').ResponseValueType;
    const isArrayString = typeof response.value === 'string' && /^\[.*]$/.test(response.value);
    if (isArrayString && response.value !== null) {
      try {
        responseValue = JSON.parse(response.value);
      } catch (e) {
      // ignore
      }
    }
    return {
      id: String(response.variableid),
      value: responseValue,
      status: statusNumberToString(inputStatus) as AutocoderResponse['status'],
      subform: response.subform ?? undefined,
      code: inputCode,
      score: inputScore
    };
  }

  private getSecondRunInput(response: ResponseEntity) {
    let inputStatus = response.status;
    let inputCode: number | undefined;
    let inputScore: number | undefined;
    if (response.autocoder_invalidated_version) {
      inputStatus = response.status_v3 ?? UNSET_STATUS;
      inputCode = normalizeAutocoderNumericInput(
        response.code_v3
      );
      inputScore = normalizeAutocoderNumericInput(
        response.score_v3
      );
    } else {
      const isOpenV2Placeholder =
        response.status_v2 === CODING_INCOMPLETE_STATUS &&
        response.code_v2 === null &&
        response.score_v2 === null &&
        response.inherits_v1_for_v2 === true;
      const isIgnoredV2Placeholder =
        response.code_v2 === null &&
        response.score_v2 === null &&
        response.status_v2 !== null &&
        STATISTICS_IGNORED_STATUSES.includes(response.status_v2);
      const hasV2Result =
        !isOpenV2Placeholder &&
        !isIgnoredV2Placeholder && (
          response.status_v2 !== null ||
          response.code_v2 !== null ||
          response.score_v2 !== null
        );
      if (hasV2Result) {
        inputStatus =
          response.status_v2 ?? response.status_v1 ?? response.status;
        inputCode = normalizeAutocoderNumericInput(
          response.code_v2
        );
        inputScore = normalizeAutocoderNumericInput(
          response.score_v2
        );
      } else {
        inputStatus = response.status_v1 ?? response.status;
        inputCode = normalizeAutocoderNumericInput(
          response.code_v1
        );
        inputScore = normalizeAutocoderNumericInput(
          response.score_v1
        );
      }
    }

    return { inputStatus, inputCode, inputScore };
  }

  private resolvePersistedTuple(
    codedResult: AutocoderResponse,
    existingResponse: ResponseEntity | undefined,
    autoCoderRun: 1 | 2,
    completeDerivedRecalculation: CompleteDerivedRecalculation,
    variableCodings: VariableCodingData[]
  ): PersistedTuple {
    const codedStatus = this.normalizeAutocoderStatus(codedResult.status);
    const codedSubform = codedResult.subform || '';
    const completeTupleResolution =
      this.derived.resolveCompleteDerivedTuple(
        autoCoderRun,
        existingResponse,
        codedResult.id,
        codedSubform,
        completeDerivedRecalculation.targetResults,
        completeDerivedRecalculation.independentRecalculationAvailable,
        variableCodings
      );
    let persistedStatus = codedStatus;
    let persistedCode = codedResult.code ?? null;
    let persistedScore = codedResult.score ?? null;

    if (completeTupleResolution.action === 'PRESERVE') {
      persistedStatus = 'CODING_COMPLETE';
      persistedCode = completeTupleResolution.tuple.code;
      persistedScore = completeTupleResolution.tuple.score;
    } else if (
      completeTupleResolution.action === 'DERIVED_VALUE_CHANGED' ||
      completeTupleResolution.action === 'RECALCULATE_INVALIDATED'
    ) {
      const recalculatedResult =
        completeTupleResolution.recalculatedResult;
      persistedStatus = this.normalizeAutocoderStatus(
        recalculatedResult.status
      );
      persistedCode = recalculatedResult.code ?? null;
      persistedScore = recalculatedResult.score ?? null;
    }
    this.logTupleResolution(existingResponse, codedResult, {
      completeTupleResolution, persistedStatus, persistedCode, persistedScore
    });
    return {
      completeTupleResolution, persistedStatus, persistedCode, persistedScore
    };
  }

  private logTupleResolution(
    existingResponse: ResponseEntity | undefined,
    codedResult: AutocoderResponse,
    tuple: PersistedTuple
  ): void {
    const { completeTupleResolution, persistedCode, persistedScore } = tuple;
    const codedStatus = this.normalizeAutocoderStatus(codedResult.status);
    if (
      completeTupleResolution.action === 'PRESERVE' &&
      existingResponse &&
      (
        completeTupleResolution.reason ===
          'V2_RECALCULATION_NOT_COMPLETE' ||
        codedStatus !== 'CODING_COMPLETE' ||
        persistedCode !== (codedResult.code ?? null) ||
        persistedScore !== (codedResult.score ?? null)
      )
    ) {
      const preservationReason =
        completeTupleResolution.reason ===
          'V2_RECALCULATION_NOT_COMPLETE' ?
          'because its independent recalculation did not produce a ' +
            'complete result' :
          'because its independently recalculated derived value is ' +
            'unchanged';
      this.logger.warn(
        `Preserving complete ${completeTupleResolution.tuple.version.toUpperCase()} ` +
        'tuple for response ' +
        `${existingResponse.id}, variable ` +
        `"${existingResponse.variableid}", ${preservationReason}.`
      );
    } else if (
      completeTupleResolution.action === 'DERIVED_VALUE_CHANGED' &&
      existingResponse
    ) {
      this.logger.warn(
        `Not preserving complete ${completeTupleResolution.tuple.version.toUpperCase()} ` +
        'tuple for response ' +
        `${existingResponse.id}, variable ` +
        `"${existingResponse.variableid}", because the recalculated ` +
        'derived value changed.'
      );
    }
  }

  private createCodedResponse(
    unit: Unit,
    codedResult: AutocoderResponse,
    existingResponse: ResponseEntity | undefined,
    autoCoderRun: 1 | 2,
    completeDerivedRecalculation: CompleteDerivedRecalculation,
    tuple: PersistedTuple
  ): CodedResponse {
    const {
      completeTupleResolution, persistedStatus, persistedCode, persistedScore
    } = tuple;
    const codedResponse: CodedResponse = {
      id: existingResponse ? existingResponse.id : -1
    };
    const hasAuthoritativeDerivedValueChange =
      completeTupleResolution.action !== 'PRESERVE' &&
      completeDerivedRecalculation.authoritativeResults !== null &&
      existingResponse?.is_autocoder_generated === true &&
      normalizeAutocoderValueForComparison(codedResult.value) !==
        normalizeAutocoderValueForComparison(
          existingResponse.value
        );

    if (existingResponse?.is_autocoder_generated) {
      codedResponse.isAutocoderGenerated = true;
      codedResponse.unitid = existingResponse.unitid;
      codedResponse.variableid = existingResponse.variableid;
      codedResponse.subform = existingResponse.subform;
      if (
        completeTupleResolution.action === 'DERIVED_VALUE_CHANGED' ||
        completeTupleResolution.action === 'RECALCULATE_INVALIDATED' ||
        hasAuthoritativeDerivedValueChange
      ) {
        codedResponse.value = serializeAutocoderValue(
          completeTupleResolution.action === 'DERIVED_VALUE_CHANGED' ||
          completeTupleResolution.action === 'RECALCULATE_INVALIDATED' ?
            completeTupleResolution.recalculatedResult.value :
            codedResult.value
        );
        codedResponse.status = statusStringToNumber('VALUE_CHANGED');
      }
    } else if (!existingResponse) {
      codedResponse.isNew = true;
      codedResponse.unitid = unit.id;
      codedResponse.variableid = codedResult.id;
      codedResponse.value = serializeAutocoderValue(
        codedResult.value
      );
      codedResponse.status = statusStringToNumber('VALUE_CHANGED');
      codedResponse.subform = codedResult.subform;
      codedResponse.isAutocoderGenerated = true;
    }

    if (autoCoderRun === 1) {
      codedResponse.autocoderInvalidatedVersion = null;
      codedResponse.code_v1 = persistedCode;
      codedResponse.status_v1 = persistedStatus;
      codedResponse.score_v1 = persistedScore;
      codedResponse.code_v2 = null;
      codedResponse.status_v2 = null;
      codedResponse.score_v2 = null;
      codedResponse.code_v3 = null;
      codedResponse.status_v3 = null;
      codedResponse.score_v3 = null;
    } else if (autoCoderRun === 2) {
      codedResponse.code_v3 = persistedCode;
      codedResponse.status_v3 = persistedStatus;
      codedResponse.score_v3 = persistedScore;
      if (
        completeTupleResolution.action === 'DERIVED_VALUE_CHANGED'
      ) {
        codedResponse.autocoderInvalidatedVersion = completeTupleResolution.tuple.version;
      } else if (
        completeTupleResolution.action === 'PRESERVE' ||
        completeTupleResolution.action === 'RECALCULATE_INVALIDATED'
      ) {
        codedResponse.autocoderInvalidatedVersion = null;
      }
    }
    return codedResponse;
  }

  private async validateUnitScheme(
    workspaceId: number,
    unit: Unit,
    scheme: CodingScheme,
    codingSchemeRef: string | undefined,
    codingSchemeValidations: Map<string, Promise<void>>,
    preflightManager?: EntityManager
  ): Promise<void> {
    if (codingSchemeRef) {
      const unitFileId = getUnitFileId(unit);
      const validationKey = [
        codingSchemeRef,
        unitFileId || unit.id
      ].join(':');
      let validation = codingSchemeValidations.get(validationKey);
      if (!validation) {
        validation = this.schemes.validateCodingSchemeForUnit(
          workspaceId,
          codingSchemeRef,
          unitFileId ?? undefined,
          unit,
          scheme,
          preflightManager
        );
        codingSchemeValidations.set(validationKey, validation);
      }
      await validation;
    }
  }

  createUnambiguousTechnicalIdFallbacks(
    variableCodings: VariableCodingData[]
  ): Map<string, string> {
    const outputVariableIds = new Set(
      variableCodings
        .map(coding => normalizeVariableId(coding.alias || coding.id))
        .filter(Boolean)
    );
    const technicalIdFallbackByAlias = new Map<string, string>();

    variableCodings.forEach(coding => {
      const alias = coding.alias || coding.id;
      const technicalId = coding.id;
      if (!alias || !technicalId) {
        return;
      }

      const normalizedAlias = normalizeVariableId(alias);
      const normalizedTechnicalId = normalizeVariableId(technicalId);

      // A technical ID that is also another coding's output alias is
      // ambiguous and must never be used as a compatibility fallback.
      if (
        normalizedAlias === normalizedTechnicalId ||
        outputVariableIds.has(normalizedTechnicalId)
      ) {
        return;
      }

      technicalIdFallbackByAlias.set(normalizedAlias, technicalId);
    });

    return technicalIdFallbackByAlias;
  }

  findExistingResponseForAutocoderResult(
    responses: ResponseEntity[],
    codedResultId: string,
    codedSubform: string,
    technicalIdFallbackByAlias: Map<string, string>
  ): ResponseEntity | undefined {
    const normalizedResultId = normalizeVariableId(codedResultId);
    const hasMatchingSubform = (response: ResponseEntity) => (
      String(response.subform || '') === codedSubform
    );
    const newestResponse = (matchingResponses: ResponseEntity[]) => (
      matchingResponses.sort((a, b) => b.id - a.id)[0]
    );

    // Test-result response IDs use the variable alias. An exact alias match
    // must win even when that alias is also another variable's technical ID.
    const exactAliasMatch = responses
      .filter(response => (
        normalizeVariableId(response.variableid) === normalizedResultId &&
        hasMatchingSubform(response)
      ))
      .sort((a, b) => (
        Number(a.is_autocoder_generated) -
          Number(b.is_autocoder_generated) ||
        b.id - a.id
      ))[0];
    if (exactAliasMatch) {
      return exactAliasMatch;
    }

    const mappedTechnicalId = technicalIdFallbackByAlias.get(
      normalizedResultId
    );
    if (
      !mappedTechnicalId ||
      normalizeVariableId(mappedTechnicalId) === normalizedResultId
    ) {
      return undefined;
    }

    // Older runs may have persisted generated derived responses under the
    // technical ID. Keep that compatibility fallback strictly limited to
    // generated rows so an imported response with a colliding alias can never
    // receive another variable's result.
    return newestResponse(
      responses.filter(response => (
        response.is_autocoder_generated === true &&
        normalizeVariableId(response.variableid) ===
          normalizeVariableId(mappedTechnicalId) &&
        hasMatchingSubform(response)
      ))
    );
  }

  assertUniqueAutocoderPersistenceTargets(
    codedResponses: CodedResponse[],
    sources?: AutocoderPersistenceSource[]
  ): void {
    const targetIndexes = new Map<string, number>();

    codedResponses.forEach((response, index) => {
      const target = response.isNew ?
        `generated:${response.unitid}:${normalizeVariableId(
          response.variableid
        )}:${String(response.subform || '')}` :
        `response:${response.id}`;
      const previousIndex = targetIndexes.get(target);

      if (previousIndex !== undefined) {
        const previousSource = sources?.[previousIndex];
        const currentSource = sources?.[index];
        if (previousSource && currentSource) {
          const schemeRef = currentSource.codingSchemeRef ||
            previousSource.codingSchemeRef ||
            'unknown';
          throw new Error(
            `Autocoder produced multiple updates for ${target} in coding scheme ` +
            `"${schemeRef}", unit "${currentSource.unitName}" ` +
            `(${currentSource.unitId}), target variable ` +
            `"${currentSource.targetVariableId}". Results: ` +
            `${this.formatAutocoderPersistenceSource(previousSource)} and ` +
            `${this.formatAutocoderPersistenceSource(currentSource)}. ` +
            'Possible origins are diagnostic hints, not proven provenance.'
          );
        }

        throw new Error(
          `Autocoder produced multiple updates for ${target} ` +
          `(results ${previousIndex + 1} and ${index + 1}).`
        );
      }

      targetIndexes.set(target, index);
    });
  }

  private describeAutocoderResultCandidates(
    resultId: string,
    inputResponses: Array<{ id: string }>,
    variableCodings: VariableCodingData[]
  ): string[] {
    const normalizedResultId = normalizeVariableId(resultId);
    const candidates: string[] = [];

    if (inputResponses.some(response => (
      normalizeVariableId(response.id) === normalizedResultId
    ))) {
      candidates.push(`input/pass-through "${resultId}"`);
    }

    variableCodings
      .filter(coding => (
        normalizeVariableId(coding.alias || coding.id) ===
          normalizedResultId
      ))
      .forEach(coding => {
        const alias = coding.alias && coding.alias !== coding.id ?
          ` -> alias "${coding.alias}"` :
          '';
        candidates.push(
          `${coding.sourceType || 'unknown'} coding "${coding.id}"${alias}`
        );
      });

    return candidates.length > 0 ? candidates : [`result "${resultId}"`];
  }

  private formatAutocoderPersistenceSource(
    source: AutocoderPersistenceSource
  ): string {
    return `result ${source.resultIndex + 1} ` +
      `("${source.resultId}", subform "${source.subform}", ` +
      `status "${source.status}", code ${String(source.code)}; ` +
      `possible origins: ${source.possibleOrigins.join(' or ')})`;
  }

  private normalizeAutocoderStatus(status: string): string {
    const nonCodingStatuses: string[] = [];
    if (nonCodingStatuses.includes(status)) {
      return 'NO_CODING';
    }
    return status;
  }
}
