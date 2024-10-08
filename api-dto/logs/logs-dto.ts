import { ApiProperty } from '@nestjs/swagger';

export class LogsDto {
  @ApiProperty()
    id!: number;

  @ApiProperty()
    test_group!: string;

  @ApiProperty()
    unit_id!: string;

  @ApiProperty()
    workspace_id!: number;

  @ApiProperty()
    timestamp!: number;

  @ApiProperty()
    log_entry:string;

  @ApiProperty()
    booklet_id!: string;
}
