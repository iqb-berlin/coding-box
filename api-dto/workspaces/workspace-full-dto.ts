import { ApiProperty } from '@nestjs/swagger';
import { WorkspaceSettingsDto } from './workspace-settings-dto';

export class WorkspaceFullDto {
  @ApiProperty()
    id!: number;

  @ApiProperty({ example: 'VERA2002' })
    name?: string;

  @ApiProperty()
    settings?: WorkspaceSettingsDto;
}
