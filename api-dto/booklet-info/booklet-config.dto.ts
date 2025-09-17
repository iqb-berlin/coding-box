import { ApiProperty } from '@nestjs/swagger';
import { BookletConfigItemDto } from './booklet-config-item.dto';

/**
 * DTO for booklet configuration collection
 */
export class BookletConfigDto {
  @ApiProperty({ description: 'List of configuration items', type: [BookletConfigItemDto] })
    items!: BookletConfigItemDto[];
}
