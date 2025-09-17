import { ApiProperty } from '@nestjs/swagger';
import { WorkspaceUserDto } from './workspace-user-dto';

export class PaginatedWorkspaceUserDto {
  @ApiProperty({ type: [WorkspaceUserDto] })
    data!: WorkspaceUserDto[];

  @ApiProperty()
    total!: number;

  @ApiProperty()
    page!: number;

  @ApiProperty()
    limit!: number;
}
