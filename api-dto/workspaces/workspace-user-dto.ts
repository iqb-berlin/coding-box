import { ApiProperty } from '@nestjs/swagger';

export class WorkspaceUserDto {
  @ApiProperty()
    workspaceId!: number;

  @ApiProperty()
    userId!: number;

  @ApiProperty({ nullable: true })
    accessLevel!: string | null;
}
