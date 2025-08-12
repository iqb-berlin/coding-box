import { ExpectedCombinationDto } from './expected-combination.dto';

/**
 * DTO for validation request with pagination support
 */
export class ValidateCodingCompletenessRequestDto {
  /**
   * The expected combinations to validate
   */
  expectedCombinations!: ExpectedCombinationDto[];

  /**
   * Page number (1-based). Defaults to 1 if not provided.
   */
  page?: number;

  /**
   * Number of items per page. Defaults to 50 if not provided.
   */
  pageSize?: number;
}
