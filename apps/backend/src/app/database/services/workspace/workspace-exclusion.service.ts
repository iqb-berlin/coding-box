import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
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

export type ResolvedWorkspaceExclusions = {
  globalIgnoredUnits: string[];
  ignoredBooklets: string[];
  testletIgnoredUnits: { bookletId: string; unitId: string }[];
};

export type ExclusionQueryOptions = {
  unitAlias?: string | null;
  bookletInfoAlias?: string | null;
  unitNameExpression?: string | null;
  bookletNameExpression?: string | null;
  parameterPrefix?: string;
};

export const normalizeExclusionUnitId = (value: string | null | undefined): string => (
  String(value || '').trim().toUpperCase().replace(/\.XML$/i, '')
);

export const normalizeExclusionBookletId = (value: string | null | undefined): string => (
  String(value || '').trim().toUpperCase()
);

const normalizedUnitSql = (expression: string): string => (
  `REGEXP_REPLACE(UPPER(${expression}), '\\.XML$', '', 'i')`
);

export function isExcludedByResolvedExclusions(
  exclusions: ResolvedWorkspaceExclusions,
  bookletName: string | null | undefined,
  unitName: string | null | undefined
): boolean {
  const normalizedUnit = normalizeExclusionUnitId(unitName);
  const normalizedBooklet = normalizeExclusionBookletId(bookletName);

  if (normalizedUnit && exclusions.globalIgnoredUnits.map(normalizeExclusionUnitId).includes(normalizedUnit)) {
    return true;
  }

  if (normalizedBooklet && exclusions.ignoredBooklets.map(normalizeExclusionBookletId).includes(normalizedBooklet)) {
    return true;
  }

  if (normalizedBooklet && normalizedUnit) {
    return exclusions.testletIgnoredUnits.some(t => (
      normalizeExclusionBookletId(t.bookletId) === normalizedBooklet &&
      normalizeExclusionUnitId(t.unitId) === normalizedUnit
    ));
  }

  return false;
}

export function applyResolvedExclusionsToQuery<T>(
  qb: SelectQueryBuilder<T>,
  exclusions: ResolvedWorkspaceExclusions,
  options: ExclusionQueryOptions = {}
): void {
  let unitExpression: string | null | undefined;
  if (options.unitNameExpression !== undefined) {
    unitExpression = options.unitNameExpression;
  } else {
    unitExpression = options.unitAlias === null ? null : `${options.unitAlias || 'unit'}.name`;
  }

  let bookletExpression: string | null | undefined;
  if (options.bookletNameExpression !== undefined) {
    bookletExpression = options.bookletNameExpression;
  } else {
    bookletExpression = options.bookletInfoAlias === null ? null : `${options.bookletInfoAlias || 'bookletinfo'}.name`;
  }
  const prefix = options.parameterPrefix || 'workspaceExclusion';

  if (unitExpression && exclusions.globalIgnoredUnits.length > 0) {
    qb.andWhere(
      `${normalizedUnitSql(unitExpression)} NOT IN (:...${prefix}IgnoredUnits)`,
      {
        [`${prefix}IgnoredUnits`]: exclusions.globalIgnoredUnits.map(normalizeExclusionUnitId)
      }
    );
  }

  if (bookletExpression && exclusions.ignoredBooklets.length > 0) {
    qb.andWhere(
      `UPPER(${bookletExpression}) NOT IN (:...${prefix}IgnoredBooklets)`,
      {
        [`${prefix}IgnoredBooklets`]: exclusions.ignoredBooklets.map(normalizeExclusionBookletId)
      }
    );
  }

  if (unitExpression && bookletExpression && exclusions.testletIgnoredUnits.length > 0) {
    const condition = exclusions.testletIgnoredUnits
      .map((_, i: number) => (
        `(UPPER(${bookletExpression}) = :${prefix}Booklet${i} AND ${normalizedUnitSql(unitExpression)} = :${prefix}Unit${i})`
      ))
      .join(' OR ');
    const params: Record<string, string> = {};
    exclusions.testletIgnoredUnits.forEach((t, i: number) => {
      params[`${prefix}Booklet${i}`] = normalizeExclusionBookletId(t.bookletId);
      params[`${prefix}Unit${i}`] = normalizeExclusionUnitId(t.unitId);
    });
    qb.andWhere(`NOT (${condition})`, params);
  }
}

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

  async resolveExclusionsForQueries(workspaceId: number): Promise<ResolvedWorkspaceExclusions> {
    const cacheKey = `${EXCLUSION_CACHE_PREFIX}${workspaceId}`;
    const cached = await this.cacheService.get<ResolvedWorkspaceExclusions>(cacheKey);

    if (cached) {
      return cached;
    }

    const exclusions = await this.getExclusions(workspaceId);

    const globalIgnoredUnits = (exclusions.ignoredUnits || []).map(normalizeExclusionUnitId);
    const ignoredBooklets = (exclusions.ignoredBooklets || []).map(normalizeExclusionBookletId);
    const testletIgnoredUnits: { bookletId: string; unitId: string }[] = [];

    // If there are ignored testlets, we must parse the booklets to find out which units are inside them.
    if (exclusions.ignoredTestlets && exclusions.ignoredTestlets.length > 0) {
      // Find the unique booklets we need to parse.
      const bookletsToParse = Array.from(new Set(exclusions.ignoredTestlets.map(t => normalizeExclusionBookletId(t.bookletId))));

      const bookletFiles = await this.fileUploadRepository.find({
        where: {
          workspace_id: workspaceId,
          file_type: 'Booklet'
        }
      });

      for (const bookletFile of bookletFiles) {
        const fileId = normalizeExclusionBookletId(bookletFile.file_id);
        if (fileId && bookletsToParse.includes(fileId)) {
          try {
            const $ = cheerio.load(bookletFile.data, { xmlMode: true });
            const testletsToIgnore = exclusions.ignoredTestlets
              .filter(t => normalizeExclusionBookletId(t.bookletId) === fileId)
              .map(t => normalizeExclusionBookletId(t.testletId));
            $('Unit, unit').each((_, element) => {
              const unitId = $(element).attr('id');
              if (unitId) {
                let current = $(element).parent();
                while (current.length && current[0].tagName.toLowerCase() === 'testlet') {
                  const testletId = current.attr('id');
                  if (testletId && testletsToIgnore.includes(normalizeExclusionBookletId(testletId))) {
                    testletIgnoredUnits.push({
                      bookletId: fileId,
                      unitId: normalizeExclusionUnitId(unitId)
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
