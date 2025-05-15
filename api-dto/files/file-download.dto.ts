import { ApiProperty } from '@nestjs/swagger';

export class FileDownloadDto {
  @ApiProperty()
    filename!: string;

  @ApiProperty()
    base64Data!: string;

  @ApiProperty()
    mimeType!: string;
}
