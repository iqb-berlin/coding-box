import { Injectable, Logger } from '@nestjs/common';
import { CodingScheme } from '@iqbspecs/coding-scheme';
import { FileUpload } from '../../common';
import { WorkspacesFacadeService } from '../../workspaces/services/workspaces-facade.service';

@Injectable()
export class CodingFileCache {
  private readonly logger = new Logger(CodingFileCache.name);

  private codingSchemeCache: Map<
  string,
  { scheme: CodingScheme; timestamp: number }
  > = new Map();

  private readonly SCHEME_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes cache TTL

  private testFileCache: Map<
  number,
  { files: Map<string, FileUpload>; timestamp: number }
  > = new Map();

  private readonly TEST_FILE_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes cache TTL

  constructor(
    private readonly workspacesFacadeService: WorkspacesFacadeService
  ) {}

  async getTestFilesWithCache(
    workspace_id: number,
    unitAliasesArray: string[]
  ): Promise<Map<string, FileUpload>> {
    const cacheEntry = this.testFileCache.get(workspace_id);
    const now = Date.now();

    if (
      cacheEntry &&
      now - cacheEntry.timestamp < this.TEST_FILE_CACHE_TTL_MS
    ) {
      this.logger.log(`Using cached test files for workspace ${workspace_id}`);
      const missingAliases = unitAliasesArray.filter(
        alias => !cacheEntry.files.has(alias)
      );
      if (missingAliases.length === 0) {
        return cacheEntry.files;
      }

      this.logger.log(
        `Fetching ${missingAliases.length} missing test files for workspace ${workspace_id}`
      );
      const missingFiles = await this.workspacesFacadeService.findFilesByFileIds(workspace_id, missingAliases);

      missingFiles.forEach(file => {
        cacheEntry.files.set(file.file_id, file);
      });

      cacheEntry.timestamp = now;

      return cacheEntry.files;
    }

    this.logger.log(`Fetching all test files for workspace ${workspace_id}`);
    const testFiles = await this.workspacesFacadeService.findFilesByFileIds(workspace_id, unitAliasesArray);

    const fileMap = new Map<string, FileUpload>();
    testFiles.forEach(file => {
      fileMap.set(file.file_id, file);
    });

    this.testFileCache.set(workspace_id, { files: fileMap, timestamp: now });
    return fileMap;
  }

  async getCodingSchemesWithCache(
    codingSchemeRefs: string[]
  ): Promise<Map<string, CodingScheme>> {
    const now = Date.now();
    const result = new Map<string, CodingScheme>();
    const emptyScheme = new CodingScheme({});

    const missingSchemeRefs = codingSchemeRefs.filter(ref => {
      const cacheEntry = this.codingSchemeCache.get(ref);
      if (cacheEntry && now - cacheEntry.timestamp < this.SCHEME_CACHE_TTL_MS) {
        result.set(ref, cacheEntry.scheme);
        return false;
      }
      return true;
    });

    if (missingSchemeRefs.length === 0) {
      this.logger.log('Using all cached coding schemes');
      return result;
    }

    this.logger.log(
      `Fetching ${missingSchemeRefs.length} missing coding schemes`
    );
    const codingSchemeFiles = await this.workspacesFacadeService.findFilesByFileIds(undefined, missingSchemeRefs);

    codingSchemeFiles.forEach(file => {
      try {
        const data =
          typeof file.data === 'string' ? JSON.parse(file.data) : file.data;
        const scheme = new CodingScheme(data);
        result.set(file.file_id, scheme);
        this.codingSchemeCache.set(file.file_id, { scheme, timestamp: now });
      } catch (error) {
        this.logger.error(
          `--- Fehler beim Verarbeiten des Kodierschemas ${file.filename}: ${error.message}`
        );
        result.set(file.file_id, emptyScheme);
      }
    });

    return result;
  }

  cleanupCaches(): void {
    const now = Date.now();
    for (const [key, entry] of this.codingSchemeCache.entries()) {
      if (now - entry.timestamp > this.SCHEME_CACHE_TTL_MS) {
        this.codingSchemeCache.delete(key);
      }
    }
    for (const [key, entry] of this.testFileCache.entries()) {
      if (now - entry.timestamp > this.TEST_FILE_CACHE_TTL_MS) {
        this.testFileCache.delete(key);
      }
    }
  }
}
