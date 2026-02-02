import { ApiProperty } from '@nestjs/swagger';
import { CodingJob } from '../../../database/entities/coding-job.entity';
import { MissingsProfile } from '../../../database/entities/missings-profile.entity';
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
    description: 'Comment for the coding job',
    example: 'This coding job requires special attention',
    required: false
  })
    comment?: string;

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
    description: 'Progress percentage for the coding job',
    example: 75,
    required: false
  })
    progress?: number;

  @ApiProperty({
    description: 'Number of coded units for the coding job',
    example: 15,
    required: false
  })
    coded_units?: number;

  @ApiProperty({
    description: 'Total number of units assigned to the coding job',
    example: 20,
    required: false
  })
    total_units?: number;

  @ApiProperty({
    description: 'Number of open units for the coding job',
    example: 3,
    required: false
  })
    open_units?: number;

  codedUnits?: number;
  totalUnits?: number;
  openUnits?: number;

  @ApiProperty({
    description: 'ID of the missings profile assigned to the coding job',
    example: 1,
    required: false
  })
    missings_profile_id?: number;

  @ApiProperty({
    description: 'Missings profile assigned to the coding job',
    example: { id: 1, label: 'Default Profile', missings: '...' },
    required: false
  })
    missings_profile?: MissingsProfile;

  @ApiProperty({
    description: 'ID of the training assigned to the coding job',
    example: 1,
    required: false
  })
    training_id?: number;

  @ApiProperty({
    description: 'Training assigned to the coding job',
    required: false
  })
    training?: { id: number; label: string };

  @ApiProperty({
    description: 'Workspace ID the coding job belongs to (camelCase alias)',
    example: 1,
    required: false
  })
    workspaceId?: number;

  @ApiProperty({
    description: 'Date and time when the coding job was created (camelCase alias)',
    example: '2025-08-06T10:05:00.000Z',
    required: false
  })
    createdAt?: Date;

  @ApiProperty({
    description: 'Date and time when the coding job was last updated (camelCase alias)',
    example: '2025-08-06T10:05:00.000Z',
    required: false
  })
    updatedAt?: Date;

  @ApiProperty({
    description: 'IDs of coders assigned to the coding job (camelCase alias)',
    type: [Number],
    example: [1, 2, 3],
    required: false
  })
    assignedCoders?: number[];

  @ApiProperty({
    description: 'Variables assigned to the coding job with unit and variable IDs (camelCase alias)',
    type: [Object],
    example: [{ unitName: 'Unit1', variableId: 'var1' }],
    required: false
  })
    assignedVariables?: { unitName: string; variableId: string }[];

  @ApiProperty({
    description: 'Variable bundles assigned to the coding job with their variables (camelCase alias)',
    type: [Object],
    example: [{ name: 'Bundle A', variables: [{ unitName: 'Unit1', variableId: 'var1' }] }],
    required: false
  })
    assignedVariableBundles?: { name: string; variables: { unitName: string; variableId: string }[] }[];

  /**
   * Create a CodingJobDto from a CodingJob entity
   * @param entity The CodingJob entity
   * @param assignedCoders Optional array of assigned coder IDs
   * @param assignedVariables Optional array of assigned variable objects with unit and variable IDs
   * @param assignedVariableBundles Optional array of assigned variable bundle objects with name and variables
   * @returns A CodingJobDto
   */
  static fromEntity(
    entity: CodingJob & { progress?: number; codedUnits?: number; totalUnits?: number; openUnits?: number },
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
    dto.comment = entity.comment;
    dto.created_at = entity.created_at;
    dto.updated_at = entity.updated_at;
    dto.missings_profile_id = entity.missings_profile_id;

    // Map progress data if available
    if (entity.progress !== undefined) {
      dto.progress = entity.progress;
    }
    if (entity.codedUnits !== undefined) {
      dto.coded_units = entity.codedUnits;
      dto.codedUnits = entity.codedUnits; // camelCase alias
    }
    if (entity.totalUnits !== undefined) {
      dto.total_units = entity.totalUnits;
      dto.totalUnits = entity.totalUnits; // camelCase alias
    }
    if (entity.openUnits !== undefined) {
      dto.open_units = entity.openUnits;
      dto.openUnits = entity.openUnits; // camelCase alias
    }

    if (entity.missingsProfile) {
      dto.missings_profile = entity.missingsProfile;
    }

    if (entity.training_id) {
      dto.training_id = entity.training_id;
    }

    if (entity.training) {
      dto.training = entity.training;
    }

    if (assignedCoders) {
      dto.assigned_coders = assignedCoders;
      dto.assignedCoders = assignedCoders;
    }
    if (assignedVariables) {
      dto.assigned_variables = assignedVariables;
      dto.assignedVariables = assignedVariables;
    }
    if (assignedVariableBundles) {
      dto.assigned_variable_bundles = assignedVariableBundles;
      dto.assignedVariableBundles = assignedVariableBundles;
    }

    // also set camelCase aliases for timestamps and workspace id for clients expecting camelCase
    dto.workspaceId = dto.workspace_id;
    dto.createdAt = dto.created_at;
    dto.updatedAt = dto.updated_at;

    return dto;
  }
}
