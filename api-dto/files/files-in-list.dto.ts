import { ApiProperty } from '@nestjs/swagger';

export class FilesInListDto {
  @ApiProperty()
    id!: number;

  @ApiProperty({ required: false })
  file_id?: string;

  @ApiProperty()
    filename!: string;

  @ApiProperty()
    file_type?: string;

  @ApiProperty({ type: Number })
  file_size?: string | number;

  @ApiProperty({ type: String })
  created_at?: string | number;

  @ApiProperty({ required: false, description: 'Full module version for Schemer listings, including any prerelease suffix.' })
  schemerVersion?: string;
}
