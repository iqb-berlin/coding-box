import { ApiProperty } from '@nestjs/swagger';
import { AuditJournalEntryDto } from '../../../../../../../api-dto/audit-journal/audit-journal.dto';
import { AuditJournalEntryResponseDto } from './audit-journal-entry-response.dto';

/**
 * DTO for paginated journal entries response
 */
export class PaginatedJournalEntriesDto {
  @ApiProperty({
    description: 'Array of journal entries',
    type: AuditJournalEntryResponseDto,
    isArray: true
  })
    data: AuditJournalEntryDto[];

  @ApiProperty({
    description: 'Total number of journal entries',
    example: 100
  })
    total: number;

  @ApiProperty({
    description: 'Current page number',
    example: 1
  })
    page: number;

  @ApiProperty({
    description: 'Number of items per page',
    example: 20
  })
    limit: number;
}
