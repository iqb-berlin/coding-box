import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as cheerio from 'cheerio';
// eslint-disable-next-line import/no-cycle
import { WorkspaceCoreService } from './workspace-core.service';
import { WorkspaceSettingsDto } from '../../../../../../../api-dto/workspaces/workspace-settings-dto';
import FileUpload from '../../entities/file_upload.entity';
import { CacheService } from '../../../cache/cache.service';
import { EXCLUSION_CACHE_PREFIX } from './workspace-constants';

export type ExclusionContext = {
  unitId?: string;
  bookletId?: string;
  testletId?: string;
};

@Injectable()
export class WorkspaceExclusionService {
  constructor(
    private readonly workspaceCoreService: WorkspaceCoreService,
    @InjectRepository(FileUpload)
    private readonly fileUploadRepository: Repository<FileUpload>,
    private readonly cacheService: CacheService
  ) {}

  async invalidateExclusionCache(workspaceId: number): Promise<void> {
    await this.cacheService.delete(`${EXCLUSION_CACHE_PREFIX}${workspaceId}`);
  }

  async getExclusions(workspaceId: number): Promise<WorkspaceSettingsDto> {
    const workspace = await this.workspaceCoreService.findOne(workspaceId);
    return (workspace.settings as WorkspaceSettingsDto) || {};
  }

  isExcluded(context: ExclusionContext, exclusions: WorkspaceSettingsDto): boolean {
    if (!exclusions) return false;

    if (context.bookletId && exclusions.ignoredBooklets) {
      if (exclusions.ignoredBooklets.some(b => b.toUpperCase() === context.bookletId!.toUpperCase())) {
        return true;
      }
    }

    if (context.bookletId && context.testletId && exclusions.ignoredTestlets) {
      const isTestletIgnored = exclusions.ignoredTestlets.some(
        t => t.bookletId.toUpperCase() === context.bookletId!.toUpperCase() &&
          t.testletId.toUpperCase() === context.testletId!.toUpperCase()
      );
      if (isTestletIgnored) {
        return true;
      }
    }

    if (context.unitId && exclusions.ignoredUnits) {
      if (exclusions.ignoredUnits.some(u => u.toUpperCase() === context.unitId!.toUpperCase())) {
        return true;
      }
    }

    return false;
  }

  async resolveExclusionsForQueries(workspaceId: number): Promise<{
    globalIgnoredUnits: string[];
    ignoredBooklets: string[];
    testletIgnoredUnits: { bookletId: string; unitId: string }[];
  }> {
    const cacheKey = `${EXCLUSION_CACHE_PREFIX}${workspaceId}`;
    const cached = await this.cacheService.get<{
      globalIgnoredUnits: string[];
      ignoredBooklets: string[];
      testletIgnoredUnits: { bookletId: string; unitId: string }[];
    }>(cacheKey);

    if (cached) {
      return cached;
    }

    const exclusions = await this.getExclusions(workspaceId);

    const globalIgnoredUnits = (exclusions.ignoredUnits || []).map(u => u.toUpperCase());
    const ignoredBooklets = (exclusions.ignoredBooklets || []).map(b => b.toUpperCase());
    const testletIgnoredUnits: { bookletId: string; unitId: string }[] = [];

    // If there are ignored testlets, we must parse the booklets to find out which units are inside them.
    if (exclusions.ignoredTestlets && exclusions.ignoredTestlets.length > 0) {
      // Find the unique booklets we need to parse.
      const bookletsToParse = Array.from(new Set(exclusions.ignoredTestlets.map(t => t.bookletId.toUpperCase())));

      const bookletFiles = await this.fileUploadRepository.find({
        where: {
          workspace_id: workspaceId,
          file_type: 'Booklet'
        }
      });

      for (const bookletFile of bookletFiles) {
        const fileId = bookletFile.file_id?.toUpperCase();
        if (fileId && bookletsToParse.includes(fileId)) {
          try {
            const $ = cheerio.load(bookletFile.data, { xmlMode: true });
            const testletsToIgnore = exclusions.ignoredTestlets
              .filter(t => t.bookletId.toUpperCase() === fileId)
              .map(t => t.testletId.toUpperCase());
            $('Unit, unit').each((_, element) => {
              const unitId = $(element).attr('id');
              if (unitId) {
                let current = $(element).parent();
                while (current.length && current[0].tagName.toLowerCase() === 'testlet') {
                  const testletId = current.attr('id');
                  if (testletId && testletsToIgnore.includes(testletId.toUpperCase())) {
                    testletIgnoredUnits.push({
                      bookletId: fileId,
                      unitId: unitId.toUpperCase()
                    });
                    break; // No need to check ancestors if one matches
                  }
                  current = current.parent();
                }
              }
            });
          } catch (e) {
            // Error parsing booklet, safe to skip
          }
        }
      }
    }

    const result = { globalIgnoredUnits, ignoredBooklets, testletIgnoredUnits };
    await this.cacheService.set(cacheKey, result, 3600); // Cache for 1 hour
    return result;
  }
}
