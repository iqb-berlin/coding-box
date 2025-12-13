import { ApiProperty } from '@nestjs/swagger';

export type TestFilesUploadConflictDto = {
  fileId: string;
  filename: string;
  fileType?: string;
};

export type TestFilesUploadFailedDto = {
  filename: string;
  reason?: string;
};

export type TestFilesUploadUploadedDto = {
  fileId?: string;
  filename: string;
  fileType?: string;
};

export class TestFilesUploadResultDto {
  @ApiProperty({ type: Number })
    total!: number;

  @ApiProperty({ type: Number })
    uploaded!: number;

  @ApiProperty({ type: Number })
    failed!: number;

  @ApiProperty({ type: [Object], required: false })
    conflicts?: TestFilesUploadConflictDto[];

  @ApiProperty({ type: [Object], required: false })
    failedFiles?: TestFilesUploadFailedDto[];

  @ApiProperty({ type: [Object], required: false })
    uploadedFiles?: TestFilesUploadUploadedDto[];
}
