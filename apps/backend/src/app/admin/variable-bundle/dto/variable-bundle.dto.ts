import { ApiProperty } from '@nestjs/swagger';
import { VariableBundle } from '../../../database/entities/variable-bundle.entity';
import { VariableDto } from './variable.dto';

export class VariableBundleDto {
  @ApiProperty({
    description: 'The ID of the variable bundle',
    example: 1
  })
    id: number;

  @ApiProperty({
    description: 'The ID of the workspace',
    example: 1
  })
    workspace_id: number;

  @ApiProperty({
    description: 'The name of the variable bundle',
    example: 'Mathematical Skills'
  })
    name: string;

  @ApiProperty({
    description: 'The description of the variable bundle',
    example: 'Variables for assessing mathematical skills',
    required: false
  })
    description?: string;

  @ApiProperty({
    description: 'The variables in the bundle',
    type: [VariableDto]
  })
    variables: VariableDto[];

  @ApiProperty({
    description: 'The date the variable bundle was created',
    example: '2025-08-04T13:58:00.000Z'
  })
    created_at: Date;

  @ApiProperty({
    description: 'The date the variable bundle was last updated',
    example: '2025-08-04T13:58:00.000Z'
  })
    updated_at: Date;

  /**
     * Static method to create a DTO from an entity
     */
  static fromEntity(entity: VariableBundle): VariableBundleDto {
    const dto = new VariableBundleDto();
    dto.id = entity.id;
    dto.workspace_id = entity.workspace_id;
    dto.name = entity.name;
    dto.description = entity.description;
    dto.variables = entity.variables;
    dto.created_at = entity.created_at;
    dto.updated_at = entity.updated_at;
    return dto;
  }
}
