import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { WorkspaceGuard } from './workspace.guard';
import { WorkspaceId } from './workspace.decorator';
import { GithubReleasesService, GithubReleaseShort } from './github-releases.service';

@ApiTags('Admin Workspace GitHub')
@Controller('admin/workspace')
export class GithubReleasesController {
  constructor(private readonly githubReleasesService: GithubReleasesService) {}

  @Get(':workspace_id/github/releases/:type')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async getReleases(
    @WorkspaceId() workspaceId: number,
      @Param('type') type: 'aspect-player' | 'schemer'
  ): Promise<GithubReleaseShort[]> {
    return this.githubReleasesService.getReleases(type);
  }

  @Post(':workspace_id/github/install')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async installRelease(
    @WorkspaceId() workspaceId: number,
      @Body() body: { url: string }
  ): Promise<boolean> {
    return this.githubReleasesService.downloadAndInstall(workspaceId, body.url);
  }
}
