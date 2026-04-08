import { DuplicateResponseDto } from '../../../../../../api-dto/files/duplicate-response.dto';

/**
 * DTO for duplicate response selection
 */
export interface DuplicateResponseSelectionDto extends DuplicateResponseDto {
  key: string;
}
