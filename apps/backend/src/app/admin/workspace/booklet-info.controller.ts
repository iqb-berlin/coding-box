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
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { BookletInfoService } from '../../workspaces/services/booklet-info.service';
import { BookletInfoDto } from '../../../../../../api-dto/booklet-info/booklet-info.dto';

@ApiTags('Booklet Info')
@Controller('admin/workspace/:workspaceId/booklet')
@UseGuards(JwtAuthGuard)
export class BookletInfoController {
  constructor(private readonly bookletInfoService: BookletInfoService) {}

  @Get(':bookletId/info')
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
