import { ApiProperty } from '@nestjs/swagger';

export class ResponseDto {
  @ApiProperty()
    id!: number;

  @ApiProperty()
    test_person!: string;

  @ApiProperty()
    unit_id!: string;

  @ApiProperty()
    test_group!: string;

  @ApiProperty()
    workspace_id!: number;

  @ApiProperty()
    created_at!: Date;

  @ApiProperty()
    responses: Array<{ id: string; content: string; ts: number; responseType: string }> | undefined;

  @ApiProperty()
    unit_state?: any | undefined;

  @ApiProperty()
    booklet_id!: string;
}
