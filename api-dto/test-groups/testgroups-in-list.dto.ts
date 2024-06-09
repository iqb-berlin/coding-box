import { ApiProperty } from '@nestjs/swagger';

export class TestGroupsInListDto {
  @ApiProperty()
    test_group!: string;

  @ApiProperty()
    created_at?: string;
}
