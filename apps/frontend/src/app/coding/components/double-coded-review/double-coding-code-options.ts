import { DoubleCodedReviewCodeDto } from '../../../../../../../api-dto/coding/double-coded-review.dto';
import { CoderResult } from './double-coded-review.models';
import { UiTranslator } from '../../../shared/utils/ui-translator';

export function reviewCodeLabel(code: number | null, translate: UiTranslator): string {
  if (code === null || code === undefined) {
    return '';
  }

  switch (code) {
    case -1:
      return translate(
        'code-selector.coding-issue-options.code-assignment-uncertain'
      );
    case -2:
      return translate(
        'code-selector.coding-issue-options.new-code-needed'
      );
    case -3:
      return translate(
        'code-selector.coding-issue-options.invalid-joke-answer'
      );
    case -4:
      return translate(
        'code-selector.coding-issue-options.technical-problems'
      );
    default:
      return '';
  }
}

export function fallbackReviewCodes(
  coderResults: CoderResult[],
  translate: UiTranslator
): DoubleCodedReviewCodeDto[] {
  const options = new Map<number, DoubleCodedReviewCodeDto>();
  coderResults.forEach(result => {
    const codes =
      result.codingIssueOption !== null &&
        result.codingIssueOption !== undefined &&
        [-3, -4].includes(result.codingIssueOption) ?
        [result.codingIssueOption] :
        [result.code];
    codes.forEach(code => {
      if (code === null || code === -1 || code === -2 || options.has(code)) {
        return;
      }
      options.set(code, {
        code,
        label: reviewCodeLabel(code, translate) || String(code),
        score: result.score,
        source: code < 0 ? 'general' : 'schema'
      });
    });
  });
  [-3, -4].forEach(code => {
    if (!options.has(code)) {
      options.set(code, {
        code,
        label: reviewCodeLabel(code, translate),
        score: null,
        source: 'general'
      });
    }
  });
  return [...options.values()];
}
