import { ApiProperty } from '@nestjs/swagger';
import { CodingJob } from '../../../database/entities/coding-job.entity';
import { VariableBundleDto } from '../../variable-bundle/dto/variable-bundle.dto';
import { VariableDto } from '../../variable-bundle/dto/variable.dto';

/**
 * DTO for a coding job
 */
export class CodingJobDto {
  @ApiProperty({
    description: 'Unique identifier for the coding job',
    example: 1
  })
    id: number;

  @ApiProperty({
    description: 'Workspace ID the coding job belongs to',
    example: 1
  })
    workspace_id: number;

  @ApiProperty({
    description: 'Name of the coding job',
    example: 'Coding Job 1'
  })
    name: string;

  @ApiProperty({
    description: 'Description of the coding job',
    example: 'This is a coding job for testing',
    required: false
  })
    description?: string;

  @ApiProperty({
    description: 'Status of the coding job',
    example: 'pending',
    enum: ['pending', 'active', 'completed']
  })
    status: string;

  @ApiProperty({
    description: 'Date and time when the coding job was created',
    example: '2025-08-06T10:05:00.000Z'
  })
    created_at: Date;

  @ApiProperty({
    description: 'Date and time when the coding job was last updated',
    example: '2025-08-06T10:05:00.000Z'
  })
    updated_at: Date;

  @ApiProperty({
    description: 'IDs of coders assigned to the coding job',
    type: [Number],
    example: [1, 2, 3],
    required: false
  })
    assigned_coders?: number[];

  @ApiProperty({
    description: 'Variables assigned to the coding job with unit and variable IDs',
    type: [Object],
    example: [{ unitName: 'Unit1', variableId: 'var1' }, { unitName: 'Unit2', variableId: 'var2' }],
    required: false
  })
    assigned_variables?: { unitName: string; variableId: string }[];

  @ApiProperty({
    description: 'Variable bundles assigned to the coding job with their variables',
    type: [Object],
    example: [
      {
        name: 'Bundle A',
        variables: [
          { unitName: 'Unit1', variableId: 'var1' },
          { unitName: 'Unit2', variableId: 'var2' }
        ]
      }
    ],
    required: false
  })
    assigned_variable_bundles?: { name: string; variables: { unitName: string; variableId: string }[] }[];

  @ApiProperty({
    description: 'Variables assigned to the coding job',
    type: [VariableDto],
    required: false
  })
    variables?: VariableDto[];

  @ApiProperty({
    description: 'Variable bundles assigned to the coding job',
    type: [VariableBundleDto],
    required: false
  })
    variable_bundles?: VariableBundleDto[];

  /**
   * Create a CodingJobDto from a CodingJob entity
   * @param entity The CodingJob entity
   * @param assignedCoders Optional array of assigned coder IDs
   * @param assignedVariables Optional array of assigned variable objects with unit and variable IDs
   * @param assignedVariableBundles Optional array of assigned variable bundle objects with name and variables
   * @returns A CodingJobDto
   */
  static fromEntity(
    entity: CodingJob,
    assignedCoders?: number[],
    assignedVariables?: { unitName: string; variableId: string }[],
    assignedVariableBundles?: { name: string; variables: { unitName: string; variableId: string }[] }[]
  ): CodingJobDto {
    const dto = new CodingJobDto();
    dto.id = entity.id;
    dto.workspace_id = entity.workspace_id;
    dto.name = entity.name;
    dto.description = entity.description;
    dto.status = entity.status;
    dto.created_at = entity.created_at;
    dto.updated_at = entity.updated_at;

    if (assignedCoders) {
      dto.assigned_coders = assignedCoders;
    }
    if (assignedVariables) {
      dto.assigned_variables = assignedVariables;
    }
    if (assignedVariableBundles) {
      dto.assigned_variable_bundles = assignedVariableBundles;
    }

    return dto;
  }
}
