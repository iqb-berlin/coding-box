import { ApiProperty } from '@nestjs/swagger';
import { WorkspaceInListDto } from './workspace-in-list-dto';

export class PaginatedWorkspacesDto {
  @ApiProperty({ type: () => [WorkspaceInListDto] })
    data!: WorkspaceInListDto[];

  @ApiProperty({ example: 3 })
    total!: number;

  @ApiProperty({ example: 1 })
    page!: number;

  @ApiProperty({ example: 20 })
    limit!: number;
}
