import { ApiProperty } from '@nestjs/swagger';
import { JournalEntry } from '../../../workspaces/entities/journal-entry.entity';

/**
 * DTO for paginated journal entries response
 */
export class PaginatedJournalEntriesDto {
  @ApiProperty({
    description: 'Array of journal entries',
    type: JournalEntry,
    isArray: true
  })
    data: JournalEntry[];

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
