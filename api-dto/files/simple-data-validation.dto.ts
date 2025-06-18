import { ApiProperty } from '@nestjs/swagger';

export class SimpleDataValidationDto {
  @ApiProperty({ description: 'Indicates if the validation for this category is complete (no issues found).' })
    complete!: boolean;

  @ApiProperty({ type: [String], description: 'List of missing or problematic items.' })
    missing!: string[];
}
