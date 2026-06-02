import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class UpdateCodingJobCommentDto {
  @ApiProperty({
    description: 'Comment for the coding job',
    example: 'This coding job requires special attention'
  })
  @IsString()
    comment: string;
}
