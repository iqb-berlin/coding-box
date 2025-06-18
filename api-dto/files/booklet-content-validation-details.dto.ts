import { ApiProperty } from '@nestjs/swagger';
import { DataValidation } from './data-validation.type';

export class BookletContentValidationDetails {
  @ApiProperty({ type: Object, description: 'Validation status of the booklet file itself.' })
    bookletSelfStatus!: DataValidation;

  @ApiProperty({ type: Object, description: 'Validation of units referenced by the booklet.' })
    units!: DataValidation;

  @ApiProperty({ type: Object, description: 'Validation of coding schemes referenced by the booklet.' })
    schemes!: DataValidation;

  @ApiProperty({ type: Object, description: 'Validation of definitions referenced by the booklet.' })
    definitions!: DataValidation;

  @ApiProperty({ type: Object, description: 'Validation of player files referenced by the booklet.' })
    player!: DataValidation;
}
