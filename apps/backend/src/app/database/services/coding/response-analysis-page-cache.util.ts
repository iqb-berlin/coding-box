import {
  AggregationSummaryDto,
  DuplicateValueAnalysisDto,
  DuplicateValueGroupDto,
  EmptyResponseAnalysisDto,
  EmptyResponseDto,
  ResponseAnalysisDto
} from '../../../../../../../api-dto/coding/response-analysis.dto';

export interface ResponseAnalysisSummaryCache {
  emptyResponses: Omit<EmptyResponseAnalysisDto, 'items' | 'page' | 'pageSize'>;
  duplicateValues: Omit<
  DuplicateValueAnalysisDto,
  'groups' | 'page' | 'pageSize'
  >;
  aggregationSummary: AggregationSummaryDto;
  matchingFlags: string[];
  analysisTimestamp: string;
  sourceRevision?: number;
}

export interface EmptyResponsePageCache {
  items: EmptyResponseDto[];
  page: number;
  pageSize: number;
}

export interface DuplicateValuePageCache {
  groups: DuplicateValueGroupDto[];
  page: number;
  pageSize: number;
}

export interface EmptyResponseChunkCache {
  items: EmptyResponseDto[];
  chunkIndex: number;
  chunkSize: number;
}

export interface DuplicateValueChunkCache {
  groups: DuplicateValueGroupDto[];
  chunkIndex: number;
  chunkSize: number;
}

export const RESPONSE_ANALYSIS_EMPTY_PAGE_LIMITS = [5, 10, 25, 50, 100];
export const RESPONSE_ANALYSIS_DUPLICATE_PAGE_LIMITS = [5, 10, 20, 50, 100];
export const RESPONSE_ANALYSIS_OCCURRENCE_PREVIEW_LIMIT = 5;
export const RESPONSE_ANALYSIS_CHUNK_SIZE = 500;

export function getResponseAnalysisSummaryCacheKey(cacheKey: string): string {
  return `${cacheKey}:summary`;
}

export function getResponseAnalysisEmptyPageCacheKey(
  cacheKey: string,
  page: number,
  pageSize: number
): string {
  return `${cacheKey}:empty:p${page}:l${pageSize}`;
}

export function getResponseAnalysisDuplicatePageCacheKey(
  cacheKey: string,
  page: number,
  pageSize: number
): string {
  return `${cacheKey}:duplicate:p${page}:l${pageSize}`;
}

export function getResponseAnalysisEmptyChunkCacheKey(
  cacheKey: string,
  chunkIndex: number
): string {
  return `${cacheKey}:empty-chunk:${chunkIndex}`;
}

export function getResponseAnalysisDuplicateChunkCacheKey(
  cacheKey: string,
  chunkIndex: number
): string {
  return `${cacheKey}:duplicate-chunk:${chunkIndex}`;
}

export function getResponseAnalysisDerivedCachePattern(
  cacheKey: string
): string {
  return `${cacheKey}:*`;
}

export function createResponseAnalysisSummaryCache(
  analysis: ResponseAnalysisDto
): ResponseAnalysisSummaryCache {
  return {
    emptyResponses: {
      total: analysis.emptyResponses.total,
      totalUncoded: analysis.emptyResponses.totalUncoded
    },
    duplicateValues: {
      total: analysis.duplicateValues.total,
      totalResponses: analysis.duplicateValues.totalResponses,
      isAggregationApplied: analysis.duplicateValues.isAggregationApplied
    },
    aggregationSummary: analysis.aggregationSummary,
    matchingFlags: analysis.matchingFlags,
    analysisTimestamp: analysis.analysisTimestamp,
    sourceRevision: analysis.sourceRevision
  };
}

export function createEmptyResponsePageCache(
  analysis: ResponseAnalysisDto,
  page: number,
  pageSize: number
): EmptyResponsePageCache {
  const start = (page - 1) * pageSize;
  return {
    items: analysis.emptyResponses.items.slice(start, start + pageSize),
    page,
    pageSize
  };
}

export function createDuplicateValuePageCache(
  analysis: ResponseAnalysisDto,
  page: number,
  pageSize: number
): DuplicateValuePageCache {
  const start = (page - 1) * pageSize;
  return {
    groups: analysis.duplicateValues.groups
      .slice(start, start + pageSize)
      .map(group => ({
        ...group,
        occurrenceCount: group.occurrenceCount ?? group.occurrences.length,
        occurrences: group.occurrences.slice(
          0,
          RESPONSE_ANALYSIS_OCCURRENCE_PREVIEW_LIMIT
        )
      })),
    page,
    pageSize
  };
}

export function createEmptyResponseChunkCaches(
  analysis: ResponseAnalysisDto,
  chunkSize = RESPONSE_ANALYSIS_CHUNK_SIZE
): EmptyResponseChunkCache[] {
  return chunkArray(analysis.emptyResponses.items, chunkSize).map(
    (items, chunkIndex) => ({
      items,
      chunkIndex,
      chunkSize
    })
  );
}

export function createDuplicateValueChunkCaches(
  analysis: ResponseAnalysisDto,
  chunkSize = RESPONSE_ANALYSIS_CHUNK_SIZE
): DuplicateValueChunkCache[] {
  return chunkArray(
    analysis.duplicateValues.groups.map(group => ({
      ...group,
      occurrenceCount: group.occurrenceCount ?? group.occurrences.length,
      occurrences: group.occurrences.slice(
        0,
        RESPONSE_ANALYSIS_OCCURRENCE_PREVIEW_LIMIT
      )
    })),
    chunkSize
  ).map((groups, chunkIndex) => ({
    groups,
    chunkIndex,
    chunkSize
  }));
}

export function getRequiredResponseAnalysisChunkIndexes(
  page: number,
  pageSize: number,
  chunkSize = RESPONSE_ANALYSIS_CHUNK_SIZE
): number[] {
  const start = Math.max(0, (page - 1) * pageSize);
  const end = Math.max(start, start + pageSize - 1);
  const firstChunk = Math.floor(start / chunkSize);
  const lastChunk = Math.floor(end / chunkSize);
  return Array.from(
    { length: lastChunk - firstChunk + 1 },
    (_, index) => firstChunk + index
  );
}

export function createEmptyResponsePageCacheFromChunks(
  chunks: EmptyResponseChunkCache[],
  page: number,
  pageSize: number
): EmptyResponsePageCache | null {
  const items = slicePageFromChunks(chunks, page, pageSize, chunk => chunk.items);
  return items ? { items, page, pageSize } : null;
}

export function createDuplicateValuePageCacheFromChunks(
  chunks: DuplicateValueChunkCache[],
  page: number,
  pageSize: number
): DuplicateValuePageCache | null {
  const groups = slicePageFromChunks(chunks, page, pageSize, chunk => chunk.groups);
  return groups ? { groups, page, pageSize } : null;
}

export function createResponseAnalysisFromCachedParts(
  summary: ResponseAnalysisSummaryCache,
  emptyPage: EmptyResponsePageCache,
  duplicatePage: DuplicateValuePageCache,
  currentSourceRevision: number,
  isCalculating: boolean,
  progress: number
): ResponseAnalysisDto {
  return {
    emptyResponses: {
      ...summary.emptyResponses,
      items: emptyPage.items,
      page: emptyPage.page,
      pageSize: emptyPage.pageSize
    },
    duplicateValues: {
      ...summary.duplicateValues,
      groups: duplicatePage.groups,
      page: duplicatePage.page,
      pageSize: duplicatePage.pageSize
    },
    aggregationSummary: summary.aggregationSummary,
    matchingFlags: summary.matchingFlags,
    analysisTimestamp: summary.analysisTimestamp,
    sourceRevision: summary.sourceRevision,
    currentSourceRevision,
    isCalculating,
    progress
  };
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += chunkSize) {
    chunks.push(items.slice(start, start + chunkSize));
  }
  if (chunks.length === 0) {
    chunks.push([]);
  }
  return chunks;
}

function slicePageFromChunks<T, TChunk>(
  chunks: TChunk[],
  page: number,
  pageSize: number,
  getItems: (chunk: TChunk) => T[]
): T[] | null {
  if (chunks.length === 0 || chunks.some(chunk => !chunk)) {
    return null;
  }
  const chunkSize = getChunkSize(chunks[0]);
  if (!chunkSize) {
    return null;
  }
  const orderedChunks = [...chunks].sort(
    (a, b) => getChunkIndex(a) - getChunkIndex(b)
  );
  const firstChunkStart = getChunkIndex(orderedChunks[0]) * chunkSize;
  const pageStart = Math.max(0, (page - 1) * pageSize);
  const relativeStart = pageStart - firstChunkStart;
  if (relativeStart < 0) {
    return null;
  }

  return orderedChunks
    .flatMap(chunk => getItems(chunk))
    .slice(relativeStart, relativeStart + pageSize);
}

function getChunkIndex(chunk: unknown): number {
  return typeof chunk === 'object' && chunk !== null &&
    'chunkIndex' in chunk &&
    typeof chunk.chunkIndex === 'number' ?
    chunk.chunkIndex :
    0;
}

function getChunkSize(chunk: unknown): number | null {
  return typeof chunk === 'object' && chunk !== null &&
    'chunkSize' in chunk &&
    typeof chunk.chunkSize === 'number' ?
    chunk.chunkSize :
    null;
}
