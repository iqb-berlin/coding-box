import { ApiProperty } from '@nestjs/swagger';

export class FilesInListDto {
  @ApiProperty()
  id!: number;

  @ApiProperty()
    filename!: string;

  @ApiProperty()
    file_type?: string;

  @ApiProperty()
    file_size?: string;

  @ApiProperty()
    created_at?: string;
}
