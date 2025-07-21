import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as cheerio from 'cheerio';
import AdmZip = require('adm-zip');
import * as fs from 'fs';
import * as path from 'path';
import * as libxmljs from 'libxmljs2';
import { parseStringPromise } from 'xml2js';
import FileUpload from '../entities/file_upload.entity';
import { FilesDto } from '../../../../../../api-dto/files/files.dto';
import { FileIo } from '../../admin/workspace/file-io.interface';
import { FileDownloadDto } from '../../../../../../api-dto/files/file-download.dto';
import { FileValidationResultDto, FilteredTestTaker } from '../../../../../../api-dto/files/file-validation-result.dto';
import { ResponseDto } from '../../../../../../api-dto/responses/response-dto';
import { InvalidVariableDto } from '../../../../../../api-dto/files/variable-validation.dto';
import { DuplicateResponseDto, DuplicateResponsesResultDto } from '../../../../../../api-dto/files/duplicate-response.dto';
import { Unit } from '../entities/unit.entity';
import { ResponseEntity } from '../entities/response.entity';
import { Booklet } from '../entities/booklet.entity';
import {
  MissingPersonDto,
  TestTakerLoginDto,
  TestTakersValidationDto
} from '../../../../../../api-dto/files/testtakers-validation.dto';
import Persons from '../entities/persons.entity';

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
  missingUnitsPerBooklet?: { booklet: string; missingUnits: string[] }[];
  unitsWithoutPlayer?: string[];
  unused?: string[];
  unusedBooklets?: string[];
  files: FileStatus[];
};

type ValidationData = {
  testTaker: string;
  booklets: DataValidation;
  units: DataValidation;
  schemes: DataValidation;
  definitions: DataValidation;
  player: DataValidation;
};

export type ValidationResult = {
  allUnitsExist: boolean;
  missingUnits: string[];
  missingUnitsPerBooklet: { booklet: string; missingUnits: string[] }[];
  unitsWithoutPlayer: string[];
  unitFiles: FileStatus[];
  allUnitsUsedInBooklets: boolean;
  unusedUnits: string[];
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
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    @InjectRepository(Unit)
    private unitRepository: Repository<Unit>,
    @InjectRepository(FileUpload)
    private filesRepository: Repository<FileUpload>,
    @InjectRepository(Persons)
    private personsRepository: Repository<Persons>,
    @InjectRepository(Booklet)
    private bookletRepository: Repository<Booklet>
  ) {}

  async findAllFileTypes(workspaceId: number): Promise<string[]> {
    this.logger.log(`Fetching all file types for workspace: ${workspaceId}`);

    try {
      const result = await this.fileUploadRepository
        .createQueryBuilder('file')
        .select('DISTINCT file.file_type', 'file_type')
        .where('file.workspace_id = :workspaceId', { workspaceId })
        .andWhere('file.file_type IS NOT NULL')
        .getRawMany();

      return result.map(item => item.file_type).sort();
    } catch (error) {
      this.logger.error(`Error fetching file types for workspace ${workspaceId}: ${error.message}`, error.stack);
      return [];
    }
  }

  async findFiles(
    workspaceId: number,
    options?: { page: number; limit: number; fileType?: string; fileSize?: string; searchText?: string }
  ): Promise<[FilesDto[], number, string[]]> {
    this.logger.log(`Fetching test files for workspace: ${workspaceId}`);
    const {
      page = 1, limit = 20, fileType, fileSize, searchText
    } = options || {};
    const MAX_LIMIT = 10000;
    const validPage = Math.max(1, page);
    const validLimit = Math.min(Math.max(1, limit), MAX_LIMIT);

    let qb = this.fileUploadRepository.createQueryBuilder('file')
      .where('file.workspace_id = :workspaceId', { workspaceId });

    if (fileType) {
      qb = qb.andWhere('file.file_type = :fileType', { fileType });
    }

    if (fileSize) {
      // fileSize-Filter: z.B. '0-10KB', '10KB-100KB', '100KB-1MB', '1MB-10MB', '10MB+'
      const KB = 1024;
      const MB = 1024 * KB;
      // eslint-disable-next-line default-case
      switch (fileSize) {
        case '0-10KB':
          qb = qb.andWhere('file.file_size < :max', { max: 10 * KB });
          break;
        case '10KB-100KB':
          qb = qb.andWhere('file.file_size >= :min AND file.file_size < :max', { min: 10 * KB, max: 100 * KB });
          break;
        case '100KB-1MB':
          qb = qb.andWhere('file.file_size >= :min AND file.file_size < :max', { min: 100 * KB, max: 1 * MB });
          break;
        case '1MB-10MB':
          qb = qb.andWhere('file.file_size >= :min AND file.file_size < :max', { min: 1 * MB, max: 10 * MB });
          break;
        case '10MB+':
          qb = qb.andWhere('file.file_size >= :min', { min: 10 * MB });
          break;
      }
    }

    if (searchText) {
      const search = `%${searchText.toLowerCase()}%`;
      qb = qb.andWhere(
        '(LOWER(file.filename) LIKE :search OR LOWER(file.file_type) LIKE :search OR TO_CHAR(file.created_at, \'DD.MM.YYYY HH24:MI\') ILIKE :search)',
        { search }
      );
    }

    qb = qb.select(['file.id', 'file.filename', 'file.file_id', 'file.file_size', 'file.file_type', 'file.created_at'])
      .orderBy('file.created_at', 'DESC')
      .skip((validPage - 1) * validLimit)
      .take(validLimit);

    const [files, total] = await qb.getManyAndCount();
    this.logger.log(`Found ${files.length} files (page ${validPage}, limit ${validLimit}, total ${total}).`);

    const fileTypes = await this.findAllFileTypes(workspaceId);

    return [files, total, fileTypes];
  }

  async deleteTestFiles(workspace_id: number, fileIds: string[]): Promise<boolean> {
    this.logger.log(`Delete test files for workspace ${workspace_id}`);
    const res = await this.fileUploadRepository.delete(fileIds);
    return !!res;
  }

  async validateTestFiles(workspaceId: number): Promise<FileValidationResultDto> {
    try {
      const testTakers = await this.fileUploadRepository.find({
        where: { workspace_id: workspaceId, file_type: In(['TestTakers', 'Testtakers']) }
      });

      if (!testTakers || testTakers.length === 0) {
        this.logger.warn(`No TestTakers found in workspace with ID ${workspaceId}.`);
        return {
          testTakersFound: false,
          validationResults: this.createEmptyValidationData()
        };
      }

      const allBooklets = await this.fileUploadRepository.find({
        where: { workspace_id: workspaceId, file_type: 'Booklet' }
      });

      if (!allBooklets || allBooklets.length === 0) {
        this.logger.warn(`No booklets found in workspace with ID ${workspaceId}.`);
        return {
          testTakersFound: true,
          validationResults: this.createEmptyValidationData()
        };
      }

      const modesNotToFilter = ['run-hot-return', 'run-hot-restart', 'run-trial'];

      const shouldFilterMode = (loginMode: string) => !modesNotToFilter.includes(loginMode);

      let filteredTestTakers: FilteredTestTaker[] = [];
      const loginOccurrences = new Map<string, { testTaker: string, mode: string }[]>();

      for (const testTaker of testTakers) {
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
      }

      const duplicateTestTakers = Array.from(loginOccurrences.entries())
        .filter(([, occurrences]) => occurrences.length > 1)
        .map(([login, occurrences]) => ({
          login,
          occurrences
        }));

      this.logger.log(`Found ${duplicateTestTakers.length} duplicate test takers across files`);

      if (filteredTestTakers.length > 0) {
        const loginNames = filteredTestTakers.map(item => item.login);
        const personsNotConsidered = await this.personsRepository.find({
          where: {
            workspace_id: workspaceId,
            login: In(loginNames),
            consider: false
          },
          select: ['login']
        });

        const loginsNotConsidered = personsNotConsidered.map(person => person.login);

        if (loginsNotConsidered.length > 0) {
          this.logger.log(`Filtering out ${loginsNotConsidered.length} test takers where consider is false`);
          filteredTestTakers = filteredTestTakers.filter(item => !loginsNotConsidered.includes(item.login));
        }
      }

      const bookletIdsInTestTakers = new Set<string>();
      for (const testTaker of testTakers) {
        const xmlDocument = cheerio.load(testTaker.data, { xml: true });
        const bookletTags = xmlDocument('Booklet');

        bookletTags.each((_, element) => {
          const bookletId = xmlDocument(element).text().trim().toUpperCase();
          if (bookletId) {
            bookletIdsInTestTakers.add(bookletId);
          }
        });
      }

      const unusedBooklets = allBooklets
        .filter(booklet => !bookletIdsInTestTakers.has(booklet.file_id.toUpperCase()))
        .map(booklet => booklet.file_id);

      this.logger.log(`Found ${unusedBooklets.length} booklets not included in any TestTakers file`);
      this.logger.log(`Found ${filteredTestTakers.length} TestTakers with modes other than 'run-hot-return', 'run-hot-restart', 'run-trial'`);

      const validationResultsPromises = testTakers.map(testTaker => this.processTestTaker(testTaker, unusedBooklets));
      const validationResults = (await Promise.all(validationResultsPromises)).filter(Boolean);

      if (validationResults.length > 0) {
        return {
          testTakersFound: true,
          filteredTestTakers: filteredTestTakers.length > 0 ? filteredTestTakers : undefined,
          duplicateTestTakers: duplicateTestTakers.length > 0 ? duplicateTestTakers : undefined,
          validationResults
        };
      }

      const emptyValidation = this.createEmptyValidationData();
      if (emptyValidation.length > 0 && unusedBooklets.length > 0) {
        emptyValidation[0].booklets.unusedBooklets = unusedBooklets;
      }

      return {
        testTakersFound: true,
        filteredTestTakers: filteredTestTakers.length > 0 ? filteredTestTakers : undefined,
        duplicateTestTakers: duplicateTestTakers.length > 0 ? duplicateTestTakers : undefined,
        validationResults: emptyValidation
      };
    } catch (error) {
      this.logger.error(`Error during test file validation for workspace ID ${workspaceId}: ${error.message}`, error.stack);
      throw error;
    }
  }

  private createEmptyValidationData(): ValidationData[] {
    return [{
      testTaker: '',
      booklets: {
        complete: false,
        missing: [],
        unusedBooklets: [],
        files: []
      },
      units: {
        complete: false,
        missing: [],
        missingUnitsPerBooklet: [],
        unitsWithoutPlayer: [],
        unused: [],
        files: []
      },
      schemes: { complete: false, missing: [], files: [] },
      definitions: { complete: false, missing: [], files: [] },
      player: { complete: false, missing: [], files: [] }
    }];
  }

  async createDummyTestTakerFile(workspaceId: number): Promise<boolean> {
    try {
      const booklets = await this.fileUploadRepository.find({
        where: { workspace_id: workspaceId, file_type: 'Booklet' }
      });

      if (!booklets || booklets.length === 0) {
        const units = await this.fileUploadRepository.find({
          where: { workspace_id: workspaceId, file_type: 'Unit' }
        });

        if (!units || units.length === 0) {
          this.logger.warn(`No booklets or units found in workspace with ID ${workspaceId}.`);
          return false;
        }

        // Create a fake booklet that includes all available units
        const unitRefs = units.map(unit => `  <Unit id="${unit.file_id}"/>`).join('\n');
        const fakeBookletId = 'AUTO-GENERATED-BOOKLET';
        const fakeBookletXml = `<?xml version="1.0" encoding="utf-8"?>
<Booklet>
  <Metadata>
    <Id>${fakeBookletId}</Id>
    <Label>Auto-generated Booklet</Label>
    <Description>Auto-generated booklet including all units</Description>
  </Metadata>
  <Units>
${unitRefs}
  </Units>
</Booklet>`;

        const fakeBooklet = this.fileUploadRepository.create({
          workspace_id: workspaceId,
          filename: 'auto-generated-booklet.xml',
          file_id: fakeBookletId,
          file_type: 'Booklet',
          file_size: fakeBookletXml.length,
          data: fakeBookletXml
        });

        await this.fileUploadRepository.save(fakeBooklet);
        this.logger.log(`Created fake booklet for workspace ${workspaceId} with ${units.length} units.`);

        const dummyTestTakerXml = `<?xml version="1.0" encoding="utf-8"?>
<TestTakers>
  <Metadata>
    <Description>Auto-generated TestTakers file with auto-generated booklet</Description>
  </Metadata>
  <Group id="auto-generated" label="Auto-generated">
    <Login name="auto-generated" mode="run-hot-return">
      <Booklet>${fakeBookletId}</Booklet>
    </Login>
  </Group>
</TestTakers>`;

        const newTestTakerFile = this.fileUploadRepository.create({
          workspace_id: workspaceId,
          filename: 'auto-generated-testtakers.xml',
          file_id: 'AUTO-GENERATED-TESTTAKERS',
          file_type: 'TestTakers',
          file_size: dummyTestTakerXml.length,
          data: dummyTestTakerXml
        });

        await this.fileUploadRepository.save(newTestTakerFile);
        this.logger.log(`Created dummy TestTakers file for workspace ${workspaceId} with auto-generated booklet.`);
        return true;
      }

      const bookletRefs = booklets.map(booklet => `    <Booklet>${booklet.file_id}</Booklet>`).join('\n');

      const dummyTestTakerXml = `<?xml version="1.0" encoding="utf-8"?>
<TestTakers>
  <Metadata>
    <Description>Auto-generated TestTakers file including all booklets</Description>
  </Metadata>
  <Group id="auto-generated" label="Auto-generated">
    <Login name="auto-generated" mode="run-hot-return">
${bookletRefs}
    </Login>
  </Group>
</TestTakers>`;

      const newTestTakerFile = this.fileUploadRepository.create({
        workspace_id: workspaceId,
        filename: 'auto-generated-testtakers.xml',
        file_id: 'AUTO-GENERATED-TESTTAKERS',
        file_type: 'TestTakers',
        file_size: dummyTestTakerXml.length,
        data: dummyTestTakerXml
      });

      await this.fileUploadRepository.save(newTestTakerFile);

      this.logger.log(`Created dummy TestTakers file for workspace ${workspaceId} with ${booklets.length} booklets.`);
      return true;
    } catch (error) {
      this.logger.error(`Error creating dummy TestTakers file for workspace ${workspaceId}: ${error.message}`, error.stack);
      return false;
    }
  }

  private async processTestTaker(testTaker: FileUpload, unusedBooklets: string[] = []): Promise<ValidationData | null> {
    const xmlDocument = cheerio.load(testTaker.data, { xml: true });
    const bookletTags = xmlDocument('Booklet');
    const unitTags = xmlDocument('Unit');

    if (bookletTags.length === 0) {
      this.logger.warn('No <Booklet> elements found in the XML document.');
      return null;
    }

    this.logger.log(`Found ${bookletTags.length} <Booklet> elements.`);

    const {
      uniqueBooklets
    } = this.extractXmlData(bookletTags, unitTags);

    const { allBookletsExist, missingBooklets, bookletFiles } = await this.checkMissingBooklets(Array.from(uniqueBooklets));
    const {
      allUnitsExist,
      missingUnits,
      missingUnitsPerBooklet,
      unitFiles,
      unusedUnits,
      missingCodingSchemeRefs,
      missingDefinitionRefs,
      schemeFiles,
      definitionFiles,
      allCodingSchemesExist,
      allCodingDefinitionsExist,
      allPlayerRefsExist,
      missingPlayerRefs,
      playerFiles,
      unitsWithoutPlayer
    } = await this.checkMissingUnits(Array.from(uniqueBooklets));

    // If booklets are incomplete, all other categories should also be marked as incomplete
    const bookletComplete = allBookletsExist;

    // If units are incomplete, coding schemes, definitions, and player should also be marked as incomplete
    const unitComplete = bookletComplete && allUnitsExist;

    return {
      testTaker: testTaker.file_id,
      booklets: {
        complete: bookletComplete,
        missing: missingBooklets,
        unusedBooklets,
        files: bookletFiles
      },
      units: {
        complete: bookletComplete ? (allUnitsExist) : false,
        missing: missingUnits,
        missingUnitsPerBooklet: missingUnitsPerBooklet,
        unitsWithoutPlayer: unitsWithoutPlayer,
        unused: unusedUnits,
        files: unitFiles
      },
      schemes: {
        complete: unitComplete ? allCodingSchemesExist : false,
        missing: missingCodingSchemeRefs,
        files: schemeFiles
      },
      definitions: {
        complete: unitComplete ? allCodingDefinitionsExist : false,
        missing: missingDefinitionRefs,
        files: definitionFiles
      },
      player: {
        complete: unitComplete ? allPlayerRefsExist : false,
        missing: missingPlayerRefs,
        files: playerFiles
      }
    };
  }

  private extractXmlData(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    bookletTags: cheerio.Cheerio<any>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    unitTags: cheerio.Cheerio<any>
  ): {
      uniqueBooklets: Set<string>;
      uniqueUnits: Set<string>;
      codingSchemeRefs: string[];
      definitionRefs: string[];
    } {
    const uniqueBooklets = new Set<string>();
    const uniqueUnits = new Set<string>();
    const codingSchemeRefs: string[] = [];
    const definitionRefs: string[] = [];

    bookletTags.each((_, booklet) => {
      const bookletValue = cheerio.load(booklet).text().trim();
      uniqueBooklets.add(bookletValue);
    });

    unitTags.each((_, unit) => {
      const $ = cheerio.load(unit);

      $('unit').each((__, codingScheme) => {
        const value = $(codingScheme).text().trim();
        if (value) codingSchemeRefs.push(value);
      });

      $('DefinitionRef').each((__, definition) => {
        const value = $(definition).text().trim();
        if (value) definitionRefs.push(value);
      });

      const unitId = $('unit').attr('id');
      if (unitId) {
        uniqueUnits.add(unitId.trim());
      }
    });

    return {
      uniqueBooklets, uniqueUnits, codingSchemeRefs, definitionRefs
    };
  }

  async uploadTestFiles(workspace_id: number, originalFiles: FileIo[]): Promise<boolean> {
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
      }
      return failedFiles.length === 0;
    } catch (error) {
      this.logger.error(`Unexpected error while uploading files for workspace ${workspace_id}:`, error);
      return false;
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
      const xmlDocument = cheerio.load(file.buffer.toString('utf8'), { xml: true });
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
      }, ['file_id', 'workspace_id']);
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
    }, ['file_id', 'workspace_id']);
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

      // @ts-expect-error: not exact match
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

  private async checkMissingBooklets(uniqueBookletsArray: string[]): Promise<{
    allBookletsExist: boolean;
    missingBooklets: string[];
    bookletFiles: FileStatus[];
  }> {
    this.logger.log(`Checking for missing booklets among ${uniqueBookletsArray.length} unique booklet IDs`);

    const bookletFiles: FileStatus[] = [];
    const missingBooklets: string[] = [];

    for (const booklet of uniqueBookletsArray) {
      const bookletId = booklet.trim();
      if (!bookletId) continue;

      const existingBooklet = await this.fileUploadRepository.findOne({
        where: { file_id: bookletId.toUpperCase(), file_type: 'Booklet' }
      });

      const fileStatus: FileStatus = {
        filename: bookletId,
        exists: !!existingBooklet
      };

      bookletFiles.push(fileStatus);

      if (!existingBooklet) {
        missingBooklets.push(bookletId);
      }
    }

    const allBookletsExist = missingBooklets.length === 0;
    this.logger.log(`Found ${missingBooklets.length} missing booklets out of ${uniqueBookletsArray.length} total`);

    return { allBookletsExist, missingBooklets, bookletFiles };
  }

  async checkMissingUnits(bookletNames:string[]): Promise<ValidationResult> {
    try {
      const existingBooklets = await this.fileUploadRepository.findBy({
        file_type: 'Booklet',
        file_id: In(bookletNames.map(b => b.toUpperCase()))
      });

      const bookletToUnitsMap = new Map<string, string[]>();

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

          bookletToUnitsMap.set(booklet.file_id, unitIds);

          return unitIds;
        } catch (error) {
          this.logger.error(`Fehler beim Verarbeiten von Unit ${booklet.file_id}:`, error);
          return [];
        }
      });

      const allUnitIdsArrays = await Promise.all(unitIdsPromises);
      const allUnitIds = Array.from(new Set(allUnitIdsArrays.flat()));

      const allUnitsInWorkspace = await this.fileUploadRepository.findBy({
        file_type: 'Unit',
        workspace_id: existingBooklets.length > 0 ? existingBooklets[0].workspace_id : null
      });

      const unusedUnits = allUnitsInWorkspace
        .filter(unit => !allUnitIds.includes(unit.file_id.toUpperCase()))
        .map(unit => unit.file_id);

      const allUnitsUsedInBooklets = unusedUnits.length === 0;

      const chunkSize = 50;
      const unitBatches = [];

      for (let i = 0; i < allUnitIds.length; i += chunkSize) {
        const chunk = allUnitIds.slice(i, i + chunkSize);
        unitBatches.push(chunk);
      }

      const unitBatchPromises = unitBatches.map(batch => this.fileUploadRepository.find({
        where: {
          file_id: In(batch),
          workspace_id: existingBooklets.length > 0 ? existingBooklets[0].workspace_id : null
        }
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
            playerRefs: [] as string[],
            unitId: unit.file_id,
            hasPlayer: false
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
              refs.hasPlayer = true;
            }
          });

          return refs;
        } catch (error) {
          this.logger.error(`Fehler beim Verarbeiten von Unit ${unit.file_id}:`, error);
          return {
            codingSchemeRefs: [],
            definitionRefs: [],
            playerRefs: [],
            unitId: unit.file_id,
            hasPlayer: false
          };
        }
      });

      const allRefs = await Promise.all(refsPromises);

      const unitsWithoutPlayer = allRefs
        .filter(ref => !ref.hasPlayer)
        .map(ref => ref.unitId);

      const allCodingSchemeRefs = Array.from(new Set(allRefs.flatMap(ref => ref.codingSchemeRefs)));
      const allDefinitionRefs = Array.from(new Set(allRefs.flatMap(ref => ref.definitionRefs)));
      const allPlayerRefs = Array.from(new Set(allRefs.flatMap(ref => ref.playerRefs)));

      const existingResources = await this.fileUploadRepository.findBy({
        file_type: 'Resource',
        workspace_id: existingBooklets.length > 0 ? existingBooklets[0].workspace_id : null
      });

      const allResourceIds = existingResources.map(resource => resource.file_id);

      // Find missing references
      const missingCodingSchemeRefs = allCodingSchemeRefs.filter(ref => !allResourceIds.includes(ref));
      const missingDefinitionRefs = allDefinitionRefs.filter(ref => !allResourceIds.includes(ref));
      const missingPlayerRefs = allPlayerRefs.filter(ref => !allResourceIds.includes(ref));

      // Check if all references exist
      const allCodingSchemesExist = missingCodingSchemeRefs.length === 0;
      const allCodingDefinitionsExist = missingDefinitionRefs.length === 0;
      const allPlayerRefsExist = missingPlayerRefs.length === 0;

      // Find missing units
      const foundUnitIds = existingUnits.map(unit => unit.file_id.toUpperCase());
      const missingUnits = allUnitIds.filter(unitId => !foundUnitIds.includes(unitId));
      const uniqueUnits = Array.from(new Set(missingUnits));

      // Track missing units per booklet
      const missingUnitsPerBooklet: { booklet: string; missingUnits: string[] }[] = [];

      // Check each booklet for missing units
      for (const [booklet, units] of bookletToUnitsMap.entries()) {
        const missingUnitsForBooklet = units.filter(unitId => !foundUnitIds.includes(unitId));
        if (missingUnitsForBooklet.length > 0) {
          missingUnitsPerBooklet.push({
            booklet,
            missingUnits: missingUnitsForBooklet
          });
        }
      }

      const allUnitsExist = missingUnits.length === 0;

      // Create lists of all files with their match status
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
        missingUnitsPerBooklet,
        unitsWithoutPlayer,
        unitFiles,
        allUnitsUsedInBooklets,
        unusedUnits,
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
      await this.fileUploadRepository.upsert(registry, ['file_id', 'workspace_id']);
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

  async getUnitContent(workspaceId: number, unitId: number): Promise<string> {
    const unitFile = await this.fileUploadRepository.findOne({
      where: { workspace_id: workspaceId, file_id: `${unitId}` }
    });

    if (!unitFile) {
      this.logger.error(`Unit file with ID ${unitId} not found in workspace ${workspaceId}`);
      throw new Error(`Unit file with ID ${unitId} not found`);
    }

    if (!unitFile.data) {
      this.logger.error(`Unit file with ID ${unitId} has no data content`);
      throw new Error('Unit file has no data content');
    }

    return unitFile.data.toString();
  }

  async getCodingSchemeByRef(workspaceId: number, codingSchemeRef: string): Promise<FileDownloadDto | null> {
    try {
      const codingSchemeFile = await this.fileUploadRepository.findOne({
        where: {
          workspace_id: workspaceId,
          file_id: codingSchemeRef.toUpperCase()
        }
      });

      if (!codingSchemeFile) {
        this.logger.warn(`Coding scheme file '${codingSchemeRef.toUpperCase()}' not found in workspace ${workspaceId}`);
        return null;
      }

      const base64Data = codingSchemeFile.data.toString();

      return {
        filename: codingSchemeFile.filename,
        base64Data,
        mimeType: codingSchemeFile.file_type
      };
    } catch (error) {
      this.logger.error(`Error retrieving coding scheme: ${error.message}`, error.stack);
      return null;
    }
  }

  async validateVariables(workspaceId: number, page: number = 1, limit: number = 10): Promise<{ data: InvalidVariableDto[]; total: number; page: number; limit: number }> {
    if (!workspaceId) {
      this.logger.error('Workspace ID is required');
      return {
        data: [],
        total: 0,
        page,
        limit
      };
    }

    const unitFiles = await this.filesRepository.find({
      where: { workspace_id: workspaceId, file_type: 'Unit' }
    });
    const unitVariables = new Map<string, Set<string>>();
    for (const unitFile of unitFiles) {
      try {
        const xmlContent = unitFile.data.toString();
        const parsedXml = await parseStringPromise(xmlContent, { explicitArray: false });
        if (parsedXml.Unit && parsedXml.Unit.Metadata && parsedXml.Unit.Metadata.Id) {
          const unitName = parsedXml.Unit.Metadata.Id;
          const variables = new Set<string>();
          if (parsedXml.Unit.BaseVariables && parsedXml.Unit.BaseVariables.Variable) {
            const baseVariables = Array.isArray(parsedXml.Unit.BaseVariables.Variable) ?
              parsedXml.Unit.BaseVariables.Variable :
              [parsedXml.Unit.BaseVariables.Variable];
            for (const variable of baseVariables) {
              if (variable.$.alias) {
                variables.add(variable.$.alias);
              }
            }
          }
          unitVariables.set(unitName, variables);
        }
      } catch (e) { /* empty */ }
    }

    const invalidVariables: InvalidVariableDto[] = [];

    const persons = await this.personsRepository.find({
      where: { workspace_id: workspaceId, consider: true }
    });

    if (persons.length === 0) {
      this.logger.warn(`No persons found for workspace ${workspaceId}`);
      return {
        data: [],
        total: 0,
        page,
        limit
      };
    }

    const personIds = persons.map(person => person.id);

    if (personIds.length === 0) {
      this.logger.warn(`No person IDs found for workspace ${workspaceId}`);
      return {
        data: [],
        total: 0,
        page,
        limit
      };
    }

    const batchSize = 1000;
    let allUnits: Unit[] = [];

    for (let i = 0; i < personIds.length; i += batchSize) {
      const personIdsBatch = personIds.slice(i, i + batchSize);

      const unitsBatch = await this.unitRepository.createQueryBuilder('unit')
        .innerJoin('unit.booklet', 'booklet')
        .where('booklet.personid IN (:...personIdsBatch)', { personIdsBatch })
        .getMany();

      allUnits = [...allUnits, ...unitsBatch];
    }

    if (allUnits.length === 0) {
      this.logger.warn(`No units found for persons in workspace ${workspaceId}`);
      return {
        data: [],
        total: 0,
        page,
        limit
      };
    }

    const unitIds = allUnits.map(unit => unit.id);

    if (unitIds.length === 0) {
      this.logger.warn(`No unit IDs found for persons in workspace ${workspaceId}`);
      return {
        data: [],
        total: 0,
        page,
        limit
      };
    }

    let allResponses: ResponseEntity[] = [];

    for (let i = 0; i < unitIds.length; i += batchSize) {
      const unitIdsBatch = unitIds.slice(i, i + batchSize);

      const responsesBatch = await this.responseRepository.find({
        where: { unitid: In(unitIdsBatch) },
        relations: ['unit']
      });

      allResponses = [...allResponses, ...responsesBatch];
    }

    if (allResponses.length === 0) {
      this.logger.warn(`No responses found for units in workspace ${workspaceId}`);
      return {
        data: [],
        total: 0,
        page,
        limit
      };
    }

    for (const response of allResponses) {
      const unit = response.unit;
      if (!unit) {
        this.logger.warn(`Response ${response.id} has no associated unit`);
        continue;
      }

      const unitName = unit.name;
      const variableId = response.variableid;

      if (!variableId) {
        this.logger.warn(`Response ${response.id} has no variable ID`);
        continue;
      }

      if (!unitVariables.has(unitName)) {
        invalidVariables.push({
          fileName: `${unitName}`,
          variableId: variableId,
          value: response.value || '',
          responseId: response.id,
          errorReason: 'Unit not found'
        });
        continue;
      }

      const unitVars = unitVariables.get(unitName);
      if (!unitVars || !unitVars.has(variableId)) {
        invalidVariables.push({
          fileName: `${unitName}`,
          variableId: variableId,
          value: response.value || '',
          responseId: response.id,
          errorReason: 'Variable not defined in unit'
        });
      }
    }

    const validPage = Math.max(1, page);
    // Remove the 1000 item limit when limit is set to Number.MAX_SAFE_INTEGER
    const validLimit = limit === Number.MAX_SAFE_INTEGER ? limit : Math.min(Math.max(1, limit), 1000);
    const startIndex = (validPage - 1) * validLimit;
    const endIndex = startIndex + validLimit;
    const paginatedData = invalidVariables.slice(startIndex, endIndex);

    return {
      data: paginatedData,
      total: invalidVariables.length,
      page: validPage,
      limit: validLimit
    };
  }

  async validateVariableTypes(workspaceId: number, page: number = 1, limit: number = 10): Promise<{ data: InvalidVariableDto[]; total: number; page: number; limit: number }> {
    if (!workspaceId) {
      this.logger.error('Workspace ID is required');
      return {
        data: [],
        total: 0,
        page,
        limit
      };
    }

    const unitFiles = await this.filesRepository.find({
      where: { workspace_id: workspaceId, file_type: 'Unit' }
    });

    const unitVariableTypes = new Map<string, Map<string, { type: string; multiple?: boolean; nullable?: boolean }>>();

    for (const unitFile of unitFiles) {
      try {
        const xmlContent = unitFile.data.toString();
        const parsedXml = await parseStringPromise(xmlContent, { explicitArray: false });
        if (parsedXml.Unit && parsedXml.Unit.Metadata && parsedXml.Unit.Metadata.Id) {
          const unitName = parsedXml.Unit.Metadata.Id;
          const variableTypes = new Map<string, { type: string; multiple?: boolean; nullable?: boolean }>();

          if (parsedXml.Unit.BaseVariables && parsedXml.Unit.BaseVariables.Variable) {
            const baseVariables = Array.isArray(parsedXml.Unit.BaseVariables.Variable) ?
              parsedXml.Unit.BaseVariables.Variable :
              [parsedXml.Unit.BaseVariables.Variable];

            for (const variable of baseVariables) {
              if (variable.$.alias && variable.$.type) {
                const multiple = variable.$.multiple === 'true' || variable.$.multiple === true;
                const nullable = variable.$.nullable === 'true' || variable.$.nullable === true;
                variableTypes.set(variable.$.alias, {
                  type: variable.$.type,
                  multiple: multiple || undefined,
                  nullable: nullable || undefined
                });
              }
            }
          }

          unitVariableTypes.set(unitName, variableTypes);
        }
      } catch (e) { /* empty */ }
    }

    const invalidVariables: InvalidVariableDto[] = [];

    const persons = await this.personsRepository.find({
      where: { workspace_id: workspaceId, consider: true }
    });

    if (persons.length === 0) {
      this.logger.warn(`No persons found for workspace ${workspaceId}`);
      return {
        data: [],
        total: 0,
        page,
        limit
      };
    }

    const personIds = persons.map(person => person.id);

    if (personIds.length === 0) {
      this.logger.warn(`No person IDs found for workspace ${workspaceId}`);
      return {
        data: [],
        total: 0,
        page,
        limit
      };
    }

    const batchSize = 1000;
    let allUnits: Unit[] = [];

    for (let i = 0; i < personIds.length; i += batchSize) {
      const personIdsBatch = personIds.slice(i, i + batchSize);

      const unitsBatch = await this.unitRepository.createQueryBuilder('unit')
        .innerJoin('unit.booklet', 'booklet')
        .where('booklet.personid IN (:...personIdsBatch)', { personIdsBatch })
        .getMany();

      allUnits = [...allUnits, ...unitsBatch];
    }

    if (allUnits.length === 0) {
      this.logger.warn(`No units found for persons in workspace ${workspaceId}`);
      return {
        data: [],
        total: 0,
        page,
        limit
      };
    }

    const unitIds = allUnits.map(unit => unit.id);

    if (unitIds.length === 0) {
      this.logger.warn(`No unit IDs found for persons in workspace ${workspaceId}`);
      return {
        data: [],
        total: 0,
        page,
        limit
      };
    }

    let allResponses: ResponseEntity[] = [];

    for (let i = 0; i < unitIds.length; i += batchSize) {
      const unitIdsBatch = unitIds.slice(i, i + batchSize);

      const responsesBatch = await this.responseRepository.find({
        where: { unitid: In(unitIdsBatch) },
        relations: ['unit']
      });

      allResponses = [...allResponses, ...responsesBatch];
    }

    if (allResponses.length === 0) {
      this.logger.warn(`No responses found for units in workspace ${workspaceId}`);
      return {
        data: [],
        total: 0,
        page,
        limit
      };
    }

    for (const response of allResponses) {
      const unit = response.unit;
      if (!unit) {
        this.logger.warn(`Response ${response.id} has no associated unit`);
        continue;
      }

      const unitName = unit.name;
      const variableId = response.variableid;

      if (!variableId) {
        this.logger.warn(`Response ${response.id} has no variable ID`);
        continue;
      }

      const value = response.value || '';

      if (!unitVariableTypes.has(unitName)) {
        continue;
      }

      const variableTypes = unitVariableTypes.get(unitName);
      if (!variableTypes || !variableTypes.has(variableId)) {
        continue;
      }

      const variableInfo = variableTypes.get(variableId);
      const expectedType = variableInfo.type;
      const isMultiple = variableInfo.multiple === true;
      const isNullable = variableInfo.nullable !== false; // If nullable is undefined or true, treat as nullable

      // Check if multiple is true and value is not an array
      if (isMultiple) {
        try {
          const parsedValue = JSON.parse(value);
          if (!Array.isArray(parsedValue)) {
            invalidVariables.push({
              fileName: `${unitName}`,
              variableId: variableId,
              value: value,
              responseId: response.id,
              expectedType: `${expectedType} (array)`,
              errorReason: 'Variable has multiple=true but value is not an array'
            });
            continue;
          }
        } catch (e) {
          invalidVariables.push({
            fileName: `${unitName}`,
            variableId: variableId,
            value: value,
            responseId: response.id,
            expectedType: `${expectedType} (array)`,
            errorReason: 'Variable has multiple=true but value is not a valid JSON array'
          });
          continue;
        }
      }

      // Check if nullable is false and value is null or empty
      if (!isNullable && (!value || value.trim() === '')) {
        invalidVariables.push({
          fileName: `${unitName}`,
          variableId: variableId,
          value: value,
          responseId: response.id,
          expectedType: expectedType,
          errorReason: 'Variable has nullable=false but value is null or empty'
        });
        continue;
      }

      if (!this.isValidValueForType(value, expectedType)) {
        invalidVariables.push({
          fileName: `${unitName}`,
          variableId: variableId,
          value: value,
          responseId: response.id,
          expectedType: expectedType,
          errorReason: `Value does not match expected type: ${expectedType}`
        });
      }
    }

    const validPage = Math.max(1, page);
    // Remove the 1000 item limit when limit is set to Number.MAX_SAFE_INTEGER
    const validLimit = limit === Number.MAX_SAFE_INTEGER ? limit : Math.min(Math.max(1, limit), 1000);
    const startIndex = (validPage - 1) * validLimit;
    const endIndex = startIndex + validLimit;
    const paginatedData = invalidVariables.slice(startIndex, endIndex);

    return {
      data: paginatedData,
      total: invalidVariables.length,
      page: validPage,
      limit: validLimit
    };
  }

  private isValidValueForType(value: string, type: string): boolean {
    if (!value) {
      return true; // Skip validation for empty values
    }

    switch (type.toLowerCase()) {
      case 'string':
        return true; // All values are valid strings

      case 'no-value':
        return true; // Ignore validation for no-value type

      case 'integer':
        // Check if the value is an integer
        return /^-?\d+$/.test(value);

      case 'number':
        // Check if the value is a number (integer or decimal)
        return !Number.isNaN(Number(value)) && Number.isFinite(Number(value));

      case 'boolean': {
        // Check if the value is a boolean (true/false, 0/1, yes/no)
        const lowerValue = value.toLowerCase();
        return ['true', 'false', '0', '1', 'yes', 'no'].includes(lowerValue);
      }

      case 'json':
        try {
          JSON.parse(value);
          return true;
        } catch (e) {
          return false;
        }

      default:
        return true; // For unknown types, assume the value is valid
    }
  }

  async validateTestTakers(workspaceId: number): Promise<TestTakersValidationDto> {
    try {
      const testTakers = await this.fileUploadRepository.find({
        where: { workspace_id: workspaceId, file_type: In(['TestTakers', 'Testtakers']) }
      });

      if (!testTakers || testTakers.length === 0) {
        this.logger.warn(`No TestTakers found in workspace with ID ${workspaceId}.`);
        return {
          testTakersFound: false,
          totalGroups: 0,
          totalLogins: 0,
          totalBookletCodes: 0,
          missingPersons: []
        };
      }

      const testTakerLogins: TestTakerLoginDto[] = [];
      let totalGroups = 0;
      let totalLogins = 0;
      let totalBookletCodes = 0;

      for (const testTaker of testTakers) {
        const xmlDocument = cheerio.load(testTaker.data, { xml: true });
        const groupElements = xmlDocument('Group');

        if (groupElements.length === 0) {
          this.logger.warn(`No <Group> elements found in TestTakers file ${testTaker.file_id}.`);
          continue;
        }

        totalGroups += groupElements.length;

        // Extract data from each group
        for (let i = 0; i < groupElements.length; i += 1) {
          const groupElement = groupElements[i];
          const groupId = xmlDocument(groupElement).attr('id');
          const loginElements = xmlDocument(groupElement).find('Login');

          // Extract data from each login
          for (let j = 0; j < loginElements.length; j += 1) {
            const loginElement = loginElements[j];
            const loginName = xmlDocument(loginElement).attr('name');
            const loginMode = xmlDocument(loginElement).attr('mode');

            // Only include logins with mode "run-hot-return" or "run-hot-restart"
            if (loginMode === 'run-hot-return' || loginMode === 'run-hot-restart') {
              totalLogins += 1;

              const bookletElements = xmlDocument(loginElement).find('Booklet');
              const bookletCodes: string[] = [];

              // Extract data from each booklet
              for (let k = 0; k < bookletElements.length; k += 1) {
                const bookletElement = bookletElements[k];
                const codes = xmlDocument(bookletElement).attr('codes');
                if (codes) {
                  bookletCodes.push(codes);
                  totalBookletCodes += 1;
                }
              }

              testTakerLogins.push({
                group: groupId || '',
                login: loginName || '',
                mode: loginMode || '',
                bookletCodes
              });
            }
          }
        }
      }

      const persons = await this.personsRepository.find({
        where: { workspace_id: workspaceId, consider: true }
      });

      const missingPersons: MissingPersonDto[] = [];

      for (const person of persons) {
        const found = testTakerLogins.some(login => login.group === person.group && login.login === person.login);

        if (!found) {
          missingPersons.push({
            group: person.group,
            login: person.login,
            code: person.code,
            reason: 'Person not found in TestTakers XML'
          });
        }
      }

      return {
        testTakersFound: true,
        totalGroups,
        totalLogins,
        totalBookletCodes,
        missingPersons
      };
    } catch (error) {
      this.logger.error(`Error validating TestTakers for workspace ${workspaceId}: ${error.message}`, error.stack);
      throw error;
    }
  }

  async validateDuplicateResponses(workspaceId: number, page: number = 1, limit: number = 10): Promise<DuplicateResponsesResultDto> {
    if (!workspaceId) {
      this.logger.error('Workspace ID is required for validateDuplicateResponses');
      return {
        data: [],
        total: 0,
        page,
        limit
      };
    }

    // Get all persons in the workspace that should be considered
    const persons = await this.personsRepository.find({
      where: { workspace_id: workspaceId, consider: true }
    });

    if (persons.length === 0) {
      this.logger.warn(`No persons found for workspace ${workspaceId}`);
      return {
        data: [],
        total: 0,
        page,
        limit
      };
    }

    const personIds = persons.map(person => person.id);
    const personMap = new Map(persons.map(person => [person.id, person]));

    // Get all booklets for these persons
    const booklets = await this.bookletRepository.find({
      where: { personid: In(personIds) },
      relations: ['bookletinfo']
    });

    if (booklets.length === 0) {
      this.logger.warn(`No booklets found for persons in workspace ${workspaceId}`);
      return {
        data: [],
        total: 0,
        page,
        limit
      };
    }

    const bookletMap = new Map(booklets.map(booklet => [booklet.id, booklet]));

    // Get all units for these booklets
    const batchSize = 1000;
    let allUnits: Unit[] = [];
    const bookletIds = booklets.map(booklet => booklet.id);

    for (let i = 0; i < bookletIds.length; i += batchSize) {
      const bookletIdsBatch = bookletIds.slice(i, i + batchSize);
      const unitsBatch = await this.unitRepository.find({
        where: { bookletid: In(bookletIdsBatch) }
      });
      allUnits = [...allUnits, ...unitsBatch];
    }

    if (allUnits.length === 0) {
      this.logger.warn(`No units found for booklets in workspace ${workspaceId}`);
      return {
        data: [],
        total: 0,
        page,
        limit
      };
    }

    const unitIds = allUnits.map(unit => unit.id);
    const unitMap = new Map(allUnits.map(unit => [unit.id, unit]));

    // Get all responses for these units
    let allResponses: ResponseEntity[] = [];
    for (let i = 0; i < unitIds.length; i += batchSize) {
      const unitIdsBatch = unitIds.slice(i, i + batchSize);
      const responsesBatch = await this.responseRepository.find({
        where: { unitid: In(unitIdsBatch) }
      });
      allResponses = [...allResponses, ...responsesBatch];
    }

    if (allResponses.length === 0) {
      this.logger.warn(`No responses found for units in workspace ${workspaceId}`);
      return {
        data: [],
        total: 0,
        page,
        limit
      };
    }

    // Group responses by unitid and variableid
    const responseGroups = new Map<string, ResponseEntity[]>();
    for (const response of allResponses) {
      const key = `${response.unitid}_${response.variableid}`;
      if (!responseGroups.has(key)) {
        responseGroups.set(key, []);
      }
      responseGroups.get(key)?.push(response);
    }

    // Find groups with more than one response (duplicates)
    const duplicateResponses: DuplicateResponseDto[] = [];
    for (const [, responses] of responseGroups.entries()) {
      if (responses.length > 1) {
        // Get the first response to extract unit information
        const firstResponse = responses[0];
        const unit = unitMap.get(firstResponse.unitid);

        if (!unit) {
          this.logger.warn(`Unit not found for response ${firstResponse.id}`);
          continue;
        }

        const booklet = bookletMap.get(unit.bookletid);
        if (!booklet) {
          this.logger.warn(`Booklet not found for unit ${unit.id}`);
          continue;
        }

        const person = personMap.get(booklet.personid);
        if (!person) {
          this.logger.warn(`Person not found for booklet ${booklet.id}`);
          continue;
        }

        const bookletName = booklet.bookletinfo?.name || 'Unknown';

        duplicateResponses.push({
          unitName: unit.name,
          unitId: unit.id,
          variableId: firstResponse.variableid,
          bookletName,
          testTakerLogin: person.login,
          duplicates: responses.map(response => ({
            responseId: response.id,
            value: response.value || '',
            status: response.status
            // We don't have timestamp in the response entity, but could add if needed
          }))
        });
      }
    }

    // Sort duplicates by unitName, variableId for consistent ordering
    duplicateResponses.sort((a, b) => {
      if (a.unitName !== b.unitName) {
        return a.unitName.localeCompare(b.unitName);
      }
      return a.variableId.localeCompare(b.variableId);
    });

    // Paginate results
    const validPage = Math.max(1, page);
    const validLimit = limit === Number.MAX_SAFE_INTEGER ? limit : Math.min(Math.max(1, limit), 1000);
    const startIndex = (validPage - 1) * validLimit;
    const endIndex = startIndex + validLimit;
    const paginatedData = duplicateResponses.slice(startIndex, endIndex);

    return {
      data: paginatedData,
      total: duplicateResponses.length,
      page: validPage,
      limit: validLimit
    };
  }

  async validateResponseStatus(workspaceId: number, page: number = 1, limit: number = 10): Promise<{ data: InvalidVariableDto[]; total: number; page: number; limit: number }> {
    if (!workspaceId) {
      this.logger.error('Workspace ID is required');
      return {
        data: [],
        total: 0,
        page,
        limit
      };
    }

    const validStatusValues = ['VALUE_CHANGED', 'NOT_REACHED', 'DISPLAYED', 'UNSET', 'PARTLY_DISPLAYED'];

    const persons = await this.personsRepository.find({
      where: { workspace_id: workspaceId, consider: true }
    });

    if (persons.length === 0) {
      this.logger.warn(`No persons found for workspace ${workspaceId}`);
      return {
        data: [],
        total: 0,
        page,
        limit
      };
    }

    const personIds = persons.map(person => person.id);

    if (personIds.length === 0) {
      this.logger.warn(`No person IDs found for workspace ${workspaceId}`);
      return {
        data: [],
        total: 0,
        page,
        limit
      };
    }

    const batchSize = 1000;
    let allUnits: Unit[] = [];

    for (let i = 0; i < personIds.length; i += batchSize) {
      const personIdsBatch = personIds.slice(i, i + batchSize);

      const unitsBatch = await this.unitRepository.createQueryBuilder('unit')
        .innerJoin('unit.booklet', 'booklet')
        .where('booklet.personid IN (:...personIdsBatch)', { personIdsBatch })
        .getMany();

      allUnits = [...allUnits, ...unitsBatch];
    }

    if (allUnits.length === 0) {
      this.logger.warn(`No units found for persons in workspace ${workspaceId}`);
      return {
        data: [],
        total: 0,
        page,
        limit
      };
    }

    const unitIds = allUnits.map(unit => unit.id);

    if (unitIds.length === 0) {
      this.logger.warn(`No unit IDs found for persons in workspace ${workspaceId}`);
      return {
        data: [],
        total: 0,
        page,
        limit
      };
    }

    let allResponses: ResponseEntity[] = [];

    for (let i = 0; i < unitIds.length; i += batchSize) {
      const unitIdsBatch = unitIds.slice(i, i + batchSize);

      const responsesBatch = await this.responseRepository.find({
        where: { unitid: In(unitIdsBatch) },
        relations: ['unit'] // Include unit relation to access unit.name
      });

      allResponses = [...allResponses, ...responsesBatch];
    }

    if (allResponses.length === 0) {
      this.logger.warn(`No responses found for units in workspace ${workspaceId}`);
      return {
        data: [],
        total: 0,
        page,
        limit
      };
    }

    const invalidVariables: InvalidVariableDto[] = [];

    for (const response of allResponses) {
      const unit = response.unit;
      if (!unit) {
        this.logger.warn(`Response ${response.id} has no associated unit`);
        continue;
      }

      const unitName = unit.name;
      const variableId = response.variableid;

      if (!variableId) {
        this.logger.warn(`Response ${response.id} has no variable ID`);
        continue;
      }

      const status = response.status;

      if (!validStatusValues.includes(status)) {
        invalidVariables.push({
          fileName: `${unitName}`,
          variableId: variableId,
          value: response.value || '',
          responseId: response.id,
          errorReason: `Invalid response status: ${status}. Valid values are: ${validStatusValues.join(', ')}`
        });
      }
    }

    const validPage = Math.max(1, page);
    // Remove the 1000 item limit when limit is set to Number.MAX_SAFE_INTEGER
    const validLimit = limit === Number.MAX_SAFE_INTEGER ? limit : Math.min(Math.max(1, limit), 1000);
    const startIndex = (validPage - 1) * validLimit;
    const endIndex = startIndex + validLimit;
    const paginatedData = invalidVariables.slice(startIndex, endIndex);

    return {
      data: paginatedData,
      total: invalidVariables.length,
      page: validPage,
      limit: validLimit
    };
  }

  async validateGroupResponses(
    workspaceId: number,
    page: number = 1,
    limit: number = 10
  ): Promise<{
      testTakersFound: boolean;
      groupsWithResponses: { group: string; hasResponse: boolean }[];
      allGroupsHaveResponses: boolean;
      total: number;
      page: number;
      limit: number;
    }> {
    try {
      if (!workspaceId) {
        this.logger.error('Workspace ID is required');
        return {
          testTakersFound: false,
          groupsWithResponses: [],
          allGroupsHaveResponses: false,
          total: 0,
          page,
          limit
        };
      }
      const testTakers = await this.fileUploadRepository.find({
        where: { workspace_id: workspaceId, file_type: In(['TestTakers', 'Testtakers']) }
      });

      if (!testTakers || testTakers.length === 0) {
        this.logger.warn(`No TestTakers found in workspace with ID ${workspaceId}.`);
        return {
          testTakersFound: false,
          groupsWithResponses: [],
          allGroupsHaveResponses: false,
          total: 0,
          page,
          limit
        };
      }

      const groups: Set<string> = new Set();

      for (const testTaker of testTakers) {
        const xmlDocument = cheerio.load(testTaker.data, { xml: true });
        const groupElements = xmlDocument('Group');

        if (groupElements.length === 0) {
          this.logger.warn(`No <Group> elements found in TestTakers file ${testTaker.file_id}.`);
          continue;
        }

        // Extract data from each group
        for (let i = 0; i < groupElements.length; i += 1) {
          const groupElement = groupElements[i];
          const groupId = xmlDocument(groupElement).attr('id');
          const loginElements = xmlDocument(groupElement).find('Login');

          // Check if there's at least one login with mode "run-hot-return" or "run-hot-restart"
          let hasValidLogin = false;
          for (let j = 0; j < loginElements.length; j += 1) {
            const loginElement = loginElements[j];
            const loginMode = xmlDocument(loginElement).attr('mode');

            if (loginMode === 'run-hot-return' || loginMode === 'run-hot-restart') {
              hasValidLogin = true;
              break;
            }
          }

          // Only add groups with valid logins
          if (hasValidLogin && groupId) {
            groups.add(groupId);
          }
        }
      }

      if (groups.size === 0) {
        this.logger.warn(`No valid groups found in TestTakers files for workspace ${workspaceId}.`);
        return {
          testTakersFound: true,
          groupsWithResponses: [],
          allGroupsHaveResponses: false,
          total: 0,
          page,
          limit
        };
      }

      // Check if each group has at least one response
      const groupsWithResponses: { group: string; hasResponse: boolean }[] = [];
      let allGroupsHaveResponses = true;

      for (const group of groups) {
        // Find persons with this group ID
        const persons = await this.personsRepository.find({
          where: { workspace_id: workspaceId, group, consider: true }
        });

        if (persons.length === 0) {
          // No persons found for this group
          groupsWithResponses.push({ group, hasResponse: false });
          allGroupsHaveResponses = false;
          continue;
        }

        // Get all person IDs
        const personIds = persons.map(person => person.id);

        if (personIds.length === 0) {
          this.logger.warn(`No person IDs found for group ${group} in workspace ${workspaceId}`);
          groupsWithResponses.push({ group, hasResponse: false });
          allGroupsHaveResponses = false;
          continue;
        }

        const batchSize = 1000;
        let allUnits: Unit[] = [];

        for (let i = 0; i < personIds.length; i += batchSize) {
          const personIdsBatch = personIds.slice(i, i + batchSize);

          // Find units for this batch of person IDs
          const unitsBatch = await this.unitRepository.createQueryBuilder('unit')
            .innerJoin('unit.booklet', 'booklet')
            .where('booklet.personid IN (:...personIdsBatch)', { personIdsBatch })
            .getMany();

          allUnits = [...allUnits, ...unitsBatch];
        }

        if (allUnits.length === 0) {
          groupsWithResponses.push({ group, hasResponse: false });
          allGroupsHaveResponses = false;
          continue;
        }

        const unitIds = allUnits.map(unit => unit.id);

        if (unitIds.length === 0) {
          this.logger.warn(`No unit IDs found for group ${group} in workspace ${workspaceId}`);
          groupsWithResponses.push({ group, hasResponse: false });
          allGroupsHaveResponses = false;
          continue;
        }

        let totalResponseCount = 0;

        for (let i = 0; i < unitIds.length; i += batchSize) {
          const unitIdsBatch = unitIds.slice(i, i + batchSize);

          const responseCountBatch = await this.responseRepository.count({
            where: { unitid: In(unitIdsBatch) }
          });

          totalResponseCount += responseCountBatch;
        }

        const hasResponse = totalResponseCount > 0;
        groupsWithResponses.push({ group, hasResponse });

        if (!hasResponse) {
          allGroupsHaveResponses = false;
        }
      }

      // Apply pagination
      const validPage = Math.max(1, page);
      const validLimit = Math.max(1, limit);
      const startIndex = (validPage - 1) * validLimit;
      const endIndex = startIndex + validLimit;
      const paginatedGroupsWithResponses = groupsWithResponses.slice(startIndex, endIndex);

      return {
        testTakersFound: true,
        groupsWithResponses: paginatedGroupsWithResponses,
        allGroupsHaveResponses,
        total: groupsWithResponses.length,
        page: validPage,
        limit: validLimit
      };
    } catch (error) {
      this.logger.error(`Error validating group responses for workspace ${workspaceId}: ${error.message}`, error.stack);
      throw error;
    }
  }

  async deleteInvalidResponses(workspaceId: number, responseIds: number[]): Promise<number> {
    try {
      if (!workspaceId) {
        this.logger.error('Workspace ID is required');
        return 0;
      }

      if (!responseIds || responseIds.length === 0) {
        this.logger.warn('No response IDs provided for deletion');
        return 0;
      }

      this.logger.log(`Deleting invalid responses for workspace ${workspaceId}: ${responseIds.join(', ')}`);

      const persons = await this.personsRepository.find({
        where: { workspace_id: workspaceId, consider: true }
      });

      if (persons.length === 0) {
        this.logger.warn(`No persons found for workspace ${workspaceId}`);
        return 0;
      }

      const personIds = persons.map(person => person.id);

      if (personIds.length === 0) {
        this.logger.warn(`No person IDs found for workspace ${workspaceId}`);
        return 0;
      }

      const batchSize = 1000;
      let allUnits: Unit[] = [];

      for (let i = 0; i < personIds.length; i += batchSize) {
        const personIdsBatch = personIds.slice(i, i + batchSize);

        const unitsBatch = await this.unitRepository.createQueryBuilder('unit')
          .innerJoin('unit.booklet', 'booklet')
          .where('booklet.personid IN (:...personIdsBatch)', { personIdsBatch })
          .getMany();

        allUnits = [...allUnits, ...unitsBatch];
      }

      if (allUnits.length === 0) {
        this.logger.warn(`No units found for persons in workspace ${workspaceId}`);
        return 0;
      }

      const unitIds = allUnits.map(unit => unit.id);

      if (unitIds.length === 0) {
        this.logger.warn(`No unit IDs found for persons in workspace ${workspaceId}`);
        return 0;
      }

      let totalDeleted = 0;

      for (let i = 0; i < responseIds.length; i += batchSize) {
        const responseIdsBatch = responseIds.slice(i, i + batchSize);

        for (let j = 0; j < unitIds.length; j += batchSize) {
          const unitIdsBatch = unitIds.slice(j, j + batchSize);

          const deleteResult = await this.responseRepository.delete({
            id: In(responseIdsBatch),
            unitid: In(unitIdsBatch)
          });

          totalDeleted += deleteResult.affected || 0;
        }
      }

      this.logger.log(`Deleted ${totalDeleted} invalid responses`);
      return totalDeleted;
    } catch (error) {
      this.logger.error(`Error deleting invalid responses: ${error.message}`, error.stack);
      throw error;
    }
  }

  async deleteAllInvalidResponses(workspaceId: number, validationType: 'variables' | 'variableTypes' | 'responseStatus' | 'duplicateResponses'): Promise<number> {
    try {
      if (!workspaceId) {
        this.logger.error('Workspace ID is required');
        return 0;
      }

      this.logger.log(`Deleting all invalid responses for workspace ${workspaceId} of type ${validationType}`);

      // Handle duplicate responses
      if (validationType === 'duplicateResponses') {
        const result = await this.validateDuplicateResponses(workspaceId, 1, Number.MAX_SAFE_INTEGER);

        if (result.data.length === 0) {
          this.logger.warn(`No duplicate responses found for workspace ${workspaceId}`);
          return 0;
        }

        // Extract all response IDs from all duplicates
        const responseIds: number[] = [];
        for (const duplicateResponse of result.data) {
          // For each duplicate response, we take all but the first response ID
          // This keeps one response and deletes the duplicates
          if (duplicateResponse.duplicates.length > 1) {
            // Get all duplicate response IDs (skip the first one to keep it)
            const duplicateIds = duplicateResponse.duplicates
              .slice(1) // Skip the first one to keep it
              .map(duplicate => duplicate.responseId);
            responseIds.push(...duplicateIds);
          }
        }

        if (responseIds.length === 0) {
          this.logger.warn(`No duplicate response IDs found for workspace ${workspaceId}`);
          return 0;
        }

        return await this.deleteInvalidResponses(workspaceId, responseIds);
      }

      // Handle other validation types (variables, variableTypes, responseStatus)
      let invalidResponses: InvalidVariableDto[] = [];

      if (validationType === 'variables') {
        const result = await this.validateVariables(workspaceId, 1, Number.MAX_SAFE_INTEGER);
        invalidResponses = result.data;
      } else if (validationType === 'variableTypes') {
        const result = await this.validateVariableTypes(workspaceId, 1, Number.MAX_SAFE_INTEGER);
        invalidResponses = result.data;
      } else if (validationType === 'responseStatus') {
        const result = await this.validateResponseStatus(workspaceId, 1, Number.MAX_SAFE_INTEGER);
        invalidResponses = result.data;
      }

      if (invalidResponses.length === 0) {
        this.logger.warn(`No invalid responses found for workspace ${workspaceId} of type ${validationType}`);
        return 0;
      }

      const responseIds = invalidResponses
        .filter(variable => variable.responseId !== undefined)
        .map(variable => variable.responseId as number);

      if (responseIds.length === 0) {
        this.logger.warn(`No response IDs found for invalid responses in workspace ${workspaceId} of type ${validationType}`);
        return 0;
      }

      return await this.deleteInvalidResponses(workspaceId, responseIds);
    } catch (error) {
      this.logger.error(`Error deleting all invalid responses: ${error.message}`, error.stack);
      throw error;
    }
  }
}
