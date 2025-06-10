import { ApiProperty } from '@nestjs/swagger';

export class UnitNoteDto {
  @ApiProperty({ description: 'The unique identifier of the unit note' })
    id!: number;

  @ApiProperty({ description: 'The ID of the unit this note belongs to' })
    unitId!: number;

  @ApiProperty({ description: 'The note text' })
    note!: string;

  @ApiProperty({ description: 'The date and time when the note was created' })
    createdAt!: Date;

  @ApiProperty({ description: 'The date and time when the note was last updated' })
    updatedAt!: Date;
}
