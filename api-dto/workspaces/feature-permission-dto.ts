import { ApiProperty } from '@nestjs/swagger';

export class FeaturePermissionDto {
  @ApiProperty()
    featureKey!: string;

  @ApiProperty()
    translationKey!: string;

  @ApiProperty()
    minAccessLevel!: number;

  @ApiProperty()
    description?: string;
}
