import { ApiProperty } from '@nestjs/swagger';

export class UpdateUnitTagDto {
  @ApiProperty({ description: 'The tag text' })
    tag!: string;

  @ApiProperty({ description: 'The color of the tag', required: false })
    color?: string;
}
