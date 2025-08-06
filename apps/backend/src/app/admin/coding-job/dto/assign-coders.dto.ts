import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsNumber } from 'class-validator';

/**
 * DTO for assigning coders to a coding job
 */
export class AssignCodersDto {
  @ApiProperty({
    description: 'Array of user IDs to assign as coders',
    type: [Number],
    example: [1, 2, 3]
  })
  @IsArray()
  @IsNumber({}, { each: true })
    userIds: number[];
}
