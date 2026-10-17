import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';

export const codingJobReplayStatuses = ['active', 'paused', 'completed'] as const;
export type CodingJobReplayStatus = typeof codingJobReplayStatuses[number];

export class UpdateCodingJobStatusDto {
  @ApiProperty({
    description: 'Replay-safe status of the coding job',
    example: 'active',
    enum: codingJobReplayStatuses
  })
  @IsEnum(codingJobReplayStatuses)
    status: CodingJobReplayStatus;
}
