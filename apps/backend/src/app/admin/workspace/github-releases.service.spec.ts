import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { of } from 'rxjs';
import { GithubReleasesService } from './github-releases.service';
import { WorkspaceFilesService } from '../../database/services/workspace/workspace-files.service';

describe('GithubReleasesService', () => {
  let service: GithubReleasesService;

  const mockHttpService = {
    get: jest.fn()
  };

  const mockWorkspaceFilesService = {
    uploadTestFiles: jest.fn()
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GithubReleasesService,
        {
          provide: HttpService,
          useValue: mockHttpService
        },
        {
          provide: WorkspaceFilesService,
          useValue: mockWorkspaceFilesService
        }
      ]
    }).compile();

    service = module.get<GithubReleasesService>(GithubReleasesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getReleases', () => {
    const mockReleasesResponse = {
      data: [
        {
          tag_name: 'v2.0.0',
          published_at: '2023-01-01T12:00:00Z',
          assets: [
            {
              name: 'iqb-aspect-player-2.0.0.html',
              browser_download_url: 'http://example.com/player.html'
            },
            {
              name: 'iqb-aspect-editor-2.0.0.html',
              browser_download_url: 'http://example.com/editor.html'
            },
            {
              name: 'other-file.txt',
              browser_download_url: 'http://example.com/file.txt'
            }
          ]
        },
        {
          tag_name: 'v2.1.0',
          published_at: '2023-02-01T12:00:00Z',
          assets: [
            {
              name: 'iqb-aspect-editor-2.1.0.html',
              browser_download_url: 'http://example.com/editor-only.html'
            }
          ]
        }
      ]
    };

    it('should filter out editors for aspect-player type', async () => {
      mockHttpService.get.mockReturnValue(of(mockReleasesResponse));

      const result = await service.getReleases('aspect-player');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('iqb-aspect-player-2.0.0.html');
      expect(result.some(r => r.name.includes('editor'))).toBeFalsy();
    });

    it('should include any html file for schemer type', async () => {
      const schemerResponse = {
        data: [
          {
            tag_name: 'v1.0.0',
            published_at: '2023-01-01',
            assets: [
              {
                name: 'schemer.html',
                browser_download_url: 'http://example.com/schemer.html'
              }
            ]
          }
        ]
      };
      mockHttpService.get.mockReturnValue(of(schemerResponse));

      const result = await service.getReleases('schemer');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('schemer.html');
    });
  });
});
