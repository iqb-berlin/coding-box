import { ApiProperty } from '@nestjs/swagger';

export class CreateUnitTagDto {
  @ApiProperty({ description: 'The ID of the unit this tag belongs to' })
    unitId!: number;

  @ApiProperty({ description: 'The tag text' })
    tag!: string;

  @ApiProperty({ description: 'The color of the tag', required: false })
    color?: string;
}
