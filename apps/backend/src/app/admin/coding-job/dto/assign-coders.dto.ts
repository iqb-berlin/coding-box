import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayUnique, IsArray, IsInt, Min, Max
} from 'class-validator';

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
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(2147483647, { each: true })
  userIds: number[];
}
