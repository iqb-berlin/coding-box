import { ApiProperty } from '@nestjs/swagger';

export class Persons {
  @ApiProperty()
    id!: number;

  @ApiProperty()
    login!: string;

  @ApiProperty()
    code!: string;

  @ApiProperty()
    group!: string;

  @ApiProperty()
    workspace_id!: number;

  @ApiProperty()
    uploaded_at!: Date;

  @ApiProperty()
    booklets: unknown;

  @ApiProperty()
    source!: string;
}
