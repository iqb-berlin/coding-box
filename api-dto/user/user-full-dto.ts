import { ApiProperty } from '@nestjs/swagger';

export class UserFullDto {
  @ApiProperty()
    id!: number;

  @ApiProperty()
    username?: string;

  @ApiProperty({ required: false, description: 'Given name followed by family name from the OIDC profile' })
    displayName?: string;

  @ApiProperty()
    isAdmin?: boolean;

  @ApiProperty()
    description?: string;
}
