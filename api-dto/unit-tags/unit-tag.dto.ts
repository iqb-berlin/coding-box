import { ApiProperty } from '@nestjs/swagger';

export class UnitTagDto {
  @ApiProperty({ description: 'The unique identifier of the unit tag' })
    id!: number;

  @ApiProperty({ description: 'The ID of the unit this tag belongs to' })
    unitId!: number;

  @ApiProperty({ description: 'The tag text' })
    tag!: string;

  @ApiProperty({ description: 'The color of the tag', required: false })
    color?: string;

  @ApiProperty({ description: 'The date and time when the tag was created' })
    createdAt!: Date;
}
