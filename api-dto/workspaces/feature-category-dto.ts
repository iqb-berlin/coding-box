import { ApiProperty } from '@nestjs/swagger';
import { FeaturePermissionDto } from './feature-permission-dto';

export class FeatureCategoryDto {
  @ApiProperty()
    categoryKey!: string;

  @ApiProperty()
    translationKey!: string;

  @ApiProperty()
    features!: FeaturePermissionDto[];
}
