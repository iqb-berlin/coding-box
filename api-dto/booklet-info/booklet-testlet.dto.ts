import { ApiProperty } from '@nestjs/swagger';
import { BookletUnitDto } from './booklet-unit.dto';
import { BookletRestrictionDto } from './booklet-restriction.dto';

/**
 * DTO for booklet testlet
 */
export class BookletTestletDto {
  @ApiProperty({ description: 'Testlet ID', example: 'TESTLET123' })
    id!: string;

  @ApiProperty({ description: 'Testlet label', example: 'Math Section' })
    label?: string;

  @ApiProperty({ description: 'List of units in the testlet', type: [BookletUnitDto] })
    units!: BookletUnitDto[];

  @ApiProperty({ description: 'List of restrictions for the testlet', type: [BookletRestrictionDto] })
    restrictions?: BookletRestrictionDto[];
}
