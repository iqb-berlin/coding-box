import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as cheerio from 'cheerio';
import AdmZip = require('adm-zip');
import * as fs from 'fs';
import * as path from 'path';
import * as libxmljs from 'libxmljs2';
import { ResponseDto } from 'api-dto/responses/response-dto';
import FileUpload from '../entities/file_upload.entity';
import Persons from '../entities/persons.entity';
import { FilesDto } from '../../../../../../api-dto/files/files.dto';
import { FileIo } from '../../admin/workspace/file-io.interface';
import { FileDownloadDto } from '../../../../../../api-dto/files/file-download.dto';
import { FileValidationResultDto } from '../../../../../../api-dto/files/file-validation-result.dto';
import { BookletValidationResultEntryDto } from '../../../../../../api-dto/files/booklet-validation-result-entry.dto';
import { SimpleDataValidationDto } from '../../../../../../api-dto/files/simple-data-validation.dto';
import {
  BookletContentValidationDetails
} from '../../../../../../api-dto/files/booklet-content-validation-details.dto';
import { ResponseEntity } from '../entities/response.entity';
import { TestResultValidationDto } from '../../../../../../api-dto/test-groups/test-result-validation.dto';

function sanitizePath(filePath: string): string {
  const normalizedPath = path.normalize(filePath);
  if (normalizedPath.startsWith('..')) {
    throw new Error('Invalid file path: Path cannot navigate outside root.');
  }
  return normalizedPath.replace(/\\/g, '/');
}

type FileStatus = {
  filename: string;
  exists: boolean;
};

type DataValidation = {
  complete: boolean;
  missing: string[];
  files: FileStatus[];
};

export type ValidationResult = { // This type is used by checkUnitsAndDependenciesForBooklet
  allUnitsExist: boolean;
  missingUnits: string[];
  unitFiles: FileStatus[];
  allCodingSchemesExist: boolean;
  allCodingDefinitionsExist: boolean;
  missingCodingSchemeRefs: string[];
  missingDefinitionRefs: string[];
  schemeFiles: FileStatus[];
  definitionFiles: FileStatus[];
  allPlayerRefsExist: boolean;
  missingPlayerRefs: string[];
  playerFiles: FileStatus[];
};

@Injectable()
export class WorkspaceFilesService {
  private readonly logger = new Logger(WorkspaceFilesService.name);

  constructor(
    @InjectRepository(FileUpload)
    private fileUploadRepository: Repository<FileUpload>,
    @InjectRepository(Persons)
    private personsRepository: Repository<Persons>,
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>
  ) {}

  async validateTestResults(workspaceId: number): Promise<TestResultValidationDto[]> {
    this.logger.log(`Validating test results for workspace ${workspaceId}`);

    const unitNamesInResponses = await this.responseRepository.createQueryBuilder('response')
      .innerJoin('response.unit', 'unit')
      .innerJoin('unit.booklet', 'booklet')
      .innerJoin('booklet.person', 'person')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .select('DISTINCT unit.name', 'unitName')
      .getRawMany();

    const unitIds = unitNamesInResponses.map(u => u.unitName.toUpperCase());

    if (unitIds.length === 0) {
      this.logger.log('No units with responses found to validate.');
      return [];
    }

    const unitFiles = await this.fileUploadRepository.find({
      where: {
        workspace_id: workspaceId,
        file_type: 'Unit',
        file_id: In(unitIds)
      }
    });

    const unitDefinitions = new Map<string, any>();
    for (const unitFile of unitFiles) {
      try {
        const unitId = unitFile.file_id;
        if (!unitId) continue;

        const xml = unitFile.data;
        const $ = cheerio.load(xml, { xmlMode: true, recognizeSelfClosing: true });
        const variables = {};
        $('BaseVariables > Variable').each((i, elem) => {
          const variable = $(elem);
          const id = variable.attr('id');
          const type = variable.attr('type');
          const values = [];
          variable.find('Values > Value > value').each((j, valElem) => {
            values.push($(valElem).text());
          });
          if (id) {
            variables[id] = { type, values };
          }
        });
        unitDefinitions.set(unitId.toUpperCase(), variables);
      } catch (e) {
        this.logger.error(`Could not parse unit file ${unitFile.filename}`, e);
      }
    }

    const responseStream = await this.responseRepository.createQueryBuilder('response')
      .leftJoin('response.unit', 'unit')
      .leftJoin('unit.booklet', 'booklet')
      .leftJoin('booklet.person', 'person')
      .select([
        'response.id as "testResultId"',
        'response.variableid as "variableId"',
        'response.value as "value"',
        'unit.name as "unitName"',
        'person.id as "personId"'
      ])
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .stream();

    const validationErrors: TestResultValidationDto[] = [];

    for await (const response of responseStream) {
      if (!response.unitName || !response.personId) continue;

      const unitDef = unitDefinitions.get(response.unitName.toUpperCase());
      if (!unitDef) {
        continue;
      }

      const variableDef = unitDef[response.variableId];
      if (!variableDef) {
        validationErrors.push({
          ...response,
          error: `Variable '${response.variableId}' not defined in unit '${response.unitName}'.`
        });
        continue;
      }

      const { type, values } = variableDef;
      const responseValue = response.value;

      if (responseValue === null || responseValue === undefined) continue;

      let isValid = true;
      let error = '';

      switch (type) {
        case 'integer':
          if (!/^-?\d+$/.test(responseValue)) {
            isValid = false;
            error = `Value '${responseValue}' is not a valid integer.`;
          } else if (values.length > 0) {
            if (!values.includes(responseValue)) {
              isValid = false;
              error = `Value '${responseValue}' is not in the list of allowed values: [${values.join(', ')}]`;
            }
          }
          break;
        case 'string':
          if (values.length > 0 && !values.includes(responseValue)) {
            isValid = false;
            error = `Value '${responseValue}' is not in the list of allowed values.`;
          }
          break;
        default:
          break;
      }

      if (!isValid) {
        validationErrors.push({
          ...response,
          error
        });
      }
    }

    return validationErrors;
  }

  async findFiles(workspaceId: number, options?: { page: number; limit: number }): Promise<[FilesDto[], number]> {
    this.logger.log(`Fetching test files for workspace: ${workspaceId}`);

    if (options) {
      const { page, limit } = options;
      const MAX_LIMIT = 10000;
      const validPage = Math.max(1, page);
      const validLimit = Math.min(Math.max(1, limit), MAX_LIMIT);

      const [files, total] = await this.fileUploadRepository.findAndCount({
        where: { workspace_id: workspaceId },
        select: ['id', 'filename', 'file_id', 'file_size', 'file_type', 'created_at'],
        skip: (validPage - 1) * validLimit,
        take: validLimit,
        order: { created_at: 'DESC' }
      });

      this.logger.log(`Found ${files.length} files (page ${validPage}, limit ${validLimit}, total ${total}).`);
      return [files, total];
    }

    const files = await this.fileUploadRepository.find({
      where: { workspace_id: workspaceId },
      select: ['id', 'filename', 'file_id', 'file_size', 'file_type', 'created_at'],
      order: { created_at: 'DESC' }
    });

    this.logger.log(`Found ${files.length} files.`);
    return [files, files.length];
  }

  async deleteTestFiles(workspace_id: number, fileIds: string[]): Promise<boolean> {
    this.logger.log(`Delete test files for workspace ${workspace_id}`);
    const res = await this.fileUploadRepository.delete(fileIds);
    return !!res;
  }

  async validateTestFiles(workspaceId: number): Promise<FileValidationResultDto> {
    this.logger.log(`Starting file validation for workspace ID: ${workspaceId}`);

    const bookletFileEntities = await this.fileUploadRepository.find({
      where: { workspace_id: workspaceId, file_type: 'Booklet' }
    });

    const allReferencedUnitIds = new Set<string>();
    const bookletValidationResults: BookletValidationResultEntryDto[] = [];

    if (bookletFileEntities && bookletFileEntities.length > 0) {
      const bookletProcessingPromises = bookletFileEntities.map(async bookletEntity => {
        const result = await this.processSingleBookletValidation(bookletEntity, workspaceId);
        if (result && result.validationDetails.units.files) {
          result.validationDetails.units.files.forEach(unitFile => {
            allReferencedUnitIds.add(unitFile.filename.toUpperCase());
          });
        }
        return result;
      });
      const results = await Promise.all(bookletProcessingPromises);
      bookletValidationResults.push(...results.filter(r => r !== null) as BookletValidationResultEntryDto[]);
    } else {
      this.logger.warn(`No booklets found in workspace ${workspaceId}. All units will be considered orphaned.`);
    }

    const allWorkspaceUnits = await this.fileUploadRepository.find({
      where: { workspace_id: workspaceId, file_type: 'Unit' },
      select: ['file_id', 'id'] // Select 'id' for deletion
    });

    const orphanedUnitEntities = allWorkspaceUnits.filter(unitEntity => !allReferencedUnitIds.has((unitEntity.file_id || '').toUpperCase())
    );

    const orphanedUnitIdsToDelete = orphanedUnitEntities.map(unit => unit.file_id);
    const orphanedUnitPrimaryIdsToDelete = orphanedUnitEntities.map(unit => unit.id);

    const orphanedUnitsValidation: SimpleDataValidationDto = {
      complete: orphanedUnitIdsToDelete.length === 0,
      missing: orphanedUnitIdsToDelete
    };

    if (orphanedUnitPrimaryIdsToDelete.length > 0) {
      this.logger.log(`Deleting ${orphanedUnitPrimaryIdsToDelete.length} orphaned units from workspace ${workspaceId}: ${orphanedUnitIdsToDelete.join(', ')}`);
      await this.fileUploadRepository.delete({ id: In(orphanedUnitPrimaryIdsToDelete) });
      this.logger.log(`Successfully deleted ${orphanedUnitPrimaryIdsToDelete.length} orphaned units.`);
    } else {
      this.logger.log(`No orphaned units found to delete in workspace ${workspaceId}.`);
    }

    const remainingUnitsAfterOrphanDeletion = await this.fileUploadRepository.find({
      where: { workspace_id: workspaceId, file_type: 'Unit' },
      select: ['file_id', 'data'] // Need data to parse for player refs
    });

    const unitsWithoutPlayer: string[] = [];
    for (const unitEntity of remainingUnitsAfterOrphanDeletion) {
      if (!unitEntity.file_id || !unitEntity.data) continue;
      try {
        const $unit = cheerio.load(unitEntity.data, { xmlMode: true, recognizeSelfClosing: true });
        let hasPlayerRef = false;
        // eslint-disable-next-line consistent-return
        $unit('DefinitionRef').each((_, el) => {
          if ($unit(el).attr('player')) {
            hasPlayerRef = true;
            return false; // Exit .each loop early
          }
        });
        if (!hasPlayerRef) {
          unitsWithoutPlayer.push(unitEntity.file_id);
        }
      } catch (error) {
        this.logger.error(`Error parsing unit ${unitEntity.file_id} for player check: ${error}`);
        unitsWithoutPlayer.push(unitEntity.file_id); // Consider it missing a player if parsing fails
      }
    }

    const allUnitsHavePlayerValidation: SimpleDataValidationDto = {
      complete: unitsWithoutPlayer.length === 0,
      missing: unitsWithoutPlayer
    };

    if (unitsWithoutPlayer.length > 0) {
      this.logger.warn(`Found ${unitsWithoutPlayer.length} units without player references in workspace ${workspaceId}: ${unitsWithoutPlayer.join(', ')}`);
    } else {
      this.logger.log(`All units in workspace ${workspaceId} have player references.`);
    }

    // Global check: Ensure every booklet is referenced in at least one TestTakers file
    const allBookletEntities = await this.fileUploadRepository.find({
      where: { workspace_id: workspaceId, file_type: 'Booklet' },
      select: ['file_id']
    });
    const allBookletIds = allBookletEntities.map(b => b.file_id.toUpperCase());
    const referencedBookletIdsInTestTakers = new Set<string>();

    if (allBookletIds.length > 0) {
      const testTakersFiles = await this.fileUploadRepository.find({
        where: { workspace_id: workspaceId, file_type: 'TestTakers' },
        select: ['data', 'file_id']
      });

      for (const ttFile of testTakersFiles) {
        if (!ttFile.data) continue;
        try {
          const $tt = cheerio.load(ttFile.data, { xmlMode: true, recognizeSelfClosing: true });
          $tt('Booklet').each((_, bookletElement) => {
            const bookletIdFromTestTaker = $tt(bookletElement).text().trim().toUpperCase();
            if (bookletIdFromTestTaker) {
              referencedBookletIdsInTestTakers.add(bookletIdFromTestTaker);
            }
          });
        } catch (error) {
          this.logger.error(`Error parsing TestTakers file ${ttFile.file_id}: ${error}`);
        }
      }
    }

    const bookletsNotReferencedInTestTakers = allBookletIds.filter(bId => !referencedBookletIdsInTestTakers.has(bId));

    const bookletsInTestTakersValidation: SimpleDataValidationDto = {
      complete: bookletsNotReferencedInTestTakers.length === 0,
      missing: bookletsNotReferencedInTestTakers
    };

    if (bookletsNotReferencedInTestTakers.length > 0) {
      this.logger.warn(`Found ${bookletsNotReferencedInTestTakers.length} booklets not referenced in any TestTakers file in workspace ${workspaceId}: ${bookletsNotReferencedInTestTakers.join(', ')}`);
    } else if (allBookletIds.length > 0) {
      this.logger.log(`All booklets in workspace ${workspaceId} are referenced in at least one TestTakers file.`);
    } else {
      this.logger.log(`No booklets in workspace ${workspaceId} to check for TestTakers references.`);
    }

    const allWorkspaceBookletIds = new Set(allBookletEntities.map(b => b.file_id.toUpperCase()));
    const missingBookletsReferencedInTestTakers: string[] = [];

    if (referencedBookletIdsInTestTakers.size > 0) {
      for (const referencedBookletId of referencedBookletIdsInTestTakers) {
        if (!allWorkspaceBookletIds.has(referencedBookletId)) {
          missingBookletsReferencedInTestTakers.push(referencedBookletId);
        }
      }
    }

    const referencedBookletsExistValidation: SimpleDataValidationDto = {
      complete: missingBookletsReferencedInTestTakers.length === 0,
      missing: missingBookletsReferencedInTestTakers
    };

    if (missingBookletsReferencedInTestTakers.length > 0) {
      this.logger.warn(`Found ${missingBookletsReferencedInTestTakers.length} booklets referenced in TestTakers files but not found in workspace ${workspaceId}: ${missingBookletsReferencedInTestTakers.join(', ')}`);
    } else if (referencedBookletIdsInTestTakers.size > 0) {
      this.logger.log(`All booklets referenced in TestTakers files exist in workspace ${workspaceId}.`);
    } else {
      this.logger.log(`No booklets referenced in TestTakers files to check for existence in workspace ${workspaceId}.`);
    }

    const allTestTakersFiles = await this.fileUploadRepository.find({
      where: { workspace_id: workspaceId, file_type: 'TestTakers' },
      select: ['data', 'file_id']
    });

    const ignoredTestTakersFiles: string[] = [];
    const allTestTakers = new Map<string, string[]>();

    for (const ttFile of allTestTakersFiles) {
      if (!ttFile.data) continue;
      try {
        const $tt = cheerio.load(ttFile.data, { xmlMode: true, recognizeSelfClosing: true });
        const logins = $tt('Testtakers > Person > Login');
        let hasNonHotLogin = false;

        if (logins.length > 0) {
          logins.each((_, loginElement) => {
            const mode = $tt(loginElement).attr('mode')?.toLowerCase();
            if (mode !== 'run-hot-return' && mode !== 'run-hot-restart') {
              hasNonHotLogin = true;
              return false; // break .each loop
            }
          });
        } else {
          hasNonHotLogin = true;
        }

        if (!hasNonHotLogin) {
          ignoredTestTakersFiles.push(ttFile.file_id);
          continue;
        }

        $tt('Testtakers > Person').each((_, personElement) => {
          const loginElement = $tt(personElement).find('Login');
          const login = loginElement.text().trim().toUpperCase();
          const mode = loginElement.attr('mode')?.toLowerCase();

          if (login && mode !== 'run-hot-return' && mode !== 'run-hot-restart') {
            if (!allTestTakers.has(login)) {
              allTestTakers.set(login, []);
            }
            allTestTakers.get(login)?.push(ttFile.file_id);
          }
        });
      } catch (error) {
        this.logger.error(`Error parsing TestTakers file ${ttFile.file_id} for duplicate check: ${error}`);
      }
    }

    const duplicateTestTakers: string[] = [];
    allTestTakers.forEach((files, login) => {
      if (files.length > 1) {
        duplicateTestTakers.push(`${login} (in ${files.join(', ')})`);
      }
    });

    const testTakersDuplicatesValidation: SimpleDataValidationDto = {
      complete: duplicateTestTakers.length === 0,
      missing: duplicateTestTakers
    };

    if (duplicateTestTakers.length > 0) {
      this.logger.warn(`Found ${duplicateTestTakers.length} duplicate test-takers in workspace ${workspaceId}: ${duplicateTestTakers.join('; ')}`);
    } else {
      this.logger.log(`No duplicate test-takers found in workspace ${workspaceId}.`);
    }

    if (ignoredTestTakersFiles.length > 0) {
      this.logger.log(`Ignored ${ignoredTestTakersFiles.length} TestTakers files in workspace ${workspaceId}: ${ignoredTestTakersFiles.join(', ')}`);
    }

    const personCodesFromDb = (await this.personsRepository.find({
      where: { workspace_id: workspaceId },
      select: ['code']
    })).map(p => p.code.toUpperCase());

    const testTakerLoginsFromFile = Array.from(allTestTakers.keys());

    const missingPersons = testTakerLoginsFromFile.filter(login => !personCodesFromDb.includes(login));

    const testTakersToPersonValidation: SimpleDataValidationDto = {
      complete: missingPersons.length === 0,
      missing: missingPersons
    };

    if (missingPersons.length > 0) {
      this.logger.warn(`Found ${missingPersons.length} test-takers from files that are not in the persons table for workspace ${workspaceId}: ${missingPersons.join(', ')}`);
    } else if (testTakerLoginsFromFile.length > 0) {
      this.logger.log(`All test-takers from files are present in the persons table for workspace ${workspaceId}.`);
    } else {
      this.logger.log('No test-takers from files to check against the persons table.');
    }

    return {
      bookletValidationResults: bookletValidationResults,
      orphanedUnitsValidation: orphanedUnitsValidation,
      allUnitsHavePlayerValidation: allUnitsHavePlayerValidation,
      bookletsInTestTakersValidation: bookletsInTestTakersValidation,
      referencedBookletsExistValidation: referencedBookletsExistValidation,
      testTakersDuplicatesValidation: testTakersDuplicatesValidation,
      ignoredTestTakersFiles: ignoredTestTakersFiles,
      testTakersToPersonValidation: testTakersToPersonValidation
    };
  }

  private async processSingleBookletValidation(
    bookletEntity: FileUpload,
    workspaceId: number
  ): Promise<BookletValidationResultEntryDto | null> {
    const bookletId = bookletEntity.file_id || bookletEntity.filename;
    if (!bookletId) {
      this.logger.warn(`Booklet entity (ID: ${bookletEntity.id}) has no file_id or filename. Skipping.`);
      return null;
    }
    this.logger.log(`Processing validation for booklet: ${bookletId}`);

    const bookletSelfStatus: DataValidation = {
      complete: true, // The booklet file itself exists as we are processing it
      missing: [],
      files: [{ filename: bookletId, exists: true }]
    };

    const $booklet = cheerio.load(bookletEntity.data, { xmlMode: true, recognizeSelfClosing: true });
    const unitIdsReferencedByThisBooklet: string[] = [];
    $booklet('Unit').each((_, element) => {
      const unitId = $booklet(element).attr('id');
      if (unitId) {
        unitIdsReferencedByThisBooklet.push(unitId.toUpperCase().trim());
      }
    });

    if (unitIdsReferencedByThisBooklet.length === 0) {
      this.logger.log(`Booklet ${bookletId} does not reference any units.`);
      // Return validation indicating no units, and therefore no further dependencies.
      const emptyDataValidation = { complete: true, missing: [], files: [] };
      return {
        bookletId: bookletId,
        validationDetails: {
          bookletSelfStatus,
          units: emptyDataValidation,
          schemes: emptyDataValidation,
          definitions: emptyDataValidation,
          player: emptyDataValidation
        }
      };
    }

    const dependencyValidationResult = await this.checkUnitsAndDependencies(
      unitIdsReferencedByThisBooklet, // Only units from this booklet
      workspaceId
    );

    const validationDetails: BookletContentValidationDetails = {
      bookletSelfStatus,
      units: {
        complete: dependencyValidationResult.allUnitsExist,
        missing: dependencyValidationResult.missingUnits,
        files: dependencyValidationResult.unitFiles
      },
      schemes: {
        complete: dependencyValidationResult.allCodingSchemesExist,
        missing: dependencyValidationResult.missingCodingSchemeRefs,
        files: dependencyValidationResult.schemeFiles
      },
      definitions: {
        complete: dependencyValidationResult.allCodingDefinitionsExist,
        missing: dependencyValidationResult.missingDefinitionRefs,
        files: dependencyValidationResult.definitionFiles
      },
      player: {
        complete: dependencyValidationResult.allPlayerRefsExist,
        missing: dependencyValidationResult.missingPlayerRefs,
        files: dependencyValidationResult.playerFiles
      }
    };

    return { bookletId, validationDetails };
  }

  // Renamed and refactored from checkMissingUnits to be more generic for dependency checking
  // Takes a list of unit IDs and checks their existence and their dependencies.
  private async checkUnitsAndDependencies(
    unitIdsToValidate: string[],
    workspaceId: number
  ): Promise<ValidationResult> {
    if (!unitIdsToValidate || unitIdsToValidate.length === 0) {
      return this.createEmptyValidationResult();
    }

    this.logger.log(`Checking ${unitIdsToValidate.length} unit(s) and their dependencies for workspace ${workspaceId}. Units: ${unitIdsToValidate.join(', ')}`);

    const chunkSize = 50; // Database query chunk size
    const unitBatches = [];
    for (let i = 0; i < unitIdsToValidate.length; i += chunkSize) {
      unitBatches.push(unitIdsToValidate.slice(i, i + chunkSize));
    }

    const unitBatchPromises = unitBatches.map(batch => this.fileUploadRepository.find({
      where: { file_id: In(batch), file_type: 'Unit', workspace_id: workspaceId } // Ensure type and workspace
    })
    );
    const existingUnitsFlat = (await Promise.all(unitBatchPromises)).flat();
    const foundUnitIds = existingUnitsFlat.map(unit => (unit.file_id || '').toUpperCase());

    const missingUnits = unitIdsToValidate.filter(id => !foundUnitIds.includes(id));
    const allUnitsExist = missingUnits.length === 0;
    const unitFiles: FileStatus[] = unitIdsToValidate.map(id => ({
      filename: id,
      exists: foundUnitIds.includes(id)
    }));

    if (existingUnitsFlat.length === 0) {
      this.logger.log('No existing units found from the provided list. No further dependencies to check.');
      return {
        allUnitsExist,
        missingUnits,
        unitFiles,
        ...this.createEmptyValidationResult(true) // Keep unit validation, but empty for dependencies
      };
    }

    const refsPromises = existingUnitsFlat.map(async unit => {
      try {
        const $unit = cheerio.load(unit.data, { xmlMode: true, recognizeSelfClosing: true });
        const refs = { codingSchemeRefs: new Set<string>(), definitionRefs: new Set<string>(), playerRefs: new Set<string>() };
        // Assuming 'Unit' is the root or a relevant tag containing these references
        $unit('Unit').each((_, unitElement) => { // Or the correct selector for unit content
          $unit(unitElement).find('CodingSchemeRef').each((_, el) => {
            const ref = $unit(el).text().trim().toUpperCase();
            if (ref) refs.codingSchemeRefs.add(ref);
          });
          $unit(unitElement).find('DefinitionRef').each((_, el) => {
            const ref = $unit(el).text().trim().toUpperCase();
            if (ref) refs.definitionRefs.add(ref);
            const playerRefAttr = $unit(el).attr('player');
            if (playerRefAttr) {
              const playerRef = playerRefAttr.replace('@', '-').toUpperCase().trim();
              if (playerRef) refs.playerRefs.add(playerRef);
            }
          });
        });
        return refs;
      } catch (error) {
        this.logger.error(`Error parsing unit ${unit.file_id}: ${error}`);
        return { codingSchemeRefs: new Set<string>(), definitionRefs: new Set<string>(), playerRefs: new Set<string>() };
      }
    });

    const allRefsCollected = await Promise.all(refsPromises);
    const aggregatedCodingSchemeRefs = Array.from(new Set(allRefsCollected.flatMap(r => Array.from(r.codingSchemeRefs))));
    const aggregatedDefinitionRefs = Array.from(new Set(allRefsCollected.flatMap(r => Array.from(r.definitionRefs))));
    const aggregatedPlayerRefs = Array.from(new Set(allRefsCollected.flatMap(r => Array.from(r.playerRefs))));

    const allResourceFileIds = new Set<string>();
    if ([...aggregatedCodingSchemeRefs, ...aggregatedDefinitionRefs, ...aggregatedPlayerRefs].some(refList => refList.length > 0)) {
      const resourceFiles = await this.fileUploadRepository.find({
        where: { file_type: 'Resource', workspace_id: workspaceId, file_id: In([...aggregatedCodingSchemeRefs, ...aggregatedDefinitionRefs, ...aggregatedPlayerRefs].filter(id => id)) },
        select: ['file_id']
      });
      resourceFiles.forEach(rf => allResourceFileIds.add((rf.file_id || '').toUpperCase()));
    }

    const missingCodingSchemeRefs = aggregatedCodingSchemeRefs.filter(ref => !allResourceFileIds.has(ref));
    const schemeFiles: FileStatus[] = aggregatedCodingSchemeRefs.map(ref => ({ filename: ref, exists: allResourceFileIds.has(ref) }));

    const missingDefinitionRefs = aggregatedDefinitionRefs.filter(ref => !allResourceFileIds.has(ref));
    const definitionFiles: FileStatus[] = aggregatedDefinitionRefs.map(ref => ({ filename: ref, exists: allResourceFileIds.has(ref) }));

    const missingPlayerRefs = aggregatedPlayerRefs.filter(ref => !allResourceFileIds.has(ref));
    const playerFiles: FileStatus[] = aggregatedPlayerRefs.map(ref => ({ filename: ref, exists: allResourceFileIds.has(ref) }));

    return {
      allUnitsExist,
      missingUnits,
      unitFiles,
      allCodingSchemesExist: missingCodingSchemeRefs.length === 0,
      missingCodingSchemeRefs,
      schemeFiles,
      allCodingDefinitionsExist: missingDefinitionRefs.length === 0,
      missingDefinitionRefs,
      definitionFiles,
      allPlayerRefsExist: missingPlayerRefs.length === 0,
      missingPlayerRefs,
      playerFiles
    };
  }

  private createEmptyValidationResult(skipUnitPartials: boolean = false): ValidationResult {
    const unitPartials = skipUnitPartials ? {} : {
      allUnitsExist: true,
      missingUnits: [],
      unitFiles: []
    };
    return {
      ...unitPartials,
      allCodingSchemesExist: true,
      missingCodingSchemeRefs: [],
      schemeFiles: [],
      allCodingDefinitionsExist: true,
      missingDefinitionRefs: [],
      definitionFiles: [],
      allPlayerRefsExist: true,
      missingPlayerRefs: [],
      playerFiles: []
    } as ValidationResult;
  }

  async uploadTestFiles(workspace_id: number, originalFiles: FileIo[]): Promise<FileValidationResultDto | boolean> {
    this.logger.log(`Uploading test files for workspace ${workspace_id}`);

    const MAX_CONCURRENT_UPLOADS = 5;
    const processInBatches = async (files: FileIo[], batchSize: number): Promise<PromiseSettledResult<void>[]> => {
      const results: PromiseSettledResult<void>[] = [];
      const batches = [];
      for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize);
        batches.push(
          Promise.allSettled(batch.flatMap(file => this.handleFile(workspace_id, file)))
        );
      }
      const batchResults = await Promise.all(batches);
      batchResults.forEach(batch => results.push(...batch as PromiseSettledResult<void>[]));
      return results;
    };

    try {
      const results = await processInBatches(originalFiles, MAX_CONCURRENT_UPLOADS);
      const failedFiles = results
        .filter(result => result.status === 'rejected')
        .map((result, index) => ({
          file: originalFiles[index],
          reason: (result as PromiseRejectedResult).reason
        }));

      if (failedFiles.length > 0) {
        this.logger.warn(`Some files failed to upload for workspace ${workspace_id}:`);
        failedFiles.forEach(({ file, reason }) => this.logger.warn(`File: ${JSON.stringify(file)}, Reason: ${reason}`)
        );
        return false; // Indicate that some files failed to upload
      }

      // If all files uploaded successfully, proceed to validation
      this.logger.log(`All files uploaded successfully for workspace ${workspace_id}. Starting validation.`);
      return await this.validateTestFiles(workspace_id);
    } catch (error) {
      this.logger.error(`Unexpected error while uploading files for workspace ${workspace_id}:`, error);
      return false; // Indicate a general error during upload or validation trigger
    }
  }

  async downloadTestFile(workspace_id: number, fileId: number): Promise<FileDownloadDto> {
    this.logger.log(`Downloading file with ID ${fileId} for workspace ${workspace_id}`);

    const file = await this.fileUploadRepository.findOne({
      where: { id: fileId, workspace_id: workspace_id }
    });

    if (!file) {
      this.logger.warn(`File with ID ${fileId} not found in workspace ${workspace_id}`);
      throw new Error('File not found');
    }
    this.logger.log(`File ${file.filename} found. Preparing to convert to Base64.`);
    const base64Data = Buffer.from(file.data, 'binary').toString('base64');
    this.logger.log(`File ${file.filename} successfully converted to Base64.`);

    return {
      filename: file.filename,
      base64Data,
      mimeType: 'application/xml'
    };
  }

  handleFile(workspaceId: number, file: FileIo): Array<Promise<unknown>> {
    const filePromises: Array<Promise<unknown>> = [];

    switch (file.mimetype) {
      case 'text/xml':
        filePromises.push(this.handleXmlFile(workspaceId, file));
        break;
      case 'text/html':
        filePromises.push(this.handleHtmlFile(workspaceId, file));
        break;
      case 'application/octet-stream':
        filePromises.push(this.handleOctetStreamFile(workspaceId, file));
        break;
      case 'application/zip':
      case 'application/x-zip-compressed':
      case 'application/x-zip':
        filePromises.push(...this.handleZipFile(workspaceId, file));
        break;
      default:
        this.logger.warn(`Unsupported file type: ${file.mimetype}`);
        filePromises.push(Promise.reject(this.unsupportedFile(`Unsupported file type: ${file.mimetype}`)));
    }

    return filePromises;
  }

  private unsupportedFile(message: string): Error {
    return new Error(message);
  }

  private async validateXmlAgainstSchema(xml: string, xsdPath: string): Promise<boolean> {
    try {
      const xsdContent = fs.readFileSync(xsdPath, 'utf8');
      const xsdDoc = libxmljs.parseXml(xsdContent);
      const xmlDoc = libxmljs.parseXml(xml);
      return xmlDoc.validate(xsdDoc);
    } catch (err) {
      this.logger.error(`XML validation error: ${err.message}`);
      return false;
    }
  }

  private async handleXmlFile(workspaceId: number, file: FileIo): Promise<unknown> {
    try {
      if (!file.buffer || !file.buffer.length) {
        this.logger.warn('Empty file buffer');
        return await Promise.resolve();
      }

      const xmlContent = file.buffer.toString('utf8');
      const xmlDocument = cheerio.load(file.buffer.toString('utf8'), { xmlMode: true, recognizeSelfClosing: true });
      const firstChild = xmlDocument.root().children().first();
      const rootTagName = firstChild ? firstChild.prop('tagName') : null;

      if (!rootTagName) {
        return this.unsupportedFile('Invalid XML: No root tag found');
      }

      const fileTypeMapping: Record<string, string> = {
        UNIT: 'Unit',
        BOOKLET: 'Booklet',
        TESTTAKERS: 'TestTakers'
      };

      const fileType = fileTypeMapping[rootTagName];
      if (!fileType) {
        return this.unsupportedFile(`Unsupported root tag: ${rootTagName}`);
      }

      const schemaPaths: Record<string, string> = {
        UNIT: path.resolve(__dirname, 'schemas/unit.xsd'),
        BOOKLET: path.resolve(__dirname, 'schemas/booklet.xsd'),
        TESTTAKERS: path.resolve(__dirname, 'schemas/testtakers.xsd')
      };
      const xsdPath = schemaPaths[rootTagName];
      if (!xsdPath || !fs.existsSync(xsdPath)) {
        return this.unsupportedFile(`No XSD schema found for root tag: ${rootTagName}`);
      }

      await this.validateXmlAgainstSchema(xmlContent, xsdPath);

      const metadata = xmlDocument('Metadata');
      const idElement = metadata.find('Id');
      const fileId = idElement.length ? idElement.text().toUpperCase().trim() : null;
      const resolvedFileId = fileType === 'TestTakers' ? fileId || file.originalname : fileId;

      const existingFile = await this.fileUploadRepository.findOne({
        where: { file_id: resolvedFileId, workspace_id: workspaceId }
      });
      if (existingFile) {
        this.logger.warn(
          `File with ID ${resolvedFileId} in Workspace ${workspaceId} already exists.`
        );
        return {
          message: `File with ID ${resolvedFileId} already exists`,
          fileId: resolvedFileId,
          filename: file.originalname
        };
      }

      return await this.fileUploadRepository.upsert({
        workspace_id: workspaceId,
        filename: file.originalname,
        file_type: fileType,
        file_size: file.size,
        data: file.buffer.toString(),
        file_id: resolvedFileId
      }, ['file_id']);
    } catch (error) {
      this.logger.error(`Error processing XML file: ${error.message}`);
      throw error;
    }
  }

  private async handleHtmlFile(workspaceId: number, file: FileIo): Promise<unknown> {
    const resourceFileId = WorkspaceFilesService.getPlayerId(file);

    return this.fileUploadRepository.upsert({
      filename: file.originalname,
      workspace_id: workspaceId,
      file_type: 'Resource',
      file_size: file.size,
      file_id: resourceFileId,
      data: file.buffer.toString()
    }, ['file_id']);
  }

  private async handleOctetStreamFile(workspaceId: number, file: FileIo): Promise<void> {
    this.logger.log(`Processing octet-stream file: ${file.originalname} for workspace ${workspaceId}`);
    try {
      const fileExtension = path.extname(file.originalname).toLowerCase();
      let fileType = 'Resource';
      let fileContent: string | Buffer = file.buffer;

      if (['.xml', '.html', '.htm', '.xhtml', '.txt', '.json', '.csv'].includes(fileExtension)) {
        fileContent = file.buffer.toString('utf8');
      }

      if (fileExtension === '.xml') {
        try {
          const $ = cheerio.load(fileContent as string, { xmlMode: true });
          if ($('Testtakers').length > 0) {
            fileType = 'TestTakers';
          } else if ($('Booklet').length > 0) {
            fileType = 'Booklet';
          } else if ($('Unit').length > 0) {
            fileType = 'Unit';
          } else if ($('SysCheck').length > 0) {
            fileType = 'SysCheck';
          }
        } catch (error) {
          this.logger.warn(`Could not parse XML content for ${file.originalname}: ${error.message}`);
        }
      }

      // @ts-expect-error
      const fileUpload = this.fileUploadRepository.create({
        workspace_id: workspaceId,
        filename: file.originalname,
        file_id: file.originalname.toUpperCase(),
        file_type: fileType,
        file_size: file.size,
        data: fileContent
      });

      await this.fileUploadRepository.save(fileUpload);
      this.logger.log(`Successfully processed octet-stream file: ${file.originalname} as ${fileType}`);
    } catch (error) {
      this.logger.error(`Error processing octet-stream file ${file.originalname}: ${error.message}`, error.stack);
      throw error;
    }
  }

  private handleZipFile(workspaceId: number, file: FileIo): Array<Promise<unknown>> {
    this.logger.log(`Processing ZIP file: ${file.originalname} for workspace ${workspaceId}`);
    const promises: Array<Promise<unknown>> = [];

    try {
      const zip = new AdmZip(file.buffer);
      const zipEntries = zip.getEntries();

      if (zipEntries.length === 0) {
        this.logger.warn(`ZIP file ${file.originalname} is empty.`);
        return [Promise.reject(new Error(`ZIP file ${file.originalname} is empty.`))];
      }

      this.logger.log(`Found ${zipEntries.length} entries in ZIP file ${file.originalname}`);

      zipEntries.forEach(zipEntry => {
        if (zipEntry.isDirectory) {
          return;
        }

        const entryName = zipEntry.entryName;
        const sanitizedEntryName = sanitizePath(entryName);
        const entryData = zipEntry.getData();

        const mimeType = this.getMimeType(sanitizedEntryName);
        const fileIo: FileIo = {
          originalname: path.basename(sanitizedEntryName),
          buffer: entryData,
          mimetype: mimeType,
          size: entryData.length,
          fieldname: '',
          encoding: ''
        };

        promises.push(...this.handleFile(workspaceId, fileIo));
      });

      return promises;
    } catch (error) {
      this.logger.error(`Error processing ZIP file ${file.originalname}: ${error.message}`, error.stack);
      return [Promise.reject(error)];
    }
  }

  async checkMissingUnits(bookletNames:string[]): Promise<ValidationResult> {
    try {
      const existingBooklets = await this.fileUploadRepository.findBy({
        file_type: 'Booklet',
        file_id: In(bookletNames.map(b => b.toUpperCase()))
      });

      const unitIdsPromises = existingBooklets.map(async booklet => {
        try {
          const fileData = booklet.data;
          const $ = cheerio.load(fileData, { xmlMode: true });
          const unitIds: string[] = [];

          $('Unit').each((_, element) => {
            const unitId = $(element).attr('id');
            if (unitId) {
              unitIds.push(unitId.toUpperCase());
            }
          });

          return unitIds;
        } catch (error) {
          this.logger.error(`Fehler beim Verarbeiten von Unit ${booklet.file_id}:`, error);
          return [];
        }
      });

      const allUnitIdsArrays = await Promise.all(unitIdsPromises);
      const allUnitIds = Array.from(new Set(allUnitIdsArrays.flat()));
      const chunkSize = 50;
      const unitBatches = [];

      for (let i = 0; i < allUnitIds.length; i += chunkSize) {
        const chunk = allUnitIds.slice(i, i + chunkSize);
        unitBatches.push(chunk);
      }

      const unitBatchPromises = unitBatches.map(batch => this.fileUploadRepository.find({
        where: { file_id: In(batch) }
      }));

      const unitBatchResults = await Promise.all(unitBatchPromises);
      const existingUnits = unitBatchResults.flat();

      const refsPromises = existingUnits.map(async unit => {
        try {
          const fileData = unit.data;
          const $ = cheerio.load(fileData, { xmlMode: true });
          const refs = {
            codingSchemeRefs: [] as string[],
            definitionRefs: [] as string[],
            playerRefs: [] as string[]
          };

          $('Unit').each((_, element) => {
            const codingSchemeRef = $(element).find('CodingSchemeRef').text();
            const definitionRef = $(element).find('DefinitionRef').text();
            const playerRefAttr = $(element).find('DefinitionRef').attr('player');
            const playerRef = playerRefAttr ? playerRefAttr.replace('@', '-') : '';

            if (codingSchemeRef) {
              refs.codingSchemeRefs.push(codingSchemeRef.toUpperCase());
            }

            if (definitionRef) {
              refs.definitionRefs.push(definitionRef.toUpperCase());
            }

            if (playerRef) {
              refs.playerRefs.push(playerRef.toUpperCase());
            }
          });

          return refs;
        } catch (error) {
          this.logger.error(`Fehler beim Verarbeiten von Unit ${unit.file_id}:`, error);
          return { codingSchemeRefs: [], definitionRefs: [], playerRefs: [] };
        }
      });

      const allRefs = await Promise.all(refsPromises);

      // Combine all references using Sets to remove duplicates
      const allCodingSchemeRefs = Array.from(new Set(allRefs.flatMap(ref => ref.codingSchemeRefs)));
      const allDefinitionRefs = Array.from(new Set(allRefs.flatMap(ref => ref.definitionRefs)));
      const allPlayerRefs = Array.from(new Set(allRefs.flatMap(ref => ref.playerRefs)));

      // Get all resources in a single query
      const existingResources = await this.fileUploadRepository.findBy({
        file_type: 'Resource'
      });

      const allResourceIds = existingResources.map(resource => resource.file_id);

      const missingCodingSchemeRefs = allCodingSchemeRefs.filter(ref => !allResourceIds.includes(ref));
      const missingDefinitionRefs = allDefinitionRefs.filter(ref => !allResourceIds.includes(ref));
      const missingPlayerRefs = allPlayerRefs.filter(ref => !allResourceIds.includes(ref));

      const allCodingSchemesExist = missingCodingSchemeRefs.length === 0;
      const allCodingDefinitionsExist = missingDefinitionRefs.length === 0;
      const allPlayerRefsExist = missingPlayerRefs.length === 0;

      const foundUnitIds = existingUnits.map(unit => unit.file_id.toUpperCase());
      const missingUnits = allUnitIds.filter(unitId => !foundUnitIds.includes(unitId));
      const uniqueUnits = Array.from(new Set(missingUnits));

      const allUnitsExist = missingUnits.length === 0;

      const unitFiles: FileStatus[] = allUnitIds.map(unitId => ({
        filename: unitId,
        exists: foundUnitIds.includes(unitId)
      }));

      const schemeFiles: FileStatus[] = allCodingSchemeRefs.map(ref => ({
        filename: ref,
        exists: allResourceIds.includes(ref)
      }));

      const definitionFiles: FileStatus[] = allDefinitionRefs.map(ref => ({
        filename: ref,
        exists: allResourceIds.includes(ref)
      }));

      const playerFiles: FileStatus[] = allPlayerRefs.map(ref => ({
        filename: ref,
        exists: allResourceIds.includes(ref)
      }));

      return {
        allUnitsExist,
        missingUnits: uniqueUnits,
        unitFiles,
        allCodingSchemesExist,
        allCodingDefinitionsExist,
        missingCodingSchemeRefs,
        missingDefinitionRefs,
        schemeFiles,
        definitionFiles,
        allPlayerRefsExist,
        missingPlayerRefs,
        playerFiles
      };
    } catch (error) {
      this.logger.error('Error validating units', error);
      throw error;
    }
  }

  private getMimeType(fileName: string): string {
    const extension = path.extname(fileName).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.xml': 'text/xml',
      '.html': 'text/html',
      '.htm': 'text/html',
      '.zip': 'application/zip'
    };
    return mimeTypes[extension] || 'application/octet-stream';
  }

  static cleanResponses(rows: ResponseDto[]): ResponseDto[] {
    return Object.values(rows.reduce((agg, response) => {
      const key = [response.test_person, response.unit_id].join('@@@@@@');
      if (agg[key]) {
        if (!(agg[key].responses.length) && response.responses.length) {
          agg[key].responses = response.responses;
        }
        if (
          !(Object.keys(agg[key].unit_state || {}).length) &&
          (Object.keys(response.unit_state || {}).length)
        ) {
          agg[key].unit_state = response.unit_state;
        }
      } else {
        agg[key] = response;
      }
      return agg;
    }, <{ [key: string]: ResponseDto }>{}));
  }

  async testCenterImport(entries: Record<string, unknown>[]): Promise<boolean> {
    try {
      const registry = this.fileUploadRepository.create(entries);
      await this.fileUploadRepository.upsert(registry, ['file_id']);
      return true;
    } catch (error) {
      this.logger.error('Error during test center import', error);
      return false;
    }
  }

  private static getPlayerId(file: FileIo): string {
    try {
      const playerCode = file.buffer.toString();

      const playerContent = cheerio.load(playerCode);

      // Search for JSON+LD <script> tags in the parsed DOM.
      const metaDataElement = playerContent('script[type="application/ld+json"]');
      const metadata = JSON.parse(metaDataElement.text());
      return WorkspaceFilesService.normalizePlayerId(`${metadata.id}-${metadata.version}`);
    } catch (error) {
      return WorkspaceFilesService.getResourceId(file);
    }
  }

  private static getResourceId(file: FileIo): string {
    if (!file?.originalname) {
      throw new Error('Invalid file: originalname is required.');
    }
    const filePathParts = file.originalname.split('/')
      .map(part => part.trim());
    const fileName = filePathParts.pop();
    if (!fileName) {
      throw new Error('Invalid file: Could not determine the file name.');
    }
    return fileName.toUpperCase();
  }

  private static normalizePlayerId(name: string): string {
    const reg = /^(\D+?)[@V-]?((\d+)(\.\d+)?(\.\d+)?(-\S+?)?)?(.\D{3,4})?$/;

    const matches = name.match(reg);

    if (!matches) {
      throw new Error(`Invalid player name: ${name}`);
    }

    const [, module = '', , major = '', minorDot = ''] = matches;

    const majorVersion = parseInt(major, 10) || 0;
    const minorVersion = minorDot ? parseInt(minorDot.substring(1), 10) : 0;
    // const patchVersion = patchDot ? parseInt(patchDot.substring(1), 10) : 0;
    // const label = labelWithDash ? labelWithDash.substring(1) : '';

    return `${module}-${majorVersion}.${minorVersion}`.toUpperCase();
  }
}
