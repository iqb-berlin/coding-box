import { ApiProperty } from '@nestjs/swagger';
import { BookletMetadataDto } from './booklet-metadata.dto';
import { BookletUnitDto } from './booklet-unit.dto';
import { BookletRestrictionDto } from './booklet-restriction.dto';
import { BookletConfigDto } from './booklet-config.dto';
import { BookletTestletDto } from './booklet-testlet.dto';

export class BookletInfoDto {
  @ApiProperty({ description: 'Booklet metadata' })
    metadata!: BookletMetadataDto;

  @ApiProperty({ description: 'Booklet configuration', required: false })
    config?: BookletConfigDto;

  @ApiProperty({ description: 'List of units in the booklet', type: [BookletUnitDto] })
    units!: BookletUnitDto[];

  @ApiProperty({ description: 'List of testlets in the booklet', type: [BookletTestletDto], required: false })
    testlets?: BookletTestletDto[];

  @ApiProperty({ description: 'List of restrictions for the booklet', type: [BookletRestrictionDto] })
    restrictions!: BookletRestrictionDto[];

  @ApiProperty({ description: 'Raw XML of the booklet', required: false })
    rawXml?: string;
}
