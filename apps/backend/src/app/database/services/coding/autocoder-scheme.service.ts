import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { CodingScheme } from '@iqbspecs/coding-scheme';
import * as Autocoder from '@iqb/responses';
import * as cheerio from 'cheerio';
import FileUpload from '../../entities/file_upload.entity';
import { Unit } from '../../entities/unit.entity';
import { getErrorMessage } from '../../../utils/error.util';
import { RuntimeConfigService } from '../../../config/runtime-config.service';
import { WORKSPACE_FILE_METADATA_READER, type WorkspaceFileMetadataReader } from '../workspace/workspace-file-metadata-reader.token';
import { applyAutocoderSchemaValidationMode } from './autocoder-schema-validation.util';
import { AutocoderNamespace } from './coding-process.types';
import { AutocoderEngineService } from './autocoder-engine.service';
import { getUnitFileId, normalizeVariableId } from './autocoder-response.util';

/** Owns workspace-scoped file caches, scheme lookup and schema validation. */
@Injectable()
export class AutocoderSchemeService {
  private readonly logger = new Logger(AutocoderSchemeService.name);

  constructor(
    @InjectRepository(FileUpload)
    private readonly fileUploadRepository: Repository<FileUpload>,
    @Inject(WORKSPACE_FILE_METADATA_READER)
    private readonly workspaceFilesService: WorkspaceFileMetadataReader,
    private readonly runtimeConfigService: RuntimeConfigService,
    private readonly engine: AutocoderEngineService
  ) {}

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

  async getTestFilesWithCache(
    workspace_id: number,
    unitAliasesArray: string[],
    manager?: EntityManager
  ): Promise<Map<string, FileUpload>> {
    const repository = manager?.getRepository(FileUpload) ||
      this.fileUploadRepository;
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
      const missingFiles = await repository.find({
        where: { workspace_id, file_id: In(missingAliases) },
        select: ['file_id', 'data', 'filename']
      });

      missingFiles.forEach(file => {
        cacheEntry.files.set(file.file_id, file);
      });

      cacheEntry.timestamp = now;

      return cacheEntry.files;
    }

    this.logger.log(`Fetching all test files for workspace ${workspace_id}`);
    const testFiles = await repository.find({
      where: { workspace_id, file_id: In(unitAliasesArray) },
      select: ['file_id', 'data', 'filename']
    });

    const fileMap = new Map<string, FileUpload>();
    testFiles.forEach(file => {
      fileMap.set(file.file_id, file);
    });

    this.testFileCache.set(workspace_id, { files: fileMap, timestamp: now });
    return fileMap;
  }

  async getCodingSchemesWithCache(
    workspaceId: number,
    codingSchemeRefs: string[],
    manager?: EntityManager
  ): Promise<Map<string, CodingScheme>> {
    const repository = manager?.getRepository(FileUpload) ||
      this.fileUploadRepository;
    const now = Date.now();
    const result = new Map<string, CodingScheme>();
    const emptyScheme = new CodingScheme({});

    const missingSchemeRefs = codingSchemeRefs.filter(ref => {
      const cacheEntry = this.codingSchemeCache.get(
        this.codingSchemeCacheKey(workspaceId, ref)
      );
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
    const codingSchemeFiles = await repository.find({
      where: { workspace_id: workspaceId, file_id: In(missingSchemeRefs) },
      select: ['file_id', 'data', 'filename']
    });

    codingSchemeFiles.forEach(file => {
      try {
        const data =
          typeof file.data === 'string' ? JSON.parse(file.data) : file.data;
        const scheme = new CodingScheme(data);
        result.set(file.file_id, scheme);
        this.codingSchemeCache.set(
          this.codingSchemeCacheKey(workspaceId, file.file_id),
          { scheme, timestamp: now }
        );
      } catch (error) {
        this.logger.error(
          `--- Fehler beim Verarbeiten des Kodierschemas ${file.filename}: ${getErrorMessage(error)}`
        );
        result.set(file.file_id, emptyScheme);
      }
    });

    return result;
  }

  private codingSchemeCacheKey(workspaceId: number, fileId: string): string {
    return `${workspaceId}:${fileId}`;
  }

  invalidateWorkspaceCaches(workspaceId: number): void {
    this.testFileCache.delete(workspaceId);

    const schemeCachePrefix = `${workspaceId}:`;
    for (const key of Array.from(this.codingSchemeCache.keys())) {
      if (key.startsWith(schemeCachePrefix)) {
        this.codingSchemeCache.delete(key);
      }
    }
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

  async validateCodingSchemeForUnit(
    workspaceId: number,
    codingSchemeRef: string,
    unitFileId: string | undefined,
    unit: Unit,
    scheme: CodingScheme,
    manager?: EntityManager
  ): Promise<void> {
    const baseVariables = unitFileId ?
      await this.workspaceFilesService.getVariableInfoForScheme(
        workspaceId,
        unitFileId,
        manager
      ) :
      [];
    let namespace: AutocoderNamespace;
    try {
      namespace = this.engine.createAutocoderNamespace(
        scheme.variableCodings || []
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Autocoder rejected coding scheme "${codingSchemeRef}" ` +
        `for unit "${unit.name}" (${unit.id}): ${message}.`
      );
    }

    const validation = applyAutocoderSchemaValidationMode(
      Autocoder.CodingSchemeFactory.validate(
        baseVariables,
        namespace.variableCodings
      ),
      this.runtimeConfigService.autocoderSchemaValidationMode,
      baseVariables,
      namespace.variableCodings
    );

    if (validation.toleratedProblems.length > 0) {
      const problemCounts = validation.toleratedProblems.reduce(
        (counts, problem) => {
          counts.set(problem.type, (counts.get(problem.type) || 0) + 1);
          return counts;
        },
        new Map<string, number>()
      );
      const problemSummary = [...problemCounts.entries()]
        .map(([type, count]) => `${type}=${count}`)
        .join(', ');
      this.logger.warn(
        [
          'Autocoder schema compatibility mode tolerated',
          `${validation.toleratedProblems.length} legacy source problem(s)`,
          `for coding scheme "${codingSchemeRef}" and unit`,
          `"${unit.name}" (${unit.id}): ${problemSummary}`
        ].join(' ')
      );
    }

    const breakingProblems = validation.blockingProblems;

    if (breakingProblems.length > 0) {
      const details = breakingProblems.map(problem => {
        const outputAlias = namespace.outputAliasByTechnicalId.get(
          normalizeVariableId(problem.variableId)
        ) || problem.variableId;
        return `${problem.type} for variable "${outputAlias}"` +
          `${problem.code ? ` (${problem.code})` : ''}`;
      }).join(', ');
      throw new Error(
        `Autocoder rejected coding scheme "${codingSchemeRef}" ` +
        `for unit "${unit.name}" (${unit.id}): ${details}.`
      );
    }
  }

  async getCodingSchemeFiles(
    workspaceId: number,
    codingSchemeRefs: Set<string>,
    jobId?: string,
    manager?: EntityManager,
    isJobCancelled: () => Promise<boolean> = async () => false
  ): Promise<Map<string, CodingScheme>> {
    const fileIdToCodingSchemeMap = await this.getCodingSchemesWithCache(
      workspaceId,
      [...codingSchemeRefs],
      manager
    );
    if (jobId && (await isJobCancelled())) {
      this.logger.log(
        `Job ${jobId} was cancelled or paused after getting coding scheme files`
      );
      return fileIdToCodingSchemeMap;
    }

    return fileIdToCodingSchemeMap;
  }

  async extractCodingSchemeReferences(
    units: Unit[],
    fileIdToTestFileMap: Map<string, FileUpload>,
    jobId?: string,
    isJobCancelled: () => Promise<boolean> = async () => false
  ): Promise<{
    codingSchemeRefs: Set<string>;
    unitToCodingSchemeRefMap: Map<number, string>;
  }> {
    const codingSchemeRefs = new Set<string>();
    const unitToCodingSchemeRefMap = new Map<number, string>();
    const batchSize = 50;

    for (let i = 0; i < units.length; i += batchSize) {
      const unitBatch = units.slice(i, i + batchSize);

      for (const unit of unitBatch) {
        const unitFileId = getUnitFileId(unit);
        if (!unitFileId) {
          this.logger.warn(
            `Skipping coding scheme lookup for unit ${unit.id}: missing unit alias and name.`
          );
          continue;
        }

        const testFile = fileIdToTestFileMap.get(unitFileId);
        if (!testFile) continue;

        try {
          const $ = cheerio.load(testFile.data);
          const codingSchemeRefText = $('codingSchemeRef').text();
          if (codingSchemeRefText) {
            const codingSchemeRefUpper = codingSchemeRefText.toUpperCase();
            codingSchemeRefs.add(codingSchemeRefUpper);
            unitToCodingSchemeRefMap.set(unit.id, codingSchemeRefUpper);
            this.logger.debug(
              `Extracted coding scheme mapping: unitId=${unit.id
              }, unitFileId=${unitFileId}, codingSchemeRef=${codingSchemeRefUpper}`
            );
          }
        } catch (error) {
          this.logger.error(
            `--- Fehler beim Verarbeiten der Datei ${testFile.filename}: ${getErrorMessage(error)}`
          );
        }
      }
      if (jobId && (await isJobCancelled())) {
        this.logger.log(
          `Job ${jobId} was cancelled or paused during scheme extraction`
        );
        return {
          codingSchemeRefs,
          unitToCodingSchemeRefMap
        };
      }
    }

    return {
      codingSchemeRefs,
      unitToCodingSchemeRefMap
    };
  }
}
