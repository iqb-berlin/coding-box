import type { RequestBody } from '../request-contracts';
// eslint-disable-next-line max-classes-per-file
import { ApiProperty } from '@nestjs/swagger';

export type ChunkedUploadInitRequestDto = RequestBody<'ChunkedUploadInitRequestDto'>;

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

export type ChunkedUploadCompleteRequestDto = RequestBody<'ChunkedUploadCompleteRequestDto'>;
