import { ApiProperty } from '@nestjs/swagger';

export class CreateUnitNoteDto {
  @ApiProperty({ description: 'The ID of the unit this note belongs to' })
    unitId!: number;

  @ApiProperty({ description: 'The note text' })
    note!: string;
}
