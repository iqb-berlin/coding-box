import { DuplicateResponseDto } from '../../../../../api-dto/files/duplicate-response.dto';

/**
 * Extends DuplicateResponseDto to include selection state for duplicate responses
 */
export interface DuplicateResponseSelectionDto extends DuplicateResponseDto {
  /**
   * The ID of the selected response to keep (from the duplicates array)
   */
  selectedResponseId?: number;

  /**
   * A unique key for the duplicate response, format: `${unitId}_${variableId}_${testTakerLogin}`
   */
  key: string;
}

/**
 * Interface for the resolution request payload
 */
export interface ResolveDuplicateResponsesRequestDto {
  /**
   * Map of unit+variable+testTaker identifiers to selected response IDs
   * Key format: `${unitId}_${variableId}_${testTakerLogin}`
   * Value: The selected response ID to keep
   */
  resolutionMap: Record<string, number>;
}
export interface ResolveDuplicateResponsesResponseDto {
  resolvedCount: number;
  success: boolean;
}
