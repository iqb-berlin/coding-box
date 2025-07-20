import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO for booklet configuration item
 */
export class BookletConfigItemDto {
  @ApiProperty({ description: 'Configuration key', example: 'loading_mode' })
    key!: string;

  @ApiProperty({ description: 'Configuration value', example: 'LAZY' })
    value!: string;
}
