import { ApiProperty } from '@nestjs/swagger';

export class WorkspaceInListDto {
  @ApiProperty()
    id!: number;

  @ApiProperty()
    name!: string;
}
