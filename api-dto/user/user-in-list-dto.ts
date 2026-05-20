import { ApiProperty } from '@nestjs/swagger';

export class UserInListDto {
  @ApiProperty()
    id!: number;

  @ApiProperty()
    name!: string;

  @ApiProperty()
    isAdmin!: boolean;

  @ApiProperty()
    accessLevel!: number;

  @ApiProperty({ required: false })
    canCode?: boolean;

  @ApiProperty()
    description?: string;

  @ApiProperty()
    displayName?: string;

  @ApiProperty()
    email?: string;
}
