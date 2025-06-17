import { ApiProperty } from '@nestjs/swagger';

// Ensure FileStatus and DataValidation are exported or defined here if not already globally available
// For this example, assuming they are defined and exported from another DTO or are local types.
// If not, they should be defined here:
export type FileStatus = {
  filename: string;
  exists: boolean;
};

export type DataValidation = {
  complete: boolean;
  missing: string[];
  files: FileStatus[];
};

/**
 * Defines a simpler validation structure, typically for lists of missing items.
 */
export class SimpleDataValidationDto {
  @ApiProperty({ description: 'Indicates if the validation for this category is complete (no issues found).' })
    complete!: boolean;

  @ApiProperty({ type: [String], description: 'List of missing or problematic items.' })
    missing!: string[];
}

/**
 * Defines the validation details for the content of a single booklet.
 */
export class BookletContentValidationDetails { // Changed from type to class
  @ApiProperty({ type: Object, description: 'Validation status of the booklet file itself.' })
    bookletSelfStatus!: DataValidation; // Added definite assignment assertion

  @ApiProperty({ type: Object, description: 'Validation of units referenced by the booklet.' })
    units!: DataValidation; // Added definite assignment assertion

  @ApiProperty({ type: Object, description: 'Validation of coding schemes referenced by the booklet.' })
    schemes!: DataValidation; // Added definite assignment assertion

  @ApiProperty({ type: Object, description: 'Validation of definitions referenced by the booklet.' })
    definitions!: DataValidation; // Added definite assignment assertion

  @ApiProperty({ type: Object, description: 'Validation of player files referenced by the booklet.' })
    player!: DataValidation; // Added definite assignment assertion
}

/**
 * Represents the validation result for a single booklet.
 */
export class BookletValidationResultEntryDto { // Changed to Dto suffix for consistency if it's a class
  @ApiProperty({ type: String, description: 'Identifier of the booklet (e.g., filename)' })
    bookletId!: string;

  @ApiProperty({ type: () => BookletContentValidationDetails, description: 'Validation details for this booklet\'s content' })
    validationDetails!: BookletContentValidationDetails;
}

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
}
