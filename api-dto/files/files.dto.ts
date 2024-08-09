import { ApiProperty } from '@nestjs/swagger';

export class FilesDto {
  @ApiProperty()
    file_id!: string;

  @ApiProperty()
    data!: string;

  @ApiProperty()
    workspace_id?: number;
}
