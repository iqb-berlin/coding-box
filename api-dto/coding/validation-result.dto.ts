import { ExpectedCombinationDto } from './expected-combination.dto';

/**
 * DTO for validation result
 */
export class ValidationResultDto {
  /**
   * The expected combination
   */
  combination!: ExpectedCombinationDto;

  /**
   * The status of the validation
   * MISSING: The response is missing
   * EXISTS: The response exists
   */
  status!: 'MISSING' | 'EXISTS';
}
