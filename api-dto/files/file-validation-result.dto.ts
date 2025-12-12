import { ApiProperty } from '@nestjs/swagger';

type FileStatus = {
  filename: string;
  exists: boolean;
  schemaValid?: boolean;
  schemaErrors?: string[];
};

type DataValidation = {
  complete: boolean;
  missing: string[];
  missingUnitsPerBooklet?: { booklet: string; missingUnits: string[] }[];
  unitsWithoutPlayer?: string[];
  files: FileStatus[];
};

export type FilteredTestTaker = {
  testTaker: string;
  mode: string;
  login: string;
};

export type DuplicateTestTaker = {
  login: string;
  occurrences: {
    testTaker: string;
    mode: string;
  }[];
};

export type UnusedTestFile = {
  id: number;
  fileId: string;
  filename: string;
  fileType: string;
};

export class FileValidationResultDto {
  @ApiProperty({ type: Boolean, description: 'Indicates whether test takers were found' })
    testTakersFound!: boolean;

  @ApiProperty({ type: [Object], description: 'Array of filtered test takers with specific modes' })
    filteredTestTakers?: FilteredTestTaker[];

  @ApiProperty({ type: [Object], description: 'Array of duplicate test takers found across files' })
    duplicateTestTakers?: DuplicateTestTaker[];

  @ApiProperty({ type: [Object], description: 'Array of files not reachable from TestTakers -> Booklets -> Units -> referenced resources' })
    unusedTestFiles?: UnusedTestFile[];

  @ApiProperty({ type: [Object], description: 'Array of validation results for each test taker' })
    validationResults!: {
    testTaker: string;
    booklets: DataValidation;
    units: DataValidation;
    schemes: DataValidation;
    schemer: DataValidation;
    definitions: DataValidation;
    player: DataValidation;
  }[];
}
