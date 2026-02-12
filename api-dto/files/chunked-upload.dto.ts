// eslint-disable-next-line max-classes-per-file
import { ApiProperty } from '@nestjs/swagger';

export class ChunkedUploadInitRequestDto {
  @ApiProperty({ type: String, description: 'Original file name' })
    fileName!: string;

  @ApiProperty({ type: Number, description: 'Total file size in bytes' })
    fileSize!: number;

  @ApiProperty({ type: String, description: 'MIME type of the file' })
    mimeType!: string;
}

export class ChunkedUploadInitResponseDto {
  @ApiProperty({ type: String, description: 'Unique upload session ID' })
    uploadId!: string;

  @ApiProperty({ type: Number, description: 'Chunk size in bytes' })
    chunkSize!: number;

  @ApiProperty({ type: Number, description: 'Total number of chunks expected' })
    totalChunks!: number;
}

export class ChunkedUploadChunkResponseDto {
  @ApiProperty({ type: Boolean, description: 'Whether the chunk was received' })
    received!: boolean;

  @ApiProperty({ type: Number, description: 'Number of chunks received so far' })
    chunksReceived!: number;

  @ApiProperty({ type: Number, description: 'Total number of chunks expected' })
    totalChunks!: number;
}

export class ChunkedUploadCompleteRequestDto {
  @ApiProperty({ type: Boolean, required: false })
    overwriteExisting?: boolean;

  @ApiProperty({ type: String, required: false })
    personMatchMode?: string;

  @ApiProperty({ type: String, required: false })
    overwriteMode?: string;

  @ApiProperty({ type: String, required: false })
    scope?: string;

  @ApiProperty({ type: String, required: false })
    groupName?: string;

  @ApiProperty({ type: String, required: false })
    bookletName?: string;

  @ApiProperty({ type: String, required: false })
    unitNameOrAlias?: string;

  @ApiProperty({ type: String, required: false })
    variableId?: string;

  @ApiProperty({ type: String, required: false })
    subform?: string;
}
