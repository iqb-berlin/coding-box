import { ApiProperty } from '@nestjs/swagger';

export class TransferCodingCasesResultDto {
  @ApiProperty({
    description: 'Source coder user ID',
    example: 12
  })
    sourceCoderId: number;

  @ApiProperty({
    description: 'Target coder user ID',
    example: 34
  })
    targetCoderId: number;

  @ApiProperty({
    description: 'Number of affected coding jobs',
    example: 8
  })
    affectedJobs: number;

  @ApiProperty({
    description: 'Number of updated coder assignments',
    example: 6
  })
    updatedAssignments: number;

  @ApiProperty({
    description: 'Number of duplicate source assignments removed because target coder was already assigned',
    example: 2
  })
    removedDuplicateAssignments: number;

  @ApiProperty({
    description: 'Number of coding job units (cases) associated with affected jobs',
    example: 254
  })
    transferredCases: number;
}
