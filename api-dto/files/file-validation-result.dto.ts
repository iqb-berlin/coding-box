import { ApiProperty } from '@nestjs/swagger';

type FileStatus = {
  filename: string;
  exists: boolean;
};

type DataValidation = {
  complete: boolean;
  missing: string[];
  missingUnitsPerBooklet?: { booklet: string; missingUnits: string[] }[];
  unitsWithoutPlayer?: string[];
  unusedBooklets?: string[];
  files: FileStatus[];
};

export class FileValidationResultDto {
  @ApiProperty({ type: Boolean, description: 'Indicates whether test takers were found' })
    testTakersFound!: boolean;

  @ApiProperty({ type: [Object], description: 'Array of validation results for each test taker' })
    validationResults!: {
    testTaker: string;
    booklets: DataValidation;
    units: DataValidation;
    schemes: DataValidation;
    definitions: DataValidation;
    player: DataValidation;
  }[];
}
