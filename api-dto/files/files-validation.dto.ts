import { ApiProperty } from '@nestjs/swagger';

type DataValidation = {
  complete: boolean;
  missing: string[];
};

export class FilesValidationDto {
  @ApiProperty()
    booklets!: DataValidation;

  @ApiProperty()
    units!: DataValidation;

  @ApiProperty()
    schemes!: DataValidation;

  @ApiProperty()
    definitions!: DataValidation;
}
