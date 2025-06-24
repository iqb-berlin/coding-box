import { ApiProperty } from '@nestjs/swagger';

export class FileStatus {
  @ApiProperty()
    filename!: string;

  @ApiProperty()
    exists!: boolean;
}

export class DataValidation {
  @ApiProperty()
    complete!: boolean;

  @ApiProperty({ type: [String] })
    missing!: string[];

  @ApiProperty({ type: [FileStatus] })
    files!: FileStatus[];
}

export class ValidationData {
  @ApiProperty()
    testTaker!: string;

  @ApiProperty({ type: DataValidation })
    booklets!: DataValidation;

  @ApiProperty({ type: DataValidation })
    units!: DataValidation;

  @ApiProperty({ type: DataValidation })
    schemes!: DataValidation;

  @ApiProperty({ type: DataValidation })
    definitions!: DataValidation;

  @ApiProperty({ type: DataValidation })
    player!: DataValidation;
}

export class FileValidationResultDto {
  @ApiProperty({ type: Boolean, description: 'Indicates whether test takers were found' })
    testTakersFound!: boolean;

  @ApiProperty({ type: [ValidationData], description: 'Array of validation results for each test taker' })
    validationResults!: ValidationData[];
}
