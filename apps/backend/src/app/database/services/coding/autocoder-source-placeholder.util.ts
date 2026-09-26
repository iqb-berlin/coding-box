import { VariableCodingData } from '@iqbspecs/coding-scheme';
import { ResponseEntity } from '../../entities/response.entity';

/** Never pass a stale global placeholder alongside its imported source. */
export function omitShadowedGeneratedSourcePlaceholders(
  responses: ResponseEntity[],
  variableCodings: VariableCodingData[]
): ResponseEntity[] {
  const sourceIds = new Set(variableCodings.flatMap(coding => coding.deriveSources || []));
  const baseSourceAliases = new Set(variableCodings
    .filter(coding => coding.sourceType === 'BASE' && sourceIds.has(coding.id))
    .map(coding => (coding.alias || coding.id).toUpperCase()));
  const importedSources = new Set(responses
    .filter(response => response.is_autocoder_generated !== true &&
      [1, 2, 3].includes(response.status))
    .map(response => response.variableid.toUpperCase()));

  return responses.filter(response => {
    const variableId = response.variableid.toUpperCase();
    const emptyPlaceholder = response.is_autocoder_generated === true &&
      !response.subform &&
      !response.autocoder_invalidated_version &&
      (response.value == null || response.value.trim() === '') &&
      response.status_v1 === 0 &&
      [response.status_v2, response.status_v3].every(status => status == null || status === 0) &&
      [response.code_v1, response.score_v1, response.code_v2,
        response.score_v2, response.code_v3, response.score_v3].every(value => value == null);
    return !(emptyPlaceholder && baseSourceAliases.has(variableId) && importedSources.has(variableId));
  });
}
