import { ApiProperty } from '@nestjs/swagger';
import { BookletValidationResultEntryDto } from './booklet-validation-result-entry.dto';
import { SimpleDataValidationDto } from './simple-data-validation.dto';

/**
 * Main DTO for returning file validation results, potentially for multiple booklets.
 */
export class FileValidationResultDto {
  @ApiProperty({ type: () => [BookletValidationResultEntryDto], description: 'Array of validation results, one for each booklet' })
    bookletValidationResults!: BookletValidationResultEntryDto[];

  @ApiProperty({
    type: () => SimpleDataValidationDto,
    required: false,
    description: 'Validation of units present in the workspace but not referenced in any booklet. These units will be ignored by the backend.'
  })
    orphanedUnitsValidation?: SimpleDataValidationDto;

  @ApiProperty({
    type: () => SimpleDataValidationDto,
    required: false,
    description: 'Global validation to check if every unit in the workspace has a player specified.'
  })
    allUnitsHavePlayerValidation?: SimpleDataValidationDto;

  @ApiProperty({
    type: () => SimpleDataValidationDto,
    required: false,
    description: 'Global validation to check if every booklet is referenced in at least one TestTakers file.'
  })
    bookletsInTestTakersValidation?: SimpleDataValidationDto;

  @ApiProperty({
    type: () => SimpleDataValidationDto,
    required: false,
    description: 'Global validation to check if every booklet referenced in any TestTakers file actually exists in the workspace.'
  })
    referencedBookletsExistValidation?: SimpleDataValidationDto;
}
