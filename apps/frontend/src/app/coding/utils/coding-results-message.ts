import type { UiTranslator } from '../../shared/utils/ui-translator';
import type { ApplyCodingResultsResponse } from '../services/coding-job-backend.service';

export function formatApplyCodingResultsMessage(
  result: ApplyCodingResultsResponse,
  uiTranslate: UiTranslator
): string {
  const parts = [
    uiTranslate('ui-text.coding-jobs.apply-success', { updatedResponsesCount: result.updatedResponsesCount })
  ];

  if (result.skippedAlreadyCodedCount > 0) {
    parts.push(
      uiTranslate('ui-text.coding-jobs.preserved-responses', { skippedAlreadyCodedCount: result.skippedAlreadyCodedCount })
    );
  }

  if (result.overwrittenExistingCount > 0) {
    parts.push(
      uiTranslate('ui-text.coding-jobs.overwritten-responses', { overwrittenExistingCount: result.overwrittenExistingCount })
    );
  }

  if (result.skippedReviewCount > 0) {
    parts.push(
      uiTranslate('ui-text.coding-jobs.review-skipped-responses', { skippedReviewCount: result.skippedReviewCount })
    );
  }

  return parts.join('\n');
}
