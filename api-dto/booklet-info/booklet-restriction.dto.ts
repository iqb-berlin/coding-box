import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO for booklet restriction
 */
export class BookletRestrictionDto {
  @ApiProperty({ description: 'Restriction type', example: 'timeMax' })
    type!: string;

  @ApiProperty({ description: 'Restriction value', example: '60' })
    value!: string;
}
