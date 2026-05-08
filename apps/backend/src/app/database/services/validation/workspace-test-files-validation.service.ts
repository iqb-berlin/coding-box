import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as cheerio from 'cheerio';
import * as crypto from 'crypto';
import Ajv, { ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';

import FileUpload from '../../entities/file_upload.entity';
import Persons from '../../entities/persons.entity';

import {
  FileValidationResultDto,
  FilteredTestTaker,
  GeoGebraValidationResult
} from '../../../../../../../api-dto/files/file-validation-result.dto';
import { WorkspaceXmlSchemaValidationService } from '../workspace/workspace-xml-schema-validation.service';
// eslint-disable-next-line import/no-cycle
import { WorkspaceCoreService } from '../workspace/workspace-core.service';
import {
  normalizeExclusionBookletId,
  normalizeExclusionUnitId,
  WorkspaceExclusionService
} from '../workspace/workspace-exclusion.service';
import { ResourcePackageService } from '../workspace/resource-package.service';
import { WorkspaceSettingsDto } from '../../../../../../../api-dto/workspaces/workspace-settings-dto';
import codingSchemeSchema = require('../../../schemas/coding-scheme.schema.json');

type FileStatus = {
  filename: string;
  exists: boolean;
  schemaValid?: boolean;
  schemaErrors?: string[];
  ignored?: boolean;
  parents?: string[];
};

type TestletDto = {
  id: string;
  bookletId?: string;
  label?: string;
  ignored?: boolean;
};

type DataValidation = {
  complete: boolean;
  missing: string[];
  missingUnitsPerBooklet?: { booklet: string; missingUnits: string[] }[];
  unitsWithoutPlayer?: string[];
  missingRefsPerUnit?: { unit: string; missingRefs: string[] }[];
  files: FileStatus[];
  testlets?: TestletDto[];
};

type UnitRefs = {
  schemerRefs: string[];
  codingSchemeRefs: string[];
  definitionRefs: string[];
  playerRefs: string[];
  metadataRefs: string[];
  hasPlayer: boolean;
  hasGeoGebraVariable: boolean;
};

type ValidationData = {
  testTaker: string;
  testTakerSchemaValid?: boolean;
  testTakerSchemaErrors?: string[];
  booklets: DataValidation;
  units: DataValidation;
  schemes: DataValidation;
  schemer: DataValidation;
  definitions: DataValidation;
  player: DataValidation;
  metadata: DataValidation;
};

type ValidationProgressReporter = (
  progress: number,
  message?: string
) => void | Promise<void>;

const TEST_FILES_VALIDATION_CACHE_VERSION = 2;

@Injectable()
export class WorkspaceTestFilesValidationService {
  private readonly logger = new Logger(
    WorkspaceTestFilesValidationService.name
  );

  private codingSchemeValidator: ValidateFunction | null = null;

  constructor(
    @InjectRepository(FileUpload)
    private fileUploadRepository: Repository<FileUpload>,
    @InjectRepository(Persons)
    private personsRepository: Repository<Persons>,
    private workspaceXmlSchemaValidationService: WorkspaceXmlSchemaValidationService,
    private workspaceCoreService: WorkspaceCoreService,
    private workspaceExclusionService: WorkspaceExclusionService,
    private resourcePackageService: ResourcePackageService
  ) {}

  private createExclusionFingerprint(
    exclusions: WorkspaceSettingsDto | null | undefined
  ): {
      ignoredUnits: string[];
      ignoredBooklets: string[];
      ignoredTestlets: { bookletId: string; testletId: string }[];
    } {
    const uniqueSorted = (
      values: string[] | undefined,
      normalize: (value: string | null | undefined) => string
    ): string[] => Array.from(new Set(
      (values || [])
        .map(value => normalize(value))
        .filter(Boolean)
    )).sort();

    const ignoredTestletsByKey = new Map<
    string,
    { bookletId: string; testletId: string }
    >();
    (exclusions?.ignoredTestlets || []).forEach(testlet => {
      const bookletId = normalizeExclusionBookletId(testlet.bookletId);
      const testletId = normalizeExclusionBookletId(testlet.testletId);
      if (bookletId && testletId) {
        ignoredTestletsByKey.set(`${bookletId}|${testletId}`, {
          bookletId,
          testletId
        });
      }
    });

    return {
      ignoredUnits: uniqueSorted(
        exclusions?.ignoredUnits,
        normalizeExclusionUnitId
      ),
      ignoredBooklets: uniqueSorted(
        exclusions?.ignoredBooklets,
        normalizeExclusionBookletId
      ),
      ignoredTestlets: Array.from(ignoredTestletsByKey.values())
        .sort((a, b) => {
          const bookletCompare = a.bookletId.localeCompare(b.bookletId);
          if (bookletCompare !== 0) return bookletCompare;
          return a.testletId.localeCompare(b.testletId);
        })
    };
  }

  private createPersonsFingerprint(
    persons: Pick<Persons, 'login' | 'consider'>[]
  ): { login: string; considerValues: boolean[] }[] {
    const considerValuesByLogin = new Map<string, Set<boolean>>();

    persons.forEach(person => {
      const login = String(person.login || '').trim();
      if (!login) {
        return;
      }
      const values = considerValuesByLogin.get(login) || new Set<boolean>();
      values.add(Boolean(person.consider));
      considerValuesByLogin.set(login, values);
    });

    return Array.from(considerValuesByLogin.entries())
      .map(([login, considerValues]) => ({
        login,
        considerValues: Array.from(considerValues).sort((a, b) => {
          if (a === b) return 0;
          return a ? 1 : -1;
        })
      }))
      .sort((a, b) => a.login.localeCompare(b.login));
  }

  async getTestFilesFingerprint(workspaceId: number): Promise<string> {
    const [files, exclusions, persons] = await Promise.all([
      this.fileUploadRepository.find({
        where: { workspace_id: workspaceId },
        select: [
          'id',
          'file_id',
          'filename',
          'file_type',
          'file_size',
          'created_at',
          'data'
        ]
      }),
      this.workspaceExclusionService.getExclusions(workspaceId),
      this.personsRepository.find({
        where: { workspace_id: workspaceId },
        select: ['login', 'consider']
      })
    ]);

    const hash = crypto.createHash('sha256');
    hash.update(JSON.stringify({
      cacheVersion: TEST_FILES_VALIDATION_CACHE_VERSION,
      exclusions: this.createExclusionFingerprint(exclusions),
      persons: this.createPersonsFingerprint(persons)
    }));
    hash.update('\n');

    files
      .sort((a, b) => {
        const typeCompare = (a.file_type || '').localeCompare(b.file_type || '');
        if (typeCompare !== 0) return typeCompare;
        return (a.file_id || a.filename || '').localeCompare(
          b.file_id || b.filename || ''
        );
      })
      .forEach(file => {
        const dataHash = crypto
          .createHash('sha256')
          .update(file.data || '')
          .digest('hex');
        hash.update(
          JSON.stringify({
            id: file.id,
            fileId: file.file_id,
            filename: file.filename,
            fileType: file.file_type,
            fileSize: file.file_size,
            createdAt: file.created_at,
            dataHash
          })
        );
        hash.update('\n');
      });

    return hash.digest('hex');
  }

  async refreshGeoGebraPackageStatus(
    workspaceId: number,
    result: unknown
  ): Promise<unknown> {
    if (!result || typeof result !== 'object') {
      return result;
    }

    const validationResult = result as FileValidationResultDto;
    if (!validationResult.geogebra) {
      return result;
    }

    return {
      ...validationResult,
      geogebra: {
        ...validationResult.geogebra,
        packageStatus:
          await this.resourcePackageService.getGeoGebraPackageStatus(
            workspaceId
          )
      }
    };
  }

  async validateTestFiles(
    workspaceId: number,
    onProgress?: ValidationProgressReporter
  ): Promise<FileValidationResultDto> {
    try {
      this.logger.log(
        `Starting batched test file validation for workspace ${workspaceId}`
      );

      await this.reportProgress(
        onProgress,
        3,
        'Testdatei-Validierung wird vorbereitet...'
      );

      const exclusions =
        await this.workspaceExclusionService.getExclusions(workspaceId);

      await this.reportProgress(onProgress, 8, 'Ausschlüsse wurden geladen.');

      await this.reportProgress(
        onProgress,
        12,
        'Booklets und Testlets werden analysiert...'
      );
      const bookletMap = await this.preloadBookletToUnits(
        workspaceId,
        exclusions
      );

      await this.reportProgress(
        onProgress,
        22,
        'Aufgabenreferenzen werden analysiert...'
      );
      const unitMap = await this.preloadUnitRefs(workspaceId);

      await this.reportProgress(
        onProgress,
        30,
        'Ressourcenreferenzen werden geladen...'
      );
      const resourceIds = await this.getAllResourceIds(workspaceId);

      await this.reportProgress(
        onProgress,
        38,
        'XML-Schemata werden validiert...'
      );
      const xmlSchemaResults =
        await this.workspaceXmlSchemaValidationService.validateAllXmlSchemas(
          workspaceId
        );

      await this.reportProgress(
        onProgress,
        48,
        'Kodierschemata werden validiert...'
      );
      const codingSchemeResults = await this.validateAllCodingSchemes(
        workspaceId
      );

      await this.reportProgress(
        onProgress,
        55,
        'Validierungsdaten wurden vorbereitet.'
      );

      const summarizeSchemaResults = (
        label: string,
        results: Map<string, { schemaValid: boolean; errors: string[] }>
      ): void => {
        const entries = Array.from(results.entries());
        const ok = entries.filter(([, r]) => r.schemaValid).length;
        const failed = entries.length - ok;
        this.logger.log(
          `${label} validation results for workspace ${workspaceId}: total=${entries.length}, ok=${ok}, failed=${failed}`
        );
        if (failed > 0) {
          const maxFailedToLog = 20;
          const failedPreview = entries
            .filter(([, r]) => !r.schemaValid)
            .slice(0, maxFailedToLog)
            .map(([key, r]) => ({
              key,
              errors: (r.errors || []).slice(0, 5)
            }));
          this.logger.warn(
            `${label} validation failed for workspace ${workspaceId}: ${JSON.stringify(failedPreview)}`
          );
          if (failed > maxFailedToLog) {
            this.logger.warn(
              `${label} validation: ${failed - maxFailedToLog} more failed file(s) not logged (preview limit reached).`
            );
          }
        }
      };

      summarizeSchemaResults('XSD schema', xmlSchemaResults);
      summarizeSchemaResults(
        'JSON schema (coding scheme)',
        codingSchemeResults
      );
      const resourceIdsArray = Array.from(resourceIds);

      const validationResults: ValidationData[] = [];

      const usedTestTakerFileIds = new Set<string>();

      let filteredTestTakers: FilteredTestTaker[] = [];
      const loginOccurrences = new Map<
      string,
      { testTaker: string; mode: string }[]
      >();
      const modesNotToFilter = [
        'run-hot-return',
        'run-hot-restart',
        'run-trial'
      ];
      const shouldFilterMode = (loginMode: string) => !modesNotToFilter.includes(loginMode);

      const BATCH_SIZE = 20;
      let offset = 0;
      let processedTestTakers = 0;
      let hasTestTakers = false;

      let testTakersBatch = await this.fileUploadRepository.find({
        where: {
          workspace_id: workspaceId,
          file_type: In(['TestTakers', 'Testtakers'])
        },
        skip: offset,
        take: BATCH_SIZE
      });

      const totalTestTakers = await this.fileUploadRepository.count({
        where: {
          workspace_id: workspaceId,
          file_type: In(['TestTakers', 'Testtakers'])
        }
      });

      while (testTakersBatch.length > 0) {
        hasTestTakers = true;

        for (const testTaker of testTakersBatch) {
          processedTestTakers += 1;
          await this.reportProgress(
            onProgress,
            55 + Math.floor((processedTestTakers / totalTestTakers) * 25),
            `TestTakers werden verarbeitet (${processedTestTakers}/${totalTestTakers})...`
          );
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
            codingSchemeResults,
            exclusions
          );
          if (validationResult) {
            validationResults.push(validationResult);
          }
        }

        offset += BATCH_SIZE;
        testTakersBatch = await this.fileUploadRepository.find({
          where: {
            workspace_id: workspaceId,
            file_type: In(['TestTakers', 'Testtakers'])
          },
          skip: offset,
          take: BATCH_SIZE
        });
      }

      if (!hasTestTakers) {
        this.logger.warn(
          `No TestTakers found in workspace with ID ${workspaceId}.`
        );
        await this.reportProgress(
          onProgress,
          100,
          'Keine TestTakers-Dateien gefunden.'
        );
        return {
          testTakersFound: false,
          geogebra: await this.createGeoGebraValidationResult(
            workspaceId,
            []
          ),
          validationResults: this.createEmptyValidationData()
        };
      }

      await this.reportProgress(
        onProgress,
        84,
        'Nicht verwendete Dateien werden ermittelt...'
      );
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

      this.logger.log(
        `Found ${duplicateTestTakers.length} duplicate test takers across files`
      );

      await this.reportProgress(
        onProgress,
        88,
        'Doppelte TestTaker wurden geprüft.'
      );

      if (filteredTestTakers.length > 0) {
        await this.reportProgress(
          onProgress,
          90,
          'Personenstatus für gefilterte TestTaker wird geladen...'
        );
        const uniqueLogins = Array.from(
          new Set(filteredTestTakers.map(item => item.login))
        );
        const considerByLogin = await this.getPersonsConsiderStatus(
          workspaceId,
          uniqueLogins
        );
        filteredTestTakers = filteredTestTakers
          .filter(item => considerByLogin.has(item.login))
          .map(item => ({
            ...item,
            consider: considerByLogin.get(item.login)!
          }));
      }

      const geogebra = await this.detectGeoGebraUsage(
        workspaceId,
        validationResults,
        unitMap,
        onProgress
      );

      await this.reportProgress(
        onProgress,
        98,
        'Validierungsergebnis wird vorbereitet...'
      );

      if (validationResults.length > 0) {
        return {
          testTakersFound: true,
          filteredTestTakers:
            filteredTestTakers.length > 0 ? filteredTestTakers : undefined,
          duplicateTestTakers:
            duplicateTestTakers.length > 0 ? duplicateTestTakers : undefined,
          unusedTestFiles:
            unusedTestFiles.length > 0 ? unusedTestFiles : undefined,
          geogebra,
          validationResults
        };
      }

      return {
        testTakersFound: true,
        filteredTestTakers:
          filteredTestTakers.length > 0 ? filteredTestTakers : undefined,
        duplicateTestTakers:
          duplicateTestTakers.length > 0 ? duplicateTestTakers : undefined,
        unusedTestFiles:
          unusedTestFiles.length > 0 ? unusedTestFiles : undefined,
        geogebra,
        validationResults: this.createEmptyValidationData()
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Error during test file validation for workspace ID ${workspaceId}: ${message}`,
        error instanceof Error ? error.stack : undefined
      );
      throw new Error(
        `Error during test file validation for workspace ID ${workspaceId}: ${message}`
      );
    }
  }

  private async getUnusedTestFilesFromValidationGraph(
    workspaceId: number,
    validationResults: ValidationData[],
    usedTestTakerFileIds: Set<string>,
    allResourceIds: string[]
  ): Promise<
    Array<{ id: number; fileId: string; filename: string; fileType: string }>
    > {
    const usedTokens = new Set<string>();

    const addPlayerPatchTokens = (token: string | undefined | null): void => {
      if (!token) {
        return;
      }
      const normalizedToken = token.trim().toUpperCase().replace(/\\/g, '/');
      if (!normalizedToken) {
        return;
      }

      const reg =
        /^(\D+?)[@V-]?(\d+)\.(\d+)(?:\.(\d+))?(?:-\S+?)?(?:\.(\D{3,4}))?$/;
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
        if (
          id &&
          typeof id === 'string' &&
          id.toUpperCase().startsWith(prefix)
        ) {
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
      result.schemer.files.forEach(f => {
        addToken(f.filename);
        addPlayerPatchTokens(f.filename);
      });
      result.definitions.files.forEach(f => addToken(f.filename));
      result.player.files.forEach(f => {
        addToken(f.filename);
        addPlayerPatchTokens(f.filename);
      });
      result.metadata.files.forEach(f => addToken(f.filename));
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

  private async getPersonsNotConsidered(
    workspaceId: number,
    loginNames: string[]
  ): Promise<string[]> {
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

  private async getPersonsConsiderStatus(
    workspaceId: number,
    loginNames: string[]
  ): Promise<Map<string, boolean>> {
    const BATCH_SIZE = 500;
    const considerByLogin = new Map<string, boolean>();

    for (let i = 0; i < loginNames.length; i += BATCH_SIZE) {
      const batch = loginNames.slice(i, i + BATCH_SIZE);
      const persons = await this.personsRepository.find({
        where: {
          workspace_id: workspaceId,
          login: In(batch)
        },
        select: ['login', 'consider']
      });

      persons.forEach(p => {
        considerByLogin.set(p.login, p.consider);
      });
    }

    return considerByLogin;
  }

  private async reportProgress(
    onProgress: ValidationProgressReporter | undefined,
    progress: number,
    message?: string
  ): Promise<void> {
    if (!onProgress) {
      return;
    }
    await onProgress(progress, message);
  }

  private async preloadBookletToUnits(
    workspaceId: number,
    exclusions: WorkspaceSettingsDto
  ): Promise<Map<string, { unitIds: string[]; testlets: TestletDto[] }>> {
    const bookletMap = new Map<
    string,
    { unitIds: string[]; testlets: TestletDto[] }
    >();
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
          const bookletId = booklet.file_id.toUpperCase();

          if (
            this.workspaceExclusionService.isExcluded({ bookletId }, exclusions)
          ) {
            bookletMap.set(bookletId, { unitIds: [], testlets: [] });
            continue;
          }

          const testlets: TestletDto[] = [];
          $('Testlet, testlet').each((_, element) => {
            const id = $(element).attr('id');
            const label = $(element).attr('label');
            if (id) {
              testlets.push({
                id,
                bookletId,
                label,
                ignored: this.workspaceExclusionService.isExcluded(
                  { bookletId, testletId: id },
                  exclusions
                )
              });
            }
          });

          const unitIds: string[] = [];
          $('Unit, unit').each((_, element) => {
            const unitId = $(element).attr('id');
            if (unitId) {
              let ignoredByTestlet = false;
              let current = $(element).parent();
              while (
                current.length &&
                current[0].tagName?.toLowerCase() === 'testlet'
              ) {
                const testletId = current.attr('id');
                if (
                  testletId &&
                  this.workspaceExclusionService.isExcluded(
                    { bookletId, testletId },
                    exclusions
                  )
                ) {
                  ignoredByTestlet = true;
                  break;
                }
                current = current.parent();
              }
              if (!ignoredByTestlet) {
                unitIds.push(unitId.toUpperCase());
              }
            }
          });
          bookletMap.set(bookletId, { unitIds, testlets });
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          this.logger.warn(
            `Failed to parse booklet ${booklet.file_id}: ${message}`
          );
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

  private async preloadUnitRefs(
    workspaceId: number
  ): Promise<Map<string, UnitRefs>> {
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
            schemerRefs: [],
            codingSchemeRefs: [],
            definitionRefs: [],
            playerRefs: [],
            metadataRefs: [],
            hasPlayer: false,
            hasGeoGebraVariable: false
          };

          $('Unit').each((_, element) => {
            const codingSchemeRef = $(element).find('CodingSchemeRef').text();
            const schemerRefAttr = $(element)
              .find('CodingSchemeRef')
              .attr('schemer');
            const definitionRef = $(element).find('DefinitionRef').text();
            const playerRefAttr = $(element)
              .find('DefinitionRef')
              .attr('player');
            const playerRef = playerRefAttr ?
              playerRefAttr.replace('@', '-') :
              '';

            const metadataRef = $(element).find('Metadata > Reference').text();

            const schemerRef = schemerRefAttr ?
              schemerRefAttr.replace('@', '-') :
              '';

            $(element)
              .find('BaseVariables Variable, DerivedVariables Variable')
              .each((__, variableElement) => {
                const variable = $(variableElement);
                const format = (variable.attr('format') || '').toLowerCase();
                const type = (variable.attr('type') || '').toLowerCase();
                if (format === 'ggb-file' || type === 'geometry') {
                  refs.hasGeoGebraVariable = true;
                }
              });

            if (unit.data.toLowerCase().includes('ggb-file')) {
              refs.hasGeoGebraVariable = true;
            }

            if (codingSchemeRef) refs.codingSchemeRefs.push(codingSchemeRef.toUpperCase());
            if (schemerRef) refs.schemerRefs.push(schemerRef.toUpperCase());
            if (definitionRef) refs.definitionRefs.push(definitionRef.toUpperCase());
            if (playerRef) {
              refs.playerRefs.push(playerRef.toUpperCase());
              refs.hasPlayer = true;
            }
            if (metadataRef) refs.metadataRefs.push(metadataRef.toUpperCase());
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
      .andWhere("file.file_type IN ('Resource', 'Schemer')")
      .skip(offset)
      .take(BATCH_SIZE)
      .getRawMany();

    while (files.length > 0) {
      files.forEach(f => {
        if (f) {
          const id = f.file_id || f.file_file_id;
          const name = f.filename || f.file_filename;

          if (id) {
            const decodedId = decodeURIComponent(id).trim().toUpperCase();
            resourceIds.add(decodedId);
            resourceIds.add(decodedId.replace('@', '-'));
          }
          if (name) {
            const decodedName = decodeURIComponent(name).trim().toUpperCase();
            resourceIds.add(decodedName);
            resourceIds.add(decodedName.replace('@', '-'));
          }
        }
      });
      offset += BATCH_SIZE;
      files = await this.fileUploadRepository
        .createQueryBuilder('file')
        .select(['file.file_id', 'file.filename'])
        .where('file.workspace_id = :workspaceId', { workspaceId })
        .andWhere("file.file_type IN ('Resource', 'Schemer')")
        .skip(offset)
        .take(BATCH_SIZE)
        .getRawMany();
    }
    this.logger.log(
      `Preloaded ${resourceIds.size} unique resource IDs/filenames for workspace ${workspaceId}`
    );
    return resourceIds;
  }

  private async detectGeoGebraUsage(
    workspaceId: number,
    validationResults: ValidationData[],
    unitMap: Map<string, UnitRefs>,
    onProgress?: ValidationProgressReporter
  ): Promise<GeoGebraValidationResult> {
    await this.reportProgress(
      onProgress,
      92,
      'GeoGebra-Aufgaben werden erkannt...'
    );

    const geogebraUnits = new Set<string>();
    const visibleUnitIds = new Set<string>();

    validationResults.forEach(result => {
      result.units.files.forEach(file => {
        if (file.exists && !file.ignored && file.filename) {
          visibleUnitIds.add(file.filename.toUpperCase());
        }
      });
    });

    visibleUnitIds.forEach(unitId => {
      const refs = unitMap.get(unitId);
      if (refs?.hasGeoGebraVariable) {
        geogebraUnits.add(unitId);
      }
    });

    const definitionRefsByUnit = new Map<string, string[]>();
    visibleUnitIds.forEach(unitId => {
      const refs = unitMap.get(unitId);
      if (refs?.definitionRefs.length) {
        definitionRefsByUnit.set(unitId, refs.definitionRefs);
      }
    });

    if (definitionRefsByUnit.size > 0) {
      const resourceFiles = await this.fileUploadRepository.find({
        where: {
          workspace_id: workspaceId,
          file_type: 'Resource'
        },
        select: ['file_id', 'filename', 'data']
      });

      definitionRefsByUnit.forEach((definitionRefs, unitId) => {
        const hasGeoGebraDefinition = definitionRefs.some(ref => {
          const resourceFile = resourceFiles.find(
            file => this.resourceFileMatchesRef(ref, file)
          );
          return resourceFile ?
            this.containsGeoGebraDefinition(resourceFile.data || '') :
            false;
        });

        if (hasGeoGebraDefinition) {
          geogebraUnits.add(unitId);
        }
      });
    }

    await this.reportProgress(
      onProgress,
      94,
      'GeoGebra-Ressourcenpaket wird geprüft...'
    );

    return this.createGeoGebraValidationResult(
      workspaceId,
      Array.from(geogebraUnits).sort()
    );
  }

  private async createGeoGebraValidationResult(
    workspaceId: number,
    units: string[]
  ): Promise<GeoGebraValidationResult> {
    const packageStatus =
      await this.resourcePackageService.getGeoGebraPackageStatus(workspaceId);

    return {
      hasTasks: units.length > 0,
      units,
      packageStatus
    };
  }

  private resourceFileMatchesRef(
    ref: string,
    file: Pick<FileUpload, 'file_id' | 'filename'>
  ): boolean {
    const refTokens = WorkspaceTestFilesValidationService.createResourceTokens(
      ref
    );
    const fileTokens = new Set([
      ...WorkspaceTestFilesValidationService.createResourceTokens(file.file_id),
      ...WorkspaceTestFilesValidationService.createResourceTokens(file.filename)
    ]);

    return refTokens.some(token => fileTokens.has(token));
  }

  private static createResourceTokens(value: string | undefined | null): string[] {
    if (!value) {
      return [];
    }

    let normalized = value.trim().replace(/\\/g, '/');
    try {
      normalized = decodeURIComponent(normalized);
    } catch {
      // Keep the original value if it is not URI encoded.
    }

    if (!normalized) {
      return [];
    }

    const tokens = new Set<string>();
    const add = (token: string) => {
      const upper = token.trim().toUpperCase();
      if (upper) {
        tokens.add(upper);
        tokens.add(upper.replace('@', '-'));
      }
    };

    add(normalized);
    ['.VOCS', '.XML', '.HTML', '.JSON', '.VOUD', '.VOMD'].forEach(ext => {
      add(`${normalized}${ext}`);
    });

    const lastDot = normalized.lastIndexOf('.');
    if (lastDot > 0) {
      add(normalized.substring(0, lastDot));
    }

    if (normalized.includes('/')) {
      const basename = normalized.split('/').pop();
      if (basename) {
        add(basename);
        const basenameLastDot = basename.lastIndexOf('.');
        if (basenameLastDot > 0) {
          add(basename.substring(0, basenameLastDot));
        }
      }
    }

    return Array.from(tokens);
  }

  private containsGeoGebraDefinition(data: string): boolean {
    if (!data) {
      return false;
    }

    const lower = data.toLowerCase();
    const compact = lower.replace(/\s/g, '');
    if (
      lower.includes('geogebra') ||
      lower.includes('"ggb-file"') ||
      lower.includes('"appdefinition"') ||
      compact.includes('"type":"geometry"')
    ) {
      return true;
    }

    try {
      return this.containsGeoGebraJsonValue(JSON.parse(data));
    } catch {
      return false;
    }
  }

  private containsGeoGebraJsonValue(value: unknown): boolean {
    if (!value) {
      return false;
    }

    if (typeof value === 'string') {
      const normalized = value.toLowerCase();
      return normalized.includes('geogebra') || normalized.includes('ggb-file');
    }

    if (Array.isArray(value)) {
      return value.some(item => this.containsGeoGebraJsonValue(item));
    }

    if (typeof value === 'object') {
      return Object.entries(value as Record<string, unknown>).some(
        ([key, child]) => {
          if (
            key === 'appDefinition' ||
            (key === 'type' && String(child).toLowerCase() === 'geometry') ||
            (key === 'format' && String(child).toLowerCase() === 'ggb-file')
          ) {
            return true;
          }
          return this.containsGeoGebraJsonValue(child);
        }
      );
    }

    return false;
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

  private static playerRefExists(
    ref: string,
    allResourceIds: string[]
  ): boolean {
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

    const reg =
      /^(\D+?)[@V-]?(\d+)\.(\d+)(?:\.(\d+))?(?:-\S+?)?(?:\.(\D{3,4}))?$/;
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
    return allResourceIds.some(
      id => id && typeof id === 'string' && id.toUpperCase().startsWith(prefix)
    );
  }

  private processTestTakerWithCache(
    testTaker: FileUpload,
    bookletMap: Map<string, { unitIds: string[]; testlets: TestletDto[] }>,
    unitMap: Map<string, UnitRefs>,
    resourceIds: Set<string>,
    resourceIdsArray: string[],
    xmlSchemaResults: Map<string, { schemaValid: boolean; errors: string[] }>,
    codingSchemeResults: Map<
    string,
    { schemaValid: boolean; errors: string[] }
    >,
    exclusions: WorkspaceSettingsDto
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
    const allTestlets: TestletDto[] = [];
    const unitToBookletsMap = new Map<string, Set<string>>();
    const missingUnitsPerBooklet: {
      booklet: string;
      missingUnits: string[];
    }[] = [];

    for (const bookletId of uniqueBooklets) {
      const exists = bookletMap.has(bookletId);
      const isBookletIgnored = this.workspaceExclusionService.isExcluded(
        { bookletId },
        exclusions
      );
      const schemaKey = `Booklet:${bookletId}`;
      const schemaInfo = xmlSchemaResults.get(schemaKey);
      const bookletStatus: FileStatus = { filename: bookletId, exists };
      if (isBookletIgnored) {
        bookletStatus.ignored = true;
      }
      if (schemaInfo) {
        bookletStatus.schemaValid = schemaInfo.schemaValid;
        if (!schemaInfo.schemaValid) {
          bookletStatus.schemaErrors = schemaInfo.errors;
        }
      }
      bookletFiles.push(bookletStatus);
      if (isBookletIgnored) {
        continue;
      }
      if (!exists) {
        missingBooklets.push(bookletId);
      } else {
        const data = bookletMap.get(bookletId);
        const units = data?.unitIds || [];
        (data?.testlets || []).forEach(t => {
          if (
            !allTestlets.some(
              existing => existing.bookletId === t.bookletId && existing.id === t.id
            )
          ) {
            allTestlets.push(t);
          }
        });

        units.forEach(u => {
          const booklets = unitToBookletsMap.get(u) || new Set<string>();
          booklets.add(bookletId);
          unitToBookletsMap.set(u, booklets);
        });

        const missingUnitsInBooklet = units.filter(u => !unitMap.has(u));
        if (missingUnitsInBooklet.length > 0) {
          missingUnitsPerBooklet.push({
            booklet: bookletId,
            missingUnits: missingUnitsInBooklet
          });
        }
      }
    }

    const uniqueUnits = Array.from(unitToBookletsMap.keys());
    const missingUnits: string[] = [];
    const unitFiles: FileStatus[] = [];
    const unitsWithoutPlayer: string[] = [];

    const missingCodingSchemeRefsByUnit: {
      unit: string;
      missingRefs: string[];
    }[] = [];
    const missingDefinitionRefsByUnit: {
      unit: string;
      missingRefs: string[];
    }[] = [];
    const missingPlayerRefsByUnit: { unit: string; missingRefs: string[] }[] =
      [];
    const missingMetadataRefsByUnit: { unit: string; missingRefs: string[] }[] =
      [];
    const missingSchemerRefsByUnit: { unit: string; missingRefs: string[] }[] =
      [];

    const allCodingSchemeRefs = new Set<string>();
    const allSchemerRefs = new Set<string>();
    const allDefinitionRefs = new Set<string>();
    const allPlayerRefs = new Set<string>();
    const allMetadataRefs = new Set<string>();

    for (const unitId of uniqueUnits) {
      const exists = unitMap.has(unitId);
      const isIgnored = this.workspaceExclusionService.isExcluded(
        { unitId },
        exclusions
      );
      const schemaKey = `Unit:${unitId}`;
      const schemaInfo = xmlSchemaResults.get(schemaKey);
      const status: FileStatus = {
        filename: unitId,
        exists,
        ignored: isIgnored,
        parents: Array.from(unitToBookletsMap.get(unitId) || [])
      };
      if (schemaInfo) {
        status.schemaValid = schemaInfo.schemaValid;
        if (!schemaInfo.schemaValid) {
          status.schemaErrors = schemaInfo.errors;
        }
      }
      unitFiles.push(status);

      if (isIgnored) {
        continue;
      }

      if (!exists) {
        missingUnits.push(unitId);
      } else {
        const refs = unitMap.get(unitId);
        if (refs && !refs.hasPlayer) unitsWithoutPlayer.push(unitId);

        refs?.codingSchemeRefs.forEach(r => allCodingSchemeRefs.add(r));
        refs?.schemerRefs.forEach(r => allSchemerRefs.add(r));
        refs?.definitionRefs.forEach(r => allDefinitionRefs.add(r));
        refs?.playerRefs.forEach(r => allPlayerRefs.add(r));
        refs?.metadataRefs.forEach(r => allMetadataRefs.add(r));

        const codingSchemeMissingForUnit = (
          refs?.codingSchemeRefs || []
        ).filter(r => !this.resourceExists(r, resourceIds));
        if (codingSchemeMissingForUnit.length > 0) {
          missingCodingSchemeRefsByUnit.push({
            unit: unitId,
            missingRefs: codingSchemeMissingForUnit
          });
        }

        const schemerMissingForUnit = (refs?.schemerRefs || []).filter(r => {
          if (this.resourceExists(r, resourceIds)) return false;
          if (
            WorkspaceTestFilesValidationService.playerRefExists(
              r,
              resourceIdsArray
            )
          ) return false;

          if (r.startsWith('IQB-SCHEMER-1.1')) {
            const hasFallback = resourceIdsArray.some(id => id.toUpperCase().startsWith('IQB-SCHEMER-')
            );
            if (hasFallback) return false;
          }
          return true;
        });
        if (schemerMissingForUnit.length > 0) {
          missingSchemerRefsByUnit.push({
            unit: unitId,
            missingRefs: schemerMissingForUnit
          });
        }

        const definitionMissingForUnit = (refs?.definitionRefs || []).filter(
          r => !this.resourceExists(r, resourceIds)
        );
        if (definitionMissingForUnit.length > 0) {
          missingDefinitionRefsByUnit.push({
            unit: unitId,
            missingRefs: definitionMissingForUnit
          });
        }

        const playerMissingForUnit = (refs?.playerRefs || []).filter(r => {
          if (this.resourceExists(r, resourceIds)) return false;
          return !WorkspaceTestFilesValidationService.playerRefExists(
            r,
            resourceIdsArray
          );
        });
        if (playerMissingForUnit.length > 0) {
          missingPlayerRefsByUnit.push({
            unit: unitId,
            missingRefs: playerMissingForUnit
          });
        }

        const metadataMissingForUnit = (refs?.metadataRefs || []).filter(
          r => !this.resourceExists(r, resourceIds)
        );
        if (metadataMissingForUnit.length > 0) {
          missingMetadataRefsByUnit.push({
            unit: unitId,
            missingRefs: metadataMissingForUnit
          });
        }
      }
    }

    const missingCodingSchemeRefs = Array.from(allCodingSchemeRefs).filter(
      r => !this.resourceExists(r, resourceIds)
    );
    const missingSchemerRefs = Array.from(allSchemerRefs).filter(r => {
      if (this.resourceExists(r, resourceIds)) return false;
      if (
        WorkspaceTestFilesValidationService.playerRefExists(r, resourceIdsArray)
      ) return false;

      if (r.startsWith('IQB-SCHEMER-1.1')) {
        const hasFallback = resourceIdsArray.some(id => id.toUpperCase().startsWith('IQB-SCHEMER-')
        );
        if (hasFallback) return false;
      }

      return true;
    });
    const missingDefinitionRefs = Array.from(allDefinitionRefs).filter(
      r => !this.resourceExists(r, resourceIds)
    );
    const missingPlayerRefs = Array.from(allPlayerRefs).filter(r => {
      if (this.resourceExists(r, resourceIds)) return false;
      return !WorkspaceTestFilesValidationService.playerRefExists(
        r,
        resourceIdsArray
      );
    });
    const missingMetadataRefs = Array.from(allMetadataRefs).filter(
      r => !this.resourceExists(r, resourceIds)
    );

    const allBookletsExist = missingBooklets.length === 0;
    const allUnitsExist = missingUnits.length === 0;

    const unitComplete = allBookletsExist && allUnitsExist;

    const schemeFiles: FileStatus[] = Array.from(allCodingSchemeRefs).map(
      r => {
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
      }
    );

    return {
      testTaker: testTaker.file_id,
      testTakerSchemaValid: (() => {
        const testTakerId = (
          testTaker.file_id ||
          testTaker.filename ||
          ''
        ).toUpperCase();
        const schemaKey = `${testTaker.file_type}:${testTakerId}`;
        const schemaInfo = xmlSchemaResults.get(schemaKey);
        return schemaInfo ? schemaInfo.schemaValid : undefined;
      })(),
      testTakerSchemaErrors: (() => {
        const testTakerId = (
          testTaker.file_id ||
          testTaker.filename ||
          ''
        ).toUpperCase();
        const schemaKey = `${testTaker.file_type}:${testTakerId}`;
        const schemaInfo = xmlSchemaResults.get(schemaKey);
        if (!schemaInfo || schemaInfo.schemaValid) {
          return undefined;
        }
        return schemaInfo.errors;
      })(),
      booklets: {
        complete: missingBooklets.length === 0,
        missing: missingBooklets,
        files: bookletFiles,
        testlets: allTestlets
      },
      units: {
        complete: unitComplete ? missingUnits.length === 0 : false,
        missing: missingUnits,
        missingUnitsPerBooklet,
        unitsWithoutPlayer,
        files: unitFiles
      },
      schemes: {
        complete: missingCodingSchemeRefs.length === 0,
        missing: missingCodingSchemeRefs,
        missingRefsPerUnit: missingCodingSchemeRefsByUnit,
        files: schemeFiles
      },
      schemer: {
        complete: missingSchemerRefs.length === 0,
        missing: missingSchemerRefs,
        missingRefsPerUnit: missingSchemerRefsByUnit,
        files: Array.from(allSchemerRefs).map(r => {
          let exists =
            this.resourceExists(r, resourceIds) ||
            WorkspaceTestFilesValidationService.playerRefExists(
              r,
              resourceIdsArray
            );
          let schemaValid: boolean | undefined;
          let schemaErrors: string[] | undefined;

          if (!exists && r.startsWith('IQB-SCHEMER-1.1')) {
            const hasFallback = resourceIdsArray.some(id => id.toUpperCase().startsWith('IQB-SCHEMER-')
            );
            if (hasFallback) {
              exists = true;
              schemaValid = false;
              schemaErrors = [
                'IQB-SCHEMER-1.1 ist veraltet. Es wird die neueste verfügbare Schemer-Version verwendet.'
              ];
            }
          }

          return {
            filename: r,
            exists,
            schemaValid,
            schemaErrors
          };
        })
      },
      definitions: {
        complete: missingDefinitionRefs.length === 0,
        missing: missingDefinitionRefs,
        missingRefsPerUnit: missingDefinitionRefsByUnit,
        files: Array.from(allDefinitionRefs).map(r => ({
          filename: r,
          exists: this.resourceExists(r, resourceIds)
        }))
      },
      player: {
        complete: missingPlayerRefs.length === 0,
        missing: missingPlayerRefs,
        missingRefsPerUnit: missingPlayerRefsByUnit,
        files: Array.from(allPlayerRefs).map(r => ({
          filename: r,
          exists:
            this.resourceExists(r, resourceIds) ||
            WorkspaceTestFilesValidationService.playerRefExists(
              r,
              resourceIdsArray
            )
        }))
      },
      metadata: {
        complete: missingMetadataRefs.length === 0,
        missing: missingMetadataRefs,
        missingRefsPerUnit: missingMetadataRefsByUnit,
        files: Array.from(allMetadataRefs).map(r => ({
          filename: r,
          exists: this.resourceExists(r, resourceIds)
        }))
      }
    };
  }

  private createEmptyValidationData(): ValidationData[] {
    return [
      {
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
        schemer: { complete: false, missing: [], files: [] },
        definitions: { complete: false, missing: [], files: [] },
        player: { complete: false, missing: [], files: [] },
        metadata: { complete: false, missing: [], files: [] }
      }
    ];
  }

  private getCodingSchemeValidator(): ValidateFunction {
    if (!this.codingSchemeValidator) {
      const ajv = new Ajv({ allErrors: true, strict: false });
      addFormats(ajv);
      this.codingSchemeValidator = ajv.compile(
        codingSchemeSchema as unknown as Record<string, unknown>
      );
    }
    return this.codingSchemeValidator;
  }

  private async validateAllCodingSchemes(
    workspaceId: number
  ): Promise<Map<string, { schemaValid: boolean; errors: string[] }>> {
    const results = new Map<
    string,
    { schemaValid: boolean; errors: string[] }
    >();

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
            errors: [
              'No <script type="application/ld+json"> block found in HTML'
            ]
          });
          continue;
        }

        let metadata: unknown;
        try {
          metadata = JSON.parse(metaDataElement.text());
        } catch (parseError) {
          const message =
            parseError instanceof Error ?
              parseError.message :
              'Unknown JSON parse error';
          results.set(key, {
            schemaValid: false,
            errors: [`Invalid JSON in ld+json: ${message}`]
          });
          continue;
        }

        const valid = validator(metadata);
        if (!valid) {
          const errors = (validator.errors || []).map(
            e => `${e.instancePath} ${e.message}`
          );
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
        const message =
          e instanceof Error ?
            e.message :
            'Unknown coding scheme validation error';
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
