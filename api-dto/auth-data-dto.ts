import { ApiProperty } from '@nestjs/swagger';
import { WorkspaceFullDto } from './workspaces/workspace-full-dto';

export class AuthDataDto {
  @ApiProperty()
    userId!: number;

  @ApiProperty()
    userName!: string;

  @ApiProperty()
    email!: string;

  @ApiProperty()
    firstName!: string;

  @ApiProperty()
    lastName!: string;

  @ApiProperty()
    isAdmin!: boolean;

  @ApiProperty()
    workspaces!: WorkspaceFullDto[] | [];
}
