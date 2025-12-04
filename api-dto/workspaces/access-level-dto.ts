import { ApiProperty } from '@nestjs/swagger';

export class AccessLevelDto {
  @ApiProperty()
    level!: number;

  @ApiProperty()
    translationKey!: string;

  @ApiProperty()
    icon?: string;
}
