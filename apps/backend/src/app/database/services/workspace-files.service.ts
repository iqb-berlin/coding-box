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
import { FileValidationResultDto } from '../../../../../../api-dto/files/file-validation-result.dto';
import { ResponseDto } from '../../../../../../api-dto/responses/response-dto';
import { VariableValidationDto, InvalidVariableDto } from '../../../../../../api-dto/files/variable-validation.dto';
import { ResponseEntity } from '../entities/response.entity';
import { Unit } from '../entities/unit.entity';
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
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    @InjectRepository(Unit)
    private unitRepository: Repository<Unit>,
    @InjectRepository(FileUpload)
    private filesRepository: Repository<FileUpload>,
    @InjectRepository(Persons)
    private personsRepository: Repository<Persons>
  ) {}

  async findFiles(
    workspaceId: number,
    options?: { page: number; limit: number; fileType?: string; fileSize?: string; searchText?: string }
  ): Promise<[FilesDto[], number]> {
    this.logger.log(`Fetching test files for workspace: ${workspaceId}`);
    const {
      page = 1, limit = 20, fileType, fileSize, searchText
    } = options || {};
    const MAX_LIMIT = 10000;
    const validPage = Math.max(1, page);
    const validLimit = Math.min(Math.max(1, limit), MAX_LIMIT);

    // QueryBuilder für flexible Filterung
    let qb = this.fileUploadRepository.createQueryBuilder('file')
      .where('file.workspace_id = :workspaceId', { workspaceId });

    if (fileType) {
      qb = qb.andWhere('file.file_type = :fileType', { fileType });
    }

    if (fileSize) {
      // fileSize-Filter: z.B. '0-10KB', '10KB-100KB', '100KB-1MB', '1MB-10MB', '10MB+'
      const KB = 1024;
      const MB = 1024 * KB;
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
    return [files, total];
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

      const validationResultsPromises = testTakers.map(testTaker => this.processTestTaker(testTaker));
      const validationResults = (await Promise.all(validationResultsPromises)).filter(Boolean);

      if (validationResults.length > 0) {
        return {
          testTakersFound: true,
          validationResults
        };
      }

      const booklets = await this.fileUploadRepository.find({
        where: { workspace_id: workspaceId, file_type: 'Booklet' }
      });

      if (!booklets || booklets.length === 0) {
        this.logger.warn(`No booklets found in workspace with ID ${workspaceId}.`);
        return {
          testTakersFound: true,
          validationResults: this.createEmptyValidationData()
        };
      }

      return {
        testTakersFound: true,
        validationResults: this.createEmptyValidationData()
      };
    } catch (error) {
      this.logger.error(`Error during test file validation for workspace ID ${workspaceId}: ${error.message}`, error.stack);
      throw error;
    }
  }

  private createEmptyValidationData(): ValidationData[] {
    return [{
      testTaker: '',
      booklets: { complete: false, missing: [], files: [] },
      units: { complete: false, missing: [], files: [] },
      schemes: { complete: false, missing: [], files: [] },
      definitions: { complete: false, missing: [], files: [] },
      player: { complete: false, missing: [], files: [] }
    }];
  }

  private async processTestTaker(testTaker: FileUpload): Promise<ValidationData | null> {
    const xmlDocument = cheerio.load(testTaker.data, { xmlMode: true, recognizeSelfClosing: true });
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
      unitFiles,
      missingCodingSchemeRefs,
      missingDefinitionRefs,
      schemeFiles,
      definitionFiles,
      allCodingSchemesExist,
      allCodingDefinitionsExist,
      allPlayerRefsExist,
      missingPlayerRefs,
      playerFiles
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
        files: bookletFiles
      },
      units: {
        complete: bookletComplete ? allUnitsExist : false,
        missing: missingUnits,
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
    bookletTags: cheerio.Cheerio<cheerio.Element>,
    unitTags: cheerio.Cheerio<cheerio.Element>
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
      if (!metaDataElement.length) {
        console.error('Meta-data <script> tag not found');
      }

      const metadata = JSON.parse(metaDataElement.text());
      if (!metadata.id || !metadata.version) {
        console.error('Invalid metadata structure: Missing id or version');
      }

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

  /**
   * Retrieves the XML content of a unit file
   * @param workspaceId The ID of the workspace
   * @param unitId The ID of the unit
   * @returns The XML content of the unit file
   */
  async getUnitContent(workspaceId: number, unitId: number): Promise<string> {
    try {
      console.log(`Retrieving unit content for workspace ${workspaceId} and unit ${unitId}`);
      const unitFile = await this.fileUploadRepository.findOne({
        where: { workspace_id: workspaceId, file_id: `${unitId}` }
      });

      if (!unitFile) {
        this.logger.error(`Unit file with ID ${unitId} not found in workspace ${workspaceId}`);
        throw new Error(`Unit file with ID ${unitId} not found`);
      }

      if (unitFile.data) {
        return unitFile.data.toString();
      }

      throw new Error('Unit file has no data content');
    } catch (error) {
      this.logger.error(`Error retrieving unit content: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Extracts the CodingSchemeRef from an XML string
   * @param xmlContent The XML content to parse
   * @returns The coding scheme reference name or null if not found
   */
  extractCodingSchemeRef(xmlContent: string): string | null {
    try {
      // Verwende cheerio, um das XML zu parsen
      const $ = cheerio.load(xmlContent, { xmlMode: true, recognizeSelfClosing: true });

      // Suche nach dem CodingSchemeRef-Tag
      const codingSchemeRefTag = $('CodingSchemeRef');

      if (codingSchemeRefTag.length > 0) {
        // Hole den Text-Inhalt des Tags
        return codingSchemeRefTag.text().trim();
      }

      return null;
    } catch (error) {
      this.logger.error(`Error extracting CodingSchemeRef: ${error.message}`, error.stack);
      return null;
    }
  }

  /**
   * Finds a coding scheme file by its reference name
   * @param workspaceId The ID of the workspace
   * @param codingSchemeRef The reference name of the coding scheme
   * @returns The coding scheme file data
   */
  async getCodingSchemeByRef(workspaceId: number, codingSchemeRef: string): Promise<FileDownloadDto | null> {
    try {
      console.log(`Retrieving coding scheme for workspace ${workspaceId} with reference ${codingSchemeRef}`);
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

  async validateVariables(workspaceId: number): Promise<VariableValidationDto> {
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
                console.log(variable.$.alias);
                variables.add(variable.$.alias);
              }
            }
          }
          unitVariables.set(unitName, variables);
        }
      } catch (e) {
        console.error(`Could not parse Unit file ${unitFile.filename}: ${e.message}`);
      }
    }
    console.log(`Found ${unitVariables.size} units with variables in workspace ${workspaceId}`);
    console.log(`Unit variables: ${JSON.stringify(Array.from(unitVariables.entries()))}`);

    const invalidVariables: InvalidVariableDto[] = [];

    // Find all persons with the given workspace_id
    const persons = await this.personsRepository.find({
      where: { workspace_id: workspaceId }
    });

    if (persons.length === 0) {
      this.logger.warn(`No persons found for workspace ${workspaceId}`);
      return {
        checkedFiles: unitFiles.length,
        invalidVariables
      };
    }

    // Get all person IDs
    const personIds = persons.map(person => person.id);

    // Find all units that belong to booklets that belong to these persons
    const units = await this.unitRepository.createQueryBuilder('unit')
      .innerJoin('unit.booklet', 'booklet')
      .where('booklet.personid IN (:...personIds)', { personIds })
      .getMany();

    if (units.length === 0) {
      this.logger.warn(`No units found for persons in workspace ${workspaceId}`);
      return {
        checkedFiles: unitFiles.length,
        invalidVariables
      };
    }

    // Get all unit IDs
    const unitIds = units.map(unit => unit.id);

    // Find all responses that belong to these units
    const responses = await this.responseRepository.find({
      where: { unitid: In(unitIds) },
      relations: ['unit'] // Include unit relation to access unit.name
    });

    console.log(`Found ${responses.length} responses for units in workspace ${workspaceId}`);

    // Check each response
    for (const response of responses) {
      const unit = response.unit;
      if (!unit) {
        this.logger.warn(`Response ${response.id} has no associated unit`);
        continue;
      }

      const unitName = unit.name;
      const variableId = response.variableid;

      // Check if the unit name exists in unitVariables
      if (!unitVariables.has(unitName)) {
        invalidVariables.push({
          fileName: `Unit ${unitName}`,
          variableId: variableId,
          value: response.value || '',
          responseId: response.id
        });
        continue;
      }

      // Check if the variable ID exists in the unit's variables
      const unitVars = unitVariables.get(unitName);
      if (!unitVars || !unitVars.has(variableId)) {
        invalidVariables.push({
          fileName: `Unit ${unitName}`,
          variableId: variableId,
          value: response.value || '',
          responseId: response.id
        });
      }
    }

    return {
      checkedFiles: unitFiles.length,
      invalidVariables
    };
  }

  /**
   * Deletes invalid responses from the database
   * @param workspaceId The ID of the workspace
   * @param responseIds Array of response IDs to delete
   * @returns Number of deleted responses
   */
  async deleteInvalidResponses(workspaceId: number, responseIds: number[]): Promise<number> {
    try {
      this.logger.log(`Deleting invalid responses for workspace ${workspaceId}: ${responseIds.join(', ')}`);

      // Verify that the responses belong to units that belong to persons in the workspace
      const persons = await this.personsRepository.find({
        where: { workspace_id: workspaceId }
      });

      if (persons.length === 0) {
        this.logger.warn(`No persons found for workspace ${workspaceId}`);
        return 0;
      }

      const personIds = persons.map(person => person.id);

      const units = await this.unitRepository.createQueryBuilder('unit')
        .innerJoin('unit.booklet', 'booklet')
        .where('booklet.personid IN (:...personIds)', { personIds })
        .getMany();

      if (units.length === 0) {
        this.logger.warn(`No units found for persons in workspace ${workspaceId}`);
        return 0;
      }

      const unitIds = units.map(unit => unit.id);

      // Delete responses that match the given IDs and belong to the units in the workspace
      const deleteResult = await this.responseRepository.delete({
        id: In(responseIds),
        unitid: In(unitIds)
      });

      this.logger.log(`Deleted ${deleteResult.affected} invalid responses`);
      return deleteResult.affected || 0;
    } catch (error) {
      this.logger.error(`Error deleting invalid responses: ${error.message}`, error.stack);
      throw error;
    }
  }
}
