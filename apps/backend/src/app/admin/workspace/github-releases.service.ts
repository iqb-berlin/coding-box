import {
  BadRequestException, Injectable, InternalServerErrorException, Logger
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { WorkspaceFilesService } from '../../database/services/workspace/workspace-files.service';
import { FileIo } from './file-io.interface';

export interface GithubRelease {
  tag_name: string;
  published_at: string;
  assets: {
    name: string;
    browser_download_url: string;
  }[];
}

export interface GithubReleaseShort {
  version: string;
  url: string;
  name: string;
  published_at: string;
}

@Injectable()
export class GithubReleasesService {
  private readonly logger = new Logger(GithubReleasesService.name);
  private readonly repositories = {
    'aspect-player': 'iqb-berlin/verona-modules-aspect',
    schemer: 'iqb-berlin/coding-components'
  };

  constructor(
    private readonly httpService: HttpService,
    private readonly workspaceFilesService: WorkspaceFilesService
  ) { }

  async getReleases(type: 'aspect-player' | 'schemer'): Promise<GithubReleaseShort[]> {
    const repo = this.repositories[type];
    if (!repo) {
      throw new BadRequestException('Invalid release type');
    }

    try {
      const response = await firstValueFrom(
        this.httpService.get<GithubRelease[]>(`https://api.github.com/repos/${repo}/releases`)
      );

      return response.data
        .map(release => {
          let asset;
          if (type === 'aspect-player') {
            asset = release.assets.find(a => a.name.endsWith('.html') && a.name.toLowerCase().includes('player'));
          } else {
            asset = release.assets.find(a => a.name.endsWith('.html'));
          }

          if (!asset) return null;
          return {
            version: release.tag_name,
            url: asset.browser_download_url,
            name: asset.name,
            published_at: release.published_at
          };
        })
        .filter((r): r is GithubReleaseShort => r !== null);
    } catch (error) {
      this.logger.error(`Error fetching releases for ${type}: ${error.message}`);
      throw new InternalServerErrorException('Failed to fetch releases from GitHub');
    }
  }

  async downloadAndInstall(
    workspaceId: number,
    url: string
  ): Promise<boolean> {
    try {
      this.logger.log(`Downloading file from ${url} for workspace ${workspaceId}`);
      const response = await firstValueFrom(
        this.httpService.get(url, { responseType: 'arraybuffer' })
      );

      const buffer = Buffer.from(response.data);
      const filename = decodeURIComponent(url.split('/').pop() || 'download.html');
      const fileIo: FileIo = {
        buffer,
        originalname: filename,
        mimetype: 'text/html',
        size: buffer.length,
        fieldname: 'file',
        encoding: '7bit'
      };

      await this.workspaceFilesService.uploadTestFiles(
        workspaceId,
        [fileIo],
        true);
      return true;
    } catch (error) {
      this.logger.error(`Error downloading/installing file: ${error.message}`);
      throw new InternalServerErrorException('Failed to download and install file');
    }
  }
}
