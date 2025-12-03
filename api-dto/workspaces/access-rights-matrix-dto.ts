import { ApiProperty } from '@nestjs/swagger';
import { AccessLevelDto } from './access-level-dto';
import { FeatureCategoryDto } from './feature-category-dto';

export class AccessRightsMatrixDto {
  @ApiProperty()
    levels!: AccessLevelDto[];

  @ApiProperty()
    categories!: FeatureCategoryDto[];

  @ApiProperty()
    guestNote?: string;

  @ApiProperty()
    adminNote?: string;
}
