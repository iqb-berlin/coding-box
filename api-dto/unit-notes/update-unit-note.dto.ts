import { ApiProperty } from '@nestjs/swagger';

export class UpdateUnitNoteDto {
  @ApiProperty({ description: 'The note text' })
    note!: string;
}
