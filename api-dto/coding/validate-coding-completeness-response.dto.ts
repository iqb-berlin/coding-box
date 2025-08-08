import { ValidationResultDto } from './validation-result.dto';

/**
 * DTO for validation response
 */
export class ValidateCodingCompletenessResponseDto {
  /**
   * The validation results
   */
  results!: ValidationResultDto[];

  /**
   * The total number of expected combinations
   */
  total!: number;

  /**
   * The number of missing responses
   */
  missing!: number;
}
