import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO for booklet unit
 */
export class BookletUnitDto {
  @ApiProperty({ description: 'Unit ID', example: 'UNIT123' })
    id!: string;

  @ApiProperty({ description: 'Unit label', example: 'Algebra Problem 1' })
    label?: string;

  @ApiProperty({ description: 'Unit alias', example: 'M1' })
    alias?: string;

  @ApiProperty({ description: 'Unit position in booklet', example: 1 })
    position!: number;
}
