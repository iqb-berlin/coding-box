import { ApiProperty } from '@nestjs/swagger';

export class WorkspaceSettingsDto {
  @ApiProperty({ type: [String], required: false })
    ignoredUnits?: string[];

  @ApiProperty({ type: [String], required: false })
    ignoredBooklets?: string[];

  @ApiProperty({ type: [Object], required: false })
    ignoredTestlets?: { bookletId: string; testletId: string }[];
}
