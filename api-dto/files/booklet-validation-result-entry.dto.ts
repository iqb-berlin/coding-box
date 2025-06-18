import { ApiProperty } from '@nestjs/swagger';
import { BookletContentValidationDetails } from './booklet-content-validation-details.dto';

export class BookletValidationResultEntryDto {
  @ApiProperty({ type: String, description: 'Identifier of the booklet (e.g., filename)' })
    bookletId!: string;

  @ApiProperty({ type: () => BookletContentValidationDetails, description: 'Validation details for this booklet\'s content' })
    validationDetails!: BookletContentValidationDetails;
}
