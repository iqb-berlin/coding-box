import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as cheerio from 'cheerio';
import Ajv, { ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';

import FileUpload from '../entities/file_upload.entity';
import Persons from '../entities/persons.entity';

import { FileValidationResultDto, FilteredTestTaker } from '../../../../../../api-dto/files/file-validation-result.dto';
import { WorkspaceXmlSchemaValidationService } from './workspace-xml-schema-validation.service';
import codingSchemeSchema = require('../../schemas/coding-scheme.schema.json');

type FileStatus = {
  filename: string;
  exists: boolean;
  schemaValid?: boolean;
  schemaErrors?: string[];
};

type DataValidation = {
  complete: boolean;
  missing: string[];
  missingUnitsPerBooklet?: { booklet: string; missingUnits: string[] }[];
  unitsWithoutPlayer?: string[];
  files: FileStatus[];
};

type UnitRefs = {
  codingSchemeRefs: string[];
  definitionRefs: string[];
  playerRefs: string[];
  hasPlayer: boolean;
};

type ValidationData = {
  testTaker: string;
  booklets: DataValidation;
  units: DataValidation;
  schemes: DataValidation;
  definitions: DataValidation;
  player: DataValidation;
};

@Injectable()
export class WorkspaceTestFilesValidationService {
  private readonly logger = new Logger(WorkspaceTestFilesValidationService.name);
  private codingSchemeValidator: ValidateFunction | null = null;

  constructor(
    @InjectRepository(FileUpload)
    private fileUploadRepository: Repository<FileUpload>,
    @InjectRepository(Persons)
    private personsRepository: Repository<Persons>,
    private workspaceXmlSchemaValidationService: WorkspaceXmlSchemaValidationService
  ) {}

  async validateTestFiles(workspaceId: number): Promise<FileValidationResultDto> {
    try {
      this.logger.log(`Starting batched test file validation for workspace ${workspaceId}`);

      const [bookletMap, unitMap, resourceIds, xmlSchemaResults, codingSchemeResults] = await Promise.all([
        this.preloadBookletToUnits(workspaceId),
        this.preloadUnitRefs(workspaceId),
        this.getAllResourceIds(workspaceId),
        this.workspaceXmlSchemaValidationService.validateAllXmlSchemas(workspaceId),
        this.validateAllCodingSchemes(workspaceId)
      ]);

      const summarizeSchemaResults = (label: string, results: Map<string, { schemaValid: boolean; errors: string[] }>): void => {
        const entries = Array.from(results.entries());
        const ok = entries.filter(([, r]) => r.schemaValid).length;
        const failed = entries.length - ok;
        this.logger.log(`${label} validation results for workspace ${workspaceId}: total=${entries.length}, ok=${ok}, failed=${failed}`);
        if (failed > 0) {
          const maxFailedToLog = 20;
          const failedPreview = entries
            .filter(([, r]) => !r.schemaValid)
            .slice(0, maxFailedToLog)
            .map(([key, r]) => ({
              key,
              errors: (r.errors || []).slice(0, 5)
            }));
          this.logger.warn(`${label} validation failed for workspace ${workspaceId}: ${JSON.stringify(failedPreview)}`);
          if (failed > maxFailedToLog) {
            this.logger.warn(`${label} validation: ${failed - maxFailedToLog} more failed file(s) not logged (preview limit reached).`);
          }
        }
      };

      summarizeSchemaResults('XSD schema', xmlSchemaResults);
      summarizeSchemaResults('JSON schema (coding scheme)', codingSchemeResults);
      const resourceIdsArray = Array.from(resourceIds);

      const validationResults: ValidationData[] = [];

      const usedTestTakerFileIds = new Set<string>();

      let filteredTestTakers: FilteredTestTaker[] = [];
      const loginOccurrences = new Map<string, { testTaker: string; mode: string }[]>();
      const modesNotToFilter = ['run-hot-return', 'run-hot-restart', 'run-trial'];
      const shouldFilterMode = (loginMode: string) => !modesNotToFilter.includes(loginMode);

      const BATCH_SIZE = 20;
      let offset = 0;
      let hasTestTakers = false;

      let testTakersBatch = await this.fileUploadRepository.find({
        where: { workspace_id: workspaceId, file_type: In(['TestTakers', 'Testtakers']) },
        skip: offset,
        take: BATCH_SIZE
      });

      while (testTakersBatch.length > 0) {
        hasTestTakers = true;

        for (const testTaker of testTakersBatch) {
          if (testTaker.file_id) {
            usedTestTakerFileIds.add(testTaker.file_id.toUpperCase());
          }
          const xmlDocument = cheerio.load(testTaker.data, { xml: true });
          const groupElements = xmlDocument('Group');

          for (let i = 0; i < groupElements.length; i++) {
            const groupElement = groupElements[i];
            const loginElements = xmlDocument(groupElement).find('Login');

            for (let j = 0; j < loginElements.length; j++) {
              const loginElement = loginElements[j];
              const loginName = xmlDocument(loginElement).attr('name');
              const loginMode = xmlDocument(loginElement).attr('mode');

              if (loginMode && shouldFilterMode(loginMode) && loginName) {
                filteredTestTakers.push({
                  testTaker: testTaker.file_id,
                  mode: loginMode,
                  login: loginName
                });

                const occurrences = loginOccurrences.get(loginName) || [];
                occurrences.push({
                  testTaker: testTaker.file_id,
                  mode: loginMode
                });
                loginOccurrences.set(loginName, occurrences);
              }
            }
          }

          const validationResult = this.processTestTakerWithCache(
            testTaker,
            bookletMap,
            unitMap,
            resourceIds,
            resourceIdsArray,
            xmlSchemaResults,
            codingSchemeResults
          );
          if (validationResult) {
            validationResults.push(validationResult);
          }
        }

        offset += BATCH_SIZE;
        testTakersBatch = await this.fileUploadRepository.find({
          where: { workspace_id: workspaceId, file_type: In(['TestTakers', 'Testtakers']) },
          skip: offset,
          take: BATCH_SIZE
        });
      }

      if (!hasTestTakers) {
        this.logger.warn(`No TestTakers found in workspace with ID ${workspaceId}.`);
        return {
          testTakersFound: false,
          validationResults: this.createEmptyValidationData()
        };
      }

      const unusedTestFiles = await this.getUnusedTestFilesFromValidationGraph(
        workspaceId,
        validationResults,
        usedTestTakerFileIds,
        resourceIdsArray
      );

      const duplicateTestTakers = Array.from(loginOccurrences.entries())
        .filter(([, occurrences]) => occurrences.length > 1)
        .map(([login, occurrences]) => ({
          login,
          occurrences
        }));

      this.logger.log(`Found ${duplicateTestTakers.length} duplicate test takers across files`);

      if (filteredTestTakers.length > 0) {
        const loginNames = filteredTestTakers.map(item => item.login);
        const personsNotConsideredLogins = await this.getPersonsNotConsidered(workspaceId, loginNames);

        if (personsNotConsideredLogins.length > 0) {
          this.logger.log(`Filtering out ${personsNotConsideredLogins.length} test takers where consider is false`);
          filteredTestTakers = filteredTestTakers.filter(item => !personsNotConsideredLogins.includes(item.login));
        }
      }

      if (validationResults.length > 0) {
        return {
          testTakersFound: true,
          filteredTestTakers: filteredTestTakers.length > 0 ? filteredTestTakers : undefined,
          duplicateTestTakers: duplicateTestTakers.length > 0 ? duplicateTestTakers : undefined,
          unusedTestFiles: unusedTestFiles.length > 0 ? unusedTestFiles : undefined,
          validationResults
        };
      }

      return {
        testTakersFound: true,
        filteredTestTakers: filteredTestTakers.length > 0 ? filteredTestTakers : undefined,
        duplicateTestTakers: duplicateTestTakers.length > 0 ? duplicateTestTakers : undefined,
        unusedTestFiles: unusedTestFiles.length > 0 ? unusedTestFiles : undefined,
        validationResults: this.createEmptyValidationData()
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error during test file validation for workspace ID ${workspaceId}: ${message}`, error instanceof Error ? error.stack : undefined);
      throw new Error(`Error during test file validation for workspace ID ${workspaceId}: ${message}`);
    }
  }

  private async getUnusedTestFilesFromValidationGraph(
    workspaceId: number,
    validationResults: ValidationData[],
    usedTestTakerFileIds: Set<string>,
    allResourceIds: string[]
  ): Promise<Array<{ id: number; fileId: string; filename: string; fileType: string }>> {
    const usedTokens = new Set<string>();

    const addPlayerPatchTokens = (token: string | undefined | null): void => {
      if (!token) {
        return;
      }
      const normalizedToken = token.trim().toUpperCase().replace(/\\/g, '/');
      if (!normalizedToken) {
        return;
      }

      const reg = /^(\D+?)[@V-]?(\d+)\.(\d+)(?:\.(\d+))?(?:-\S+?)?(?:\.(\D{3,4}))?$/;
      const match = normalizedToken.match(reg);
      if (!match) {
        return;
      }

      const module = match[1];
      const major = match[2];
      const minor = match[3];
      const patch = match[4];

      if (patch) {
        return;
      }

      const prefix = `${module}-${major}.${minor}.`;
      allResourceIds.forEach(id => {
        if (id && typeof id === 'string' && id.toUpperCase().startsWith(prefix)) {
          usedTokens.add(id.toUpperCase());
        }
      });
    };

    const addToken = (token: string | undefined | null): void => {
      if (!token) {
        return;
      }
      const normalized = token.trim().replace(/\\/g, '/');
      if (!normalized) {
        return;
      }
      const upper = normalized.toUpperCase();
      usedTokens.add(upper);

      const lastDot = normalized.lastIndexOf('.');
      if (lastDot > 0) {
        usedTokens.add(normalized.substring(0, lastDot).toUpperCase());
      }

      if (normalized.includes('/')) {
        const basename = normalized.split('/').pop();
        if (basename) {
          usedTokens.add(basename.toUpperCase());
          const baseLastDot = basename.lastIndexOf('.');
          if (baseLastDot > 0) {
            usedTokens.add(basename.substring(0, baseLastDot).toUpperCase());
          }
        }
      }

      usedTokens.add(`${upper}.VOCS`);
      usedTokens.add(`${upper}.XML`);
      usedTokens.add(`${upper}.HTML`);
      usedTokens.add(`${upper}.JSON`);
    };

    usedTestTakerFileIds.forEach(id => usedTokens.add(id));

    validationResults.forEach(result => {
      addToken(result.testTaker);
      result.booklets.files.forEach(f => addToken(f.filename));
      result.units.files.forEach(f => addToken(f.filename));
      result.schemes.files.forEach(f => addToken(f.filename));
      result.definitions.files.forEach(f => addToken(f.filename));
      result.player.files.forEach(f => {
        addToken(f.filename);
        addPlayerPatchTokens(f.filename);
      });
    });

    const allFiles = await this.fileUploadRepository.find({
      where: { workspace_id: workspaceId },
      select: ['id', 'file_id', 'filename', 'file_type']
    });

    return allFiles
      .filter(file => {
        const fileId = (file.file_id || '').trim().toUpperCase();
        const filename = (file.filename || '').trim().toUpperCase();
        if (!fileId && !filename) {
          return false;
        }
        const isUsed = usedTokens.has(fileId) || usedTokens.has(filename);
        return !isUsed;
      })
      .map(file => ({
        id: file.id,
        fileId: file.file_id,
        filename: file.filename,
        fileType: file.file_type
      }));
  }

  private async getPersonsNotConsidered(workspaceId: number, loginNames: string[]): Promise<string[]> {
    const BATCH_SIZE = 500;
    const notConsideredLogins: string[] = [];

    for (let i = 0; i < loginNames.length; i += BATCH_SIZE) {
      const batch = loginNames.slice(i, i + BATCH_SIZE);
      const persons = await this.personsRepository.find({
        where: {
          workspace_id: workspaceId,
          login: In(batch),
          consider: false
        },
        select: ['login']
      });
      notConsideredLogins.push(...persons.map(p => p.login));
    }
    return notConsideredLogins;
  }

  private async preloadBookletToUnits(workspaceId: number): Promise<Map<string, string[]>> {
    const bookletMap = new Map<string, string[]>();
    const BATCH_SIZE = 100;
    let offset = 0;

    let booklets = await this.fileUploadRepository.find({
      where: { workspace_id: workspaceId, file_type: 'Booklet' },
      select: ['file_id', 'data'],
      skip: offset,
      take: BATCH_SIZE
    });

    while (booklets.length > 0) {
      for (const booklet of booklets) {
        try {
          const $ = cheerio.load(booklet.data, { xmlMode: true });
          const unitIds: string[] = [];
          $('Unit').each((_, element) => {
            const unitId = $(element).attr('id');
            if (unitId) unitIds.push(unitId.toUpperCase());
          });
          bookletMap.set(booklet.file_id.toUpperCase(), unitIds);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          this.logger.warn(`Failed to parse booklet ${booklet.file_id}: ${message}`);
        }
      }
      offset += BATCH_SIZE;
      booklets = await this.fileUploadRepository.find({
        where: { workspace_id: workspaceId, file_type: 'Booklet' },
        select: ['file_id', 'data'],
        skip: offset,
        take: BATCH_SIZE
      });
    }
    return bookletMap;
  }

  private async preloadUnitRefs(workspaceId: number): Promise<Map<string, UnitRefs>> {
    const unitMap = new Map<string, UnitRefs>();
    const BATCH_SIZE = 200;
    let offset = 0;

    let units = await this.fileUploadRepository.find({
      where: { workspace_id: workspaceId, file_type: 'Unit' },
      select: ['file_id', 'data'],
      skip: offset,
      take: BATCH_SIZE
    });

    while (units.length > 0) {
      for (const unit of units) {
        try {
          const $ = cheerio.load(unit.data, { xmlMode: true });
          const refs: UnitRefs = {
            codingSchemeRefs: [],
            definitionRefs: [],
            playerRefs: [],
            hasPlayer: false
          };

          $('Unit').each((_, element) => {
            const codingSchemeRef = $(element).find('CodingSchemeRef').text();
            const definitionRef = $(element).find('DefinitionRef').text();
            const playerRefAttr = $(element).find('DefinitionRef').attr('player');
            const playerRef = playerRefAttr ? playerRefAttr.replace('@', '-') : '';

            if (codingSchemeRef) refs.codingSchemeRefs.push(codingSchemeRef.toUpperCase());
            if (definitionRef) refs.definitionRefs.push(definitionRef.toUpperCase());
            if (playerRef) {
              refs.playerRefs.push(playerRef.toUpperCase());
              refs.hasPlayer = true;
            }
          });
          unitMap.set(unit.file_id.toUpperCase(), refs);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          this.logger.warn(`Failed to parse unit ${unit.file_id}: ${message}`);
        }
      }
      offset += BATCH_SIZE;
      units = await this.fileUploadRepository.find({
        where: { workspace_id: workspaceId, file_type: 'Unit' },
        select: ['file_id', 'data'],
        skip: offset,
        take: BATCH_SIZE
      });
    }
    return unitMap;
  }

  private async getAllResourceIds(workspaceId: number): Promise<Set<string>> {
    const resourceIds = new Set<string>();
    const BATCH_SIZE = 5000;
    let offset = 0;

    let files = await this.fileUploadRepository
      .createQueryBuilder('file')
      .select(['file.file_id', 'file.filename'])
      .where('file.workspace_id = :workspaceId', { workspaceId })
      .skip(offset)
      .take(BATCH_SIZE)
      .getRawMany();

    while (files.length > 0) {
      files.forEach(f => {
        if (f) {
          const id = f.file_id || f.file_file_id;
          const name = f.filename || f.file_filename;

          if (id) resourceIds.add(id.trim().toUpperCase());
          if (name) resourceIds.add(name.trim().toUpperCase());
        }
      });
      offset += BATCH_SIZE;
      files = await this.fileUploadRepository
        .createQueryBuilder('file')
        .select(['file.file_id', 'file.filename'])
        .where('file.workspace_id = :workspaceId', { workspaceId })
        .skip(offset)
        .take(BATCH_SIZE)
        .getRawMany();
    }
    this.logger.log(`Preloaded ${resourceIds.size} unique resource IDs/filenames for workspace ${workspaceId}`);
    return resourceIds;
  }

  private resourceExists(ref: string, resourceIds: Set<string>): boolean {
    const normalizedRef = ref.replace(/\\/g, '/');

    if (resourceIds.has(normalizedRef)) return true;

    if (resourceIds.has(`${normalizedRef}.VOCS`)) return true;
    if (resourceIds.has(`${normalizedRef}.XML`)) return true;
    if (resourceIds.has(`${normalizedRef}.HTML`)) return true;
    if (resourceIds.has(`${normalizedRef}.JSON`)) return true;

    const lastDotIndex = normalizedRef.lastIndexOf('.');
    if (lastDotIndex > 0) {
      const refWithoutExt = normalizedRef.substring(0, lastDotIndex);
      if (resourceIds.has(refWithoutExt)) return true;
    }

    if (normalizedRef.includes('/')) {
      const basename = normalizedRef.split('/').pop();
      if (basename) {
        if (resourceIds.has(basename)) return true;

        if (resourceIds.has(`${basename}.VOCS`)) return true;
        if (resourceIds.has(`${basename}.XML`)) return true;
        if (resourceIds.has(`${basename}.HTML`)) return true;
        if (resourceIds.has(`${basename}.JSON`)) return true;

        const basenameLastDot = basename.lastIndexOf('.');
        if (basenameLastDot > 0) {
          const basenameNoExt = basename.substring(0, basenameLastDot);
          if (resourceIds.has(basenameNoExt)) return true;
        }
      }
    }

    return false;
  }

  private static playerRefExists(ref: string, allResourceIds: string[]): boolean {
    if (allResourceIds.includes(ref)) {
      return true;
    }

    const normalizedRef = (ref || '').trim().toUpperCase().replace(/\\/g, '/');
    if (!normalizedRef) {
      return false;
    }

    if (allResourceIds.includes(normalizedRef)) {
      return true;
    }

    const reg = /^(\D+?)[@V-]?(\d+)\.(\d+)(?:\.(\d+))?(?:-\S+?)?(?:\.(\D{3,4}))?$/;
    const match = normalizedRef.match(reg);

    if (!match) {
      return false;
    }

    const module = match[1];
    const major = match[2];
    const minor = match[3];
    const patch = match[4];

    if (patch) {
      return false;
    }

    const prefix = `${module}-${major}.${minor}.`;
    return allResourceIds.some(id => id && typeof id === 'string' && id.toUpperCase().startsWith(prefix));
  }

  private processTestTakerWithCache(
    testTaker: FileUpload,
    bookletMap: Map<string, string[]>,
    unitMap: Map<string, UnitRefs>,
    resourceIds: Set<string>,
    resourceIdsArray: string[],
    xmlSchemaResults: Map<string, { schemaValid: boolean; errors: string[] }>,
    codingSchemeResults: Map<string, { schemaValid: boolean; errors: string[] }>
  ): ValidationData | null {
    const xmlDocument = cheerio.load(testTaker.data, { xml: true });
    const bookletTags = xmlDocument('Booklet');

    if (bookletTags.length === 0) return null;

    const uniqueBooklets = new Set<string>();
    bookletTags.each((_, booklet) => {
      const bId = cheerio.load(booklet).text().trim().toUpperCase();
      if (bId) uniqueBooklets.add(bId);
    });

    const missingBooklets: string[] = [];
    const bookletFiles: FileStatus[] = [];
    const uniqueUnits = new Set<string>();
    const missingUnitsPerBooklet: { booklet: string; missingUnits: string[] }[] = [];

    for (const bookletId of uniqueBooklets) {
      const exists = bookletMap.has(bookletId);
      const schemaKey = `Booklet:${bookletId}`;
      const schemaInfo = xmlSchemaResults.get(schemaKey);
      const bookletStatus: FileStatus = { filename: bookletId, exists };
      if (schemaInfo) {
        bookletStatus.schemaValid = schemaInfo.schemaValid;
        if (!schemaInfo.schemaValid) {
          bookletStatus.schemaErrors = schemaInfo.errors;
        }
      }
      bookletFiles.push(bookletStatus);
      if (!exists) {
        missingBooklets.push(bookletId);
      } else {
        const units = bookletMap.get(bookletId) || [];
        units.forEach(u => uniqueUnits.add(u));

        const missingUnitsInBooklet = units.filter(u => !unitMap.has(u));
        if (missingUnitsInBooklet.length > 0) {
          missingUnitsPerBooklet.push({
            booklet: bookletId,
            missingUnits: missingUnitsInBooklet
          });
        }
      }
    }

    const missingUnits: string[] = [];
    const unitFiles: FileStatus[] = [];
    const unitsWithoutPlayer: string[] = [];

    const allCodingSchemeRefs = new Set<string>();
    const allDefinitionRefs = new Set<string>();
    const allPlayerRefs = new Set<string>();

    for (const unitId of uniqueUnits) {
      const exists = unitMap.has(unitId);
      const schemaKey = `Unit:${unitId}`;
      const schemaInfo = xmlSchemaResults.get(schemaKey);
      const status: FileStatus = { filename: unitId, exists };
      if (schemaInfo) {
        status.schemaValid = schemaInfo.schemaValid;
        if (!schemaInfo.schemaValid) {
          status.schemaErrors = schemaInfo.errors;
        }
      }
      unitFiles.push(status);

      if (!exists) {
        missingUnits.push(unitId);
      } else {
        const refs = unitMap.get(unitId);
        if (refs && !refs.hasPlayer) unitsWithoutPlayer.push(unitId);

        refs?.codingSchemeRefs.forEach(r => allCodingSchemeRefs.add(r));
        refs?.definitionRefs.forEach(r => allDefinitionRefs.add(r));
        refs?.playerRefs.forEach(r => allPlayerRefs.add(r));
      }
    }

    const missingCodingSchemeRefs = Array.from(allCodingSchemeRefs).filter(r => !this.resourceExists(r, resourceIds));
    const missingDefinitionRefs = Array.from(allDefinitionRefs).filter(r => !this.resourceExists(r, resourceIds));
    const missingPlayerRefs = Array.from(allPlayerRefs).filter(r => {
      if (this.resourceExists(r, resourceIds)) return false;
      return !WorkspaceTestFilesValidationService.playerRefExists(r, resourceIdsArray);
    });

    const allBookletsExist = missingBooklets.length === 0;
    const allUnitsExist = missingUnits.length === 0;

    const unitComplete = allBookletsExist && allUnitsExist;

    const schemeFiles: FileStatus[] = Array.from(allCodingSchemeRefs).map(r => {
      const filename = r;
      const exists = this.resourceExists(r, resourceIds);
      const status: FileStatus = { filename, exists };

      const key = r.toUpperCase();
      const schemaInfo = codingSchemeResults.get(key);
      if (schemaInfo) {
        status.schemaValid = schemaInfo.schemaValid;
        if (!schemaInfo.schemaValid) {
          status.schemaErrors = schemaInfo.errors;
        }
      }
      return status;
    });

    return {
      testTaker: testTaker.file_id,
      booklets: {
        complete: missingBooklets.length === 0,
        missing: missingBooklets,
        files: bookletFiles
      },
      units: {
        complete: unitComplete ? missingUnits.length === 0 : false,
        missing: missingUnits,
        missingUnitsPerBooklet,
        unitsWithoutPlayer,
        files: unitFiles
      },
      schemes: {
        complete: unitComplete ? missingCodingSchemeRefs.length === 0 : false,
        missing: missingCodingSchemeRefs,
        files: schemeFiles
      },
      definitions: {
        complete: unitComplete ? missingDefinitionRefs.length === 0 : false,
        missing: missingDefinitionRefs,
        files: Array.from(allDefinitionRefs).map(r => ({ filename: r, exists: this.resourceExists(r, resourceIds) }))
      },
      player: {
        complete: unitComplete ? missingPlayerRefs.length === 0 : false,
        missing: missingPlayerRefs,
        files: Array.from(allPlayerRefs).map(r => ({
          filename: r,
          exists: this.resourceExists(r, resourceIds) || WorkspaceTestFilesValidationService.playerRefExists(r, resourceIdsArray)
        }))
      }
    };
  }

  private createEmptyValidationData(): ValidationData[] {
    return [{
      testTaker: '',
      booklets: {
        complete: false,
        missing: [],
        files: []
      },
      units: {
        complete: false,
        missing: [],
        missingUnitsPerBooklet: [],
        unitsWithoutPlayer: [],
        files: []
      },
      schemes: { complete: false, missing: [], files: [] },
      definitions: { complete: false, missing: [], files: [] },
      player: { complete: false, missing: [], files: [] }
    }];
  }

  private getCodingSchemeValidator(): ValidateFunction {
    if (!this.codingSchemeValidator) {
      const ajv = new Ajv({ allErrors: true, strict: false });
      addFormats(ajv);
      this.codingSchemeValidator = ajv.compile(codingSchemeSchema as unknown as Record<string, unknown>);
    }
    return this.codingSchemeValidator;
  }

  private async validateAllCodingSchemes(
    workspaceId: number
  ): Promise<Map<string, { schemaValid: boolean; errors: string[] }>> {
    const results = new Map<string, { schemaValid: boolean; errors: string[] }>();

    const schemerFiles = await this.fileUploadRepository.find({
      where: { workspace_id: workspaceId, file_type: 'Schemer' },
      select: ['file_id', 'filename', 'data']
    });

    if (schemerFiles.length === 0) {
      return results;
    }

    const validator = this.getCodingSchemeValidator();

    for (const file of schemerFiles) {
      const key = (file.file_id || file.filename || '').toUpperCase();

      try {
        const html = file.data;
        const $ = cheerio.load(html);
        const metaDataElement = $('script[type="application/ld+json"]');

        if (!metaDataElement.length) {
          results.set(key, {
            schemaValid: false,
            errors: ['No <script type="application/ld+json"> block found in HTML']
          });
          continue;
        }

        let metadata: unknown;
        try {
          metadata = JSON.parse(metaDataElement.text());
        } catch (parseError) {
          const message = parseError instanceof Error ? parseError.message : 'Unknown JSON parse error';
          results.set(key, {
            schemaValid: false,
            errors: [`Invalid JSON in ld+json: ${message}`]
          });
          continue;
        }

        const valid = validator(metadata);
        if (!valid) {
          const errors = (validator.errors || []).map(e => `${e.instancePath} ${e.message}`);
          results.set(key, { schemaValid: false, errors });
          const maxErrors = 10;
          this.logger.warn(
            `JSON schema validation failed: Schemer:${key} (errors: ${errors.length}) ${JSON.stringify(errors.slice(0, maxErrors))}`
          );
        } else {
          results.set(key, { schemaValid: true, errors: [] });
          this.logger.debug(`JSON schema validation ok: Schemer:${key}`);
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Unknown coding scheme validation error';
        results.set(key, { schemaValid: false, errors: [message] });
        this.logger.error(
          `JSON schema validation error: Schemer:${key}: ${message}`,
          e instanceof Error ? e.stack : undefined
        );
      }
    }

    return results;
  }
}
