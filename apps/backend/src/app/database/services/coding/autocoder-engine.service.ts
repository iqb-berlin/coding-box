import { Injectable } from '@nestjs/common';
import { VariableCodingData } from '@iqbspecs/coding-scheme';
import { CodingSchemeFactory as CompatibleCodingSchemeFactory } from './generated/autocoder-compatibility-engine';
import { createAutocoderOutputShadows } from './autocoder-output-shadow.util';
import {
  AutocoderInputOrigin, AutocoderNamespace, AutocoderNamespaceComponent, AutocoderResponse
} from './coding-process.types';
import { normalizeVariableId, autocoderResultKey } from './autocoder-response.util';

/** Adapts public aliases and generated-response provenance to the engine namespace without database access. */
@Injectable()
export class AutocoderEngineService {
  createAutocoderNamespace(
    variableCodings: VariableCodingData[]
  ): AutocoderNamespace {
    const outputShadows = createAutocoderOutputShadows(variableCodings);

    const shadowingDerivedIds = new Set(
      outputShadows.map(pair => (
        normalizeVariableId(pair.derivedTechnicalId)
      ))
    );
    const inputTechnicalIdByAlias = new Map<string, string>();
    const outputAliasByTechnicalId = new Map<string, string>();

    variableCodings.forEach(coding => {
      const technicalId = String(coding.id);
      const outputAlias = String(coding.alias || coding.id);
      outputAliasByTechnicalId.set(
        normalizeVariableId(technicalId),
        outputAlias
      );

      // In the supported derived-shadowing pattern, the imported alias is the
      // base variable. The derived coding owns the final output only after its
      // derivation has run.
      if (!shadowingDerivedIds.has(normalizeVariableId(technicalId))) {
        inputTechnicalIdByAlias.set(
          normalizeVariableId(outputAlias),
          technicalId
        );
      }
    });

    return {
      variableCodings: variableCodings.map(coding => ({
        ...coding,
        sourceParameters: coding.sourceType === 'SOLVER' &&
          coding.sourceParameters?.solverExpression ?
          {
            ...coding.sourceParameters,
            solverExpression: this.rewriteSolverExpressionAliases(
              coding.sourceParameters.solverExpression,
              inputTechnicalIdByAlias
            )
          } :
          coding.sourceParameters,
        // The response library otherwise merges the technical-ID and alias
        // namespaces. Internally use technical IDs only and map results back
        // to their public aliases after coding.
        alias: String(coding.id)
      })),
      inputTechnicalIdByAlias,
      outputAliasByTechnicalId,
      componentById: this.createAutocoderNamespaceComponents(variableCodings),
      outputShadows
    };
  }

  private rewriteSolverExpressionAliases(
    solverExpression: string,
    inputTechnicalIdByAlias: Map<string, string>
  ): string {
    return solverExpression.replace(/\$\{([^{}]*)}/g, (token, content) => {
      const policySeparator = content.indexOf(':');
      const sourceReference = policySeparator >= 0 ?
        content.slice(0, policySeparator) :
        content;
      const policies = policySeparator >= 0 ?
        content.slice(policySeparator) :
        '';
      const fragmentStart = sourceReference.lastIndexOf('[');
      const alias = (
        fragmentStart >= 0 ?
          sourceReference.slice(0, fragmentStart) :
          sourceReference
      ).trim();
      const fragment = fragmentStart >= 0 ?
        sourceReference.slice(fragmentStart).trim() :
        '';
      const technicalId = inputTechnicalIdByAlias.get(
        normalizeVariableId(alias)
      );

      return technicalId ?
        `\${${technicalId}${fragment}${policies}}` :
        token;
    });
  }

  private createAutocoderNamespaceComponents(
    variableCodings: VariableCodingData[]
  ): Map<string, AutocoderNamespaceComponent> {
    const technicalIds = new Set<string>();
    const outputAliases = new Set<string>();
    const neighbors = new Map<string, Set<string>>();
    const addNode = (id: string): void => {
      if (!neighbors.has(id)) {
        neighbors.set(id, new Set<string>());
      }
    };

    variableCodings.forEach(coding => {
      const technicalId = normalizeVariableId(coding.id);
      const outputAlias = normalizeVariableId(coding.alias || coding.id);
      technicalIds.add(technicalId);
      outputAliases.add(outputAlias);
      addNode(technicalId);
      addNode(outputAlias);
      if (technicalId !== outputAlias) {
        neighbors.get(technicalId)!.add(outputAlias);
        neighbors.get(outputAlias)!.add(technicalId);
      }
    });

    const componentById = new Map<string, AutocoderNamespaceComponent>();
    const visited = new Set<string>();
    neighbors.forEach((_unused, startId) => {
      if (visited.has(startId)) {
        return;
      }

      const componentIds = new Set<string>();
      const pending = [startId];
      while (pending.length > 0) {
        const currentId = pending.pop()!;
        if (visited.has(currentId)) {
          continue;
        }
        visited.add(currentId);
        componentIds.add(currentId);
        neighbors.get(currentId)?.forEach(neighbor => {
          if (!visited.has(neighbor)) {
            pending.push(neighbor);
          }
        });
      }

      const component: AutocoderNamespaceComponent = {
        aliasOnlyIds: new Set(
          Array.from(componentIds).filter(
            id => outputAliases.has(id) && !technicalIds.has(id)
          )
        ),
        outputAliasIds: new Set(
          Array.from(componentIds).filter(id => outputAliases.has(id))
        ),
        technicalOnlyIds: new Set(
          Array.from(componentIds).filter(
            id => technicalIds.has(id) && !outputAliases.has(id)
          )
        )
      };
      componentIds.forEach(id => componentById.set(id, component));
    });

    return componentById;
  }

  codeAutocoderResponses(
    responses: AutocoderResponse[],
    variableCodings: VariableCodingData[],
    inputOrigins?: AutocoderInputOrigin[]
  ): AutocoderResponse[] {
    if (inputOrigins && inputOrigins.length !== responses.length) {
      throw new Error(
        'Autocoder input provenance does not match the response count.'
      );
    }

    const namespace = this.createAutocoderNamespace(variableCodings);
    const canonicalResponses = this.canonicalizeInputs(responses, namespace, inputOrigins);
    const canonicalResults = CompatibleCodingSchemeFactory.code(
      canonicalResponses,
      namespace.variableCodings
    );
    const missingAwareResults = this.deferAllMissingSumScoreResults(
      canonicalResults,
      namespace.variableCodings
    );
    const derivedResultKeys = new Set<string>();

    namespace.outputShadows.forEach(pair => {
      missingAwareResults
        .filter(result => (
          normalizeVariableId(result.id) ===
            normalizeVariableId(pair.derivedTechnicalId)
        ))
        .forEach(result => {
          derivedResultKeys.add(autocoderResultKey(
            pair.baseTechnicalId,
            String(result.subform || '')
          ));
        });
    });

    return missingAwareResults
      .filter(result => !namespace.outputShadows.some(pair => (
        normalizeVariableId(result.id) ===
          normalizeVariableId(pair.baseTechnicalId) &&
        (
          pair.kind === 'BASE_NO_VALUE_DERIVED' ||
          derivedResultKeys.has(autocoderResultKey(
            pair.baseTechnicalId,
            String(result.subform || '')
          ))
        )
      )))
      .map(result => ({
        ...result,
        id: namespace.outputAliasByTechnicalId.get(
          normalizeVariableId(result.id)
        ) || result.id,
        subform: result.subform || undefined
      }));
  }

  private assertUnambiguousGeneratedInput(
    response: AutocoderResponse,
    normalizedInputId: string,
    mappedTechnicalId: string | undefined,
    isAutocoderGenerated: boolean,
    namespace: AutocoderNamespace,
    baseNoValueShadowDerivedIds: Set<string>,
    generatedInputIdsBySubform: Map<string, Set<string>>,
    describeInput: () => string
  ): void {
    const isAmbiguousGeneratedInput =
      isAutocoderGenerated &&
      mappedTechnicalId !== undefined &&
      normalizeVariableId(mappedTechnicalId) !== normalizedInputId &&
      namespace.outputAliasByTechnicalId.has(normalizedInputId);
    const isEmptyGeneratedPlaceholder = this.isEmptyGeneratedPlaceholder(response, isAutocoderGenerated);

    if (
      isAmbiguousGeneratedInput &&
      !isEmptyGeneratedPlaceholder &&
      !baseNoValueShadowDerivedIds.has(normalizedInputId)
    ) {
      const subform = String(response.subform || '');
      const component = namespace.componentById.get(normalizedInputId);
      // Only rows previously produced by the Autocoder can prove how an
      // ambiguous generated ID was persisted. Imported rows may use the
      // same public aliases but provide no provenance for this row.
      const inputIds =
        generatedInputIdsBySubform.get(subform) || new Set<string>();
      const aliasEvidence = Array.from(component?.aliasOnlyIds || []).filter(
        id => inputIds.has(id)
      );
      const technicalEvidence = Array.from(
        component?.technicalOnlyIds || []
      ).filter(id => inputIds.has(id));
      const missingOutputAliases = Array.from(
        component?.outputAliasIds || []
      ).filter(id => !inputIds.has(id));
      const hasProvenAliasNamespace =
        aliasEvidence.length > 0 &&
        technicalEvidence.length === 0 &&
        missingOutputAliases.length === 0;

      if (!hasProvenAliasNamespace) {
        const formatEvidence = (ids: string[]): string => (
          ids.length > 0 ? ids.map(id => `"${id}"`).join(', ') : 'none'
        );
        throw new Error(
          'Autocoder input namespace is ambiguous for ' +
            `${describeInput()}, subform "${subform}": stored variable ` +
            `"${response.id}" is both the output alias for technical ` +
            `variable "${mappedTechnicalId}" and a technical variable. ` +
            'Alias encoding is not proven for this namespace component ' +
            `(alias-only evidence: ${formatEvidence(aliasEvidence)}; ` +
            'technical-only evidence: ' +
            `${formatEvidence(technicalEvidence)}; missing output aliases: ` +
            `${formatEvidence(missingOutputAliases)}).`
        );
      }
    }
  }

  private isEmptyGeneratedPlaceholder(response: AutocoderResponse, isAutocoderGenerated: boolean): boolean {
    return isAutocoderGenerated &&
      response.status === 'UNSET' &&
      (
        response.value === '' ||
        response.value === null ||
        response.value === undefined
      ) &&
      (response.code === null || response.code === undefined) &&
      (response.score === null || response.score === undefined);
  }

  private canonicalizeInputs(
    responses: AutocoderResponse[],
    namespace: AutocoderNamespace,
    inputOrigins?: AutocoderInputOrigin[]
  ): AutocoderResponse[] {
    // A generated derived target in this validated shadow uses the same ID as
    // the structural variable's public alias by design. The generic alias-chain
    // proof cannot contain an alias-only ID for this two-node namespace.
    const baseNoValueShadowDerivedIds = new Set(
      namespace.outputShadows
        .filter(shadow => shadow.kind === 'BASE_NO_VALUE_DERIVED')
        .map(shadow => normalizeVariableId(shadow.derivedTechnicalId))
    );
    const generatedInputIdsBySubform = new Map<string, Set<string>>();
    responses.forEach((response, index) => {
      if (inputOrigins?.[index]?.isAutocoderGenerated !== true) {
        return;
      }
      const subform = String(response.subform || '');
      const inputIds =
        generatedInputIdsBySubform.get(subform) || new Set<string>();
      inputIds.add(normalizeVariableId(response.id));
      generatedInputIdsBySubform.set(subform, inputIds);
    });
    const describeInput = (inputIndex: number): string => {
      const origin = inputOrigins?.[inputIndex];
      const rawVariableId = origin?.storedVariableId ||
        String(responses[inputIndex].id);
      if (!origin) {
        return `input ${inputIndex + 1} (stored variable ` +
          `"${rawVariableId}")`;
      }
      const originType = origin.isAutocoderGenerated ?
        'autocoder-generated' :
        'imported';
      return `response:${origin.responseId} (stored variable ` +
        `"${rawVariableId}", ${originType})`;
    };
    const canonicalResponses = responses.map((response, index) => {
      const normalizedInputId = normalizeVariableId(response.id);
      const mappedTechnicalId = namespace.inputTechnicalIdByAlias.get(
        normalizedInputId
      );
      this.assertUnambiguousGeneratedInput(
        response, normalizedInputId, mappedTechnicalId, inputOrigins?.[index]?.isAutocoderGenerated === true, namespace, baseNoValueShadowDerivedIds, generatedInputIdsBySubform, () => describeInput(index)
      );

      return {
        ...response,
        id: mappedTechnicalId || response.id,
        // null, empty string and undefined all mean "no subform" in the
        // database. The response library must receive one canonical form so it
        // does not create a second placeholder for the same persistence target.
        subform: response.subform || undefined
      };
    });
    const canonicalInputIndexes = new Map<string, number>();
    canonicalResponses.forEach((response, index) => {
      const subform = String(response.subform || '');
      const key = autocoderResultKey(response.id, subform);
      const previousIndex = canonicalInputIndexes.get(key);
      if (previousIndex !== undefined) {
        throw new Error(
          'Autocoder input namespace collision for technical variable ' +
          `"${response.id}", subform "${subform}": ` +
          `${describeInput(previousIndex)} and ${describeInput(index)}.`
        );
      }
      canonicalInputIndexes.set(key, index);
    });

    return canonicalResponses;
  }

  private deferAllMissingSumScoreResults(
    results: AutocoderResponse[],
    variableCodings: VariableCodingData[]
  ): AutocoderResponse[] {
    const sumScoreCodings = variableCodings.filter(coding => (
      coding.sourceType === 'SUM_SCORE' &&
      (coding.deriveSources?.length || 0) > 0
    ));
    if (sumScoreCodings.length === 0) {
      return results;
    }

    const resultByKey = new Map(results.map(result => [
      autocoderResultKey(result.id, String(result.subform || '')),
      result
    ]));
    const allMissingTargetKeys = new Set<string>();

    results.forEach(result => {
      const resultId = normalizeVariableId(result.id);
      const coding = sumScoreCodings.find(candidate => (
        normalizeVariableId(candidate.id) === resultId
      ));
      if (!coding) {
        return;
      }

      const subform = String(result.subform || '');
      const sourceResults = (coding.deriveSources || []).map(sourceId => (
        resultByKey.get(autocoderResultKey(sourceId, subform))
      ));
      const allSourcesArePersistedMissing = sourceResults.every(source => (
        source?.status === 'CODING_COMPLETE' &&
        typeof source.code === 'number' &&
        source.code < 0
      ));
      if (allSourcesArePersistedMissing) {
        allMissingTargetKeys.add(autocoderResultKey(result.id, subform));
      }
    });

    // REQ-741 requires Autocoder results to stay independent of the selected
    // missing profile. Keep the derived target unresolved so the export layer
    // can aggregate the concrete missing category from its source responses.
    return results.map(result => (
      allMissingTargetKeys.has(autocoderResultKey(
        result.id,
        String(result.subform || '')
      )) ? {
          ...result,
          value: null,
          status: 'DERIVE_PENDING',
          code: undefined,
          score: undefined
        } : result
    ));
  }
}
