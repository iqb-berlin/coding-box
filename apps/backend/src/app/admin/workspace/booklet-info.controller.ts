import {
  Controller,
  Get,
  Param,
  UseGuards
} from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags
} from '@nestjs/swagger';
import { JwtOrWorkspaceTokenAuthGuard } from '../../auth/jwt-or-workspace-token-auth.guard';
import {
  AllowWorkspaceTokenScopes,
  WORKSPACE_TOKEN_SCOPE_REPLAY_READ
} from '../../auth/workspace-token';
import { WorkspaceGuard } from './workspace.guard';
import { BookletInfoService } from '../../database/services/workspace';
import { BookletInfoDto } from '../../../../../../api-dto/booklet-info/booklet-info.dto';

@ApiTags('Booklet Info')
@Controller('admin/workspace/:workspaceId/booklet')
@UseGuards(JwtOrWorkspaceTokenAuthGuard, WorkspaceGuard)
export class BookletInfoController {
  constructor(private readonly bookletInfoService: BookletInfoService) {}

  @Get(':bookletId/info')
  @AllowWorkspaceTokenScopes(WORKSPACE_TOKEN_SCOPE_REPLAY_READ)
  @ApiOperation({ summary: 'Get booklet info from XML' })
  @ApiParam({ name: 'workspaceId', type: Number })
  @ApiParam({ name: 'bookletId', type: String })
  @ApiResponse({
    status: 200,
    description: 'Booklet info retrieved successfully',
    type: BookletInfoDto
  })
  async getBookletInfo(
    @Param('workspaceId') workspaceId: number,
      @Param('bookletId') bookletId: string
  ): Promise<BookletInfoDto> {
    return this.bookletInfoService.getBookletInfo(workspaceId, bookletId);
  }
}
