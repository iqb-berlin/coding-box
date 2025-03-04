import { ApiProperty } from '@nestjs/swagger';

export class WorkspaceUserInListDto {
  @ApiProperty()
    id!: number;

  @ApiProperty()
    name!: string;

  @ApiProperty()
    username!: string;

  @ApiProperty()
    isAdmin!: boolean;

  @ApiProperty()
    description?: string;

  @ApiProperty()
    displayName?: string;

  @ApiProperty()
    accessLevel!: number;

  @ApiProperty()
    email?: string;
}
