import { ValidationResultDto } from './validation-result.dto';

/**
 * DTO for validation response with pagination support
 */
export class ValidateCodingCompletenessResponseDto {
  /**
   * The validation results for the current page
   */
  results!: ValidationResultDto[];

  /**
   * The total number of expected combinations
   */
  total!: number;

  /**
   * The number of missing responses (across all pages)
   */
  missing!: number;

  /**
   * Current page number (1-based)
   */
  currentPage!: number;

  /**
   * Number of items per page
   */
  pageSize!: number;

  /**
   * Total number of pages
   */
  totalPages!: number;

  /**
   * Whether there is a next page
   */
  hasNextPage!: boolean;

  /**
   * Whether there is a previous page
   */
  hasPreviousPage!: boolean;

  /**
   * Cache key for subsequent pagination requests and Excel downloads
   */
  cacheKey?: string;
}
