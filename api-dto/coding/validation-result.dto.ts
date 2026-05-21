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
   * MISSING: The response or required replay data is missing
   * EXISTS: The response and replay data exist
   */
  status!: 'MISSING' | 'EXISTS';

  /**
   * Optional details explaining missing or suspicious validation results.
   */
  issues?: string[];

  /**
   * Whether a matching response was found before replay data was checked.
   */
  responseFound?: boolean;
}
