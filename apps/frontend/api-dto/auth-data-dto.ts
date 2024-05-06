import { ApiProperty } from '@nestjs/swagger';
import { WorkspaceFullDto } from './workspaces/workspace-full-dto';

export class AuthDataDto {
  @ApiProperty()
    userId!: number;

  @ApiProperty()
    userName!: string;

  @ApiProperty()
    userLongName!: string;

  @ApiProperty()
    isAdmin!: boolean;

  @ApiProperty()
    workspaces!: WorkspaceFullDto[];
}



