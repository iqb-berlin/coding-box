import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';

/**
 * DTO for approving a job definition
 */
export class ApproveJobDefinitionDto {
  @ApiProperty({
    description: 'New status for the job definition',
    enum: ['pending_review', 'approved'],
    example: 'approved'
  })
  @IsEnum(['pending_review', 'approved'])
    status: 'pending_review' | 'approved';
}
