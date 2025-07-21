import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO for booklet metadata
 */
export class BookletMetadataDto {
  @ApiProperty({ description: 'Booklet ID', example: 'BOOKLET123' })
    id!: string;

  @ApiProperty({ description: 'Booklet label', example: 'Math Test 2023' })
    label?: string;

  @ApiProperty({ description: 'Booklet description', example: 'Mathematics assessment for grade 10' })
    description?: string;
}
