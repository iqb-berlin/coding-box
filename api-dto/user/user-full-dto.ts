import { ApiProperty } from '@nestjs/swagger';

export class UserFullDto {
  @ApiProperty()
    id!: number;

  @ApiProperty()
    username?: string;

  @ApiProperty()
    isAdmin?: boolean;

  @ApiProperty()
    description?: string;
}
