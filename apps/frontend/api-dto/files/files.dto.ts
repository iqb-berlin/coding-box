import { ApiProperty } from '@nestjs/swagger';

export class FilesDto {
  @ApiProperty()
    filename!: string;

  @ApiProperty()
    data?: string;

  @ApiProperty()
    workspace_id?: number;
}
