import { ExpectedCombinationDto } from './expected-combination.dto';

/**
 * DTO for validation request
 */
export class ValidateCodingCompletenessRequestDto {
  /**
   * The expected combinations to validate
   */
  expectedCombinations!: ExpectedCombinationDto[];
}
