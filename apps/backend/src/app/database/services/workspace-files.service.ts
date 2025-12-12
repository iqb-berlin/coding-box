import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Like, Repository } from 'typeorm';
import * as cheerio from 'cheerio';
import * as path from 'path';
import { parseStringPromise } from 'xml2js';
import { VariableInfo } from '@iqbspecs/variable-info/variable-info.interface';
import FileUpload, { StructuredFileData } from '../entities/file_upload.entity';
import { FilesDto } from '../../../../../../api-dto/files/files.dto';
import { FileIo } from '../../admin/workspace/file-io.interface';
import { FileDownloadDto } from '../../../../../../api-dto/files/file-download.dto';
import { FileValidationResultDto } from '../../../../../../api-dto/files/file-validation-result.dto';
import { ResponseDto } from '../../../../../../api-dto/responses/response-dto';
import { InvalidVariableDto } from '../../../../../../api-dto/files/variable-validation.dto';
import { DuplicateResponsesResultDto } from '../../../../../../api-dto/files/duplicate-response.dto';
import { Unit } from '../entities/unit.entity';
import { UnitVariableDetailsDto } from '../../models/unit-variable-details.dto';
import { ResponseEntity } from '../entities/response.entity';
import {
  MissingPersonDto,
  TestTakerLoginDto,
  TestTakersValidationDto
} from '../../../../../../api-dto/files/testtakers-validation.dto';
import Persons from '../entities/persons.entity';
import { CodingStatisticsService } from './coding-statistics.service';
import { WorkspaceXmlSchemaValidationService } from './workspace-xml-schema-validation.service';
import { WorkspaceFileStorageService } from './workspace-file-storage.service';
import { WorkspaceFileParsingService } from './workspace-file-parsing.service';
import { WorkspaceResponseValidationService } from './workspace-response-validation.service';
import { WorkspaceTestFilesValidationService } from './workspace-test-files-validation.service';

@Injectable()
export class WorkspaceFilesService implements OnModuleInit {
  private readonly logger = new Logger(WorkspaceFilesService.name);
  private unitVariableCache: Map<number, Map<string, Set<string>>> = new Map();

  constructor(
    @InjectRepository(FileUpload)
    private fileUploadRepository: Repository<FileUpload>,
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    @InjectRepository(Unit)
    private unitRepository: Repository<Unit>,
    @InjectRepository(Persons)
    private personsRepository: Repository<Persons>,
    private codingStatisticsService: CodingStatisticsService,
    private workspaceXmlSchemaValidationService: WorkspaceXmlSchemaValidationService,
    private workspaceFileStorageService: WorkspaceFileStorageService,
    private workspaceFileParsingService: WorkspaceFileParsingService,
    private workspaceResponseValidationService: WorkspaceResponseValidationService,
    private workspaceTestFilesValidationService: WorkspaceTestFilesValidationService
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
          qb = qb.andWhere('file.file_size >= :min AND file.file_size < :max', { min: 100 * KB, max: MB });
          break;
        case '1MB-10MB':
          qb = qb.andWhere('file.file_size >= :min AND file.file_size < :max', { min: MB, max: 10 * MB });
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
    const numericIds = fileIds.map(id => parseInt(id, 10)).filter(id => !Number.isNaN(id));
    const res = await this.fileUploadRepository.delete({
      id: In(numericIds),
      workspace_id: workspace_id
    });

    // Invalidate coding statistics cache since test files changed
    await this.codingStatisticsService.invalidateCache(workspace_id);

    return !!res;
  }

  async validateTestFiles(workspaceId: number): Promise<FileValidationResultDto> {
    return this.workspaceTestFilesValidationService.validateTestFiles(workspaceId);
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

  async getUnitsWithFileIds(workspaceId: number): Promise<{ id: number; unitId: string; fileName: string; data: string }[]> {
    try {
      const units = await this.fileUploadRepository.find({
        where: { workspace_id: workspaceId, file_type: 'Resource', file_id: Like('%.VOCS') }
      });

      if (!units || units.length === 0) {
        this.logger.warn(`No schmemes found in workspace with ID ${workspaceId}.`);
        return [];
      }

      return units.map(unit => ({
        id: unit.id,
        unitId: unit.file_id,
        fileName: unit.filename,
        data: unit.data
      }));
    } catch (error) {
      this.logger.error(`Error getting units with file IDs for workspace ${workspaceId}: ${error.message}`, error.stack);
      return [];
    }
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
      await this.codingStatisticsService.invalidateCache(workspace_id);
      await this.codingStatisticsService.invalidateIncompleteVariablesCache(workspace_id);

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

    let base64Data: string;
    try {
      // If data is already base64-encoded (binary files), use it directly
      // Base64 strings are valid UTF-8 and contain specific character patterns
      if (/^[A-Za-z0-9+/]*={0,2}$/.test(file.data) && file.data.length % 4 === 0) {
        base64Data = file.data;
        this.logger.log(`File ${file.filename} already stored as base64.`);
      } else {
        // For UTF-8 text files, convert the string to base64
        base64Data = Buffer.from(file.data, 'utf8').toString('base64');
        this.logger.log(`File ${file.filename} converted from UTF-8 to base64.`);
      }
    } catch (error) {
      this.logger.warn(`Failed to process file data for ${file.filename}, falling back to binary conversion: ${error.message}`);
      base64Data = Buffer.from(file.data, 'binary').toString('base64');
    }

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

      let xmlValidation: { schemaValid: boolean; errors: string[] };
      try {
        xmlValidation = await this.workspaceXmlSchemaValidationService.validateXmlViaXsdUrl(xmlContent);
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Unknown XML schema validation error';
        return this.unsupportedFile(message);
      }

      if (!xmlValidation.schemaValid) {
        const maxErrors = 10;
        const errorsPreview = (xmlValidation.errors || []).slice(0, maxErrors);
        this.logger.warn(
          `XSD validation failed on upload: ${file.originalname} (errors: ${xmlValidation.errors.length}) ${JSON.stringify(errorsPreview)}`
        );
        return this.unsupportedFile(`XSD validation failed: ${file.originalname}`);
      }

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

      let extractedInfo: Record<string, unknown> = {};
      try {
        if (fileType === 'Unit') {
          extractedInfo = await this.workspaceFileParsingService.extractUnitInfo(xmlDocument);
        } else if (fileType === 'Booklet') {
          extractedInfo = await this.workspaceFileParsingService.extractBookletInfo(xmlDocument);
        } else if (fileType === 'TestTakers') {
          extractedInfo = await this.workspaceFileParsingService.extractTestTakersInfo(xmlDocument);
        }
        this.logger.log(`Extracted information from ${fileType} file: ${JSON.stringify(extractedInfo)}`);
      } catch (extractError) {
        this.logger.error(`Error extracting information from ${fileType} file: ${extractError.message}`);
      }

      const structuredData: StructuredFileData = {
        extractedInfo
      };

      return await this.fileUploadRepository.upsert({
        workspace_id: workspaceId,
        filename: file.originalname,
        file_type: fileType,
        file_size: file.size,
        data: file.buffer.toString(),
        file_id: resolvedFileId,
        structured_data: structuredData
      }, ['file_id', 'workspace_id']);
    } catch (error) {
      this.logger.error(`Error processing XML file: ${error.message}`);
      throw error;
    }
  }

  private async handleHtmlFile(workspaceId: number, file: FileIo): Promise<unknown> {
    try {
      const playerCode = file.buffer.toString();
      const playerContent = cheerio.load(playerCode);
      const metaDataElement = playerContent('script[type="application/ld+json"]');
      let metadata = {};

      try {
        metadata = JSON.parse(metaDataElement.text());
      } catch (metadataError) {
        this.logger.warn(`Error parsing metadata from HTML file: ${metadataError.message}`);
      }
      const structuredData: StructuredFileData = {
        metadata
      };

      if (metadata['@type'] === 'schemer') {
        const resourceFileId = this.workspaceFileParsingService.getSchemerId(file);
        return await this.fileUploadRepository.upsert({
          filename: file.originalname,
          workspace_id: workspaceId,
          file_type: 'Schemer',
          file_size: file.size,
          file_id: resourceFileId,
          data: file.buffer.toString(),
          structured_data: structuredData
        }, ['file_id', 'workspace_id']);
      }

      const resourceFileId = this.workspaceFileParsingService.getPlayerId(file);
      return await this.fileUploadRepository.upsert({
        filename: file.originalname,
        workspace_id: workspaceId,
        file_type: 'Resource',
        file_size: file.size,
        file_id: resourceFileId,
        data: file.buffer.toString(),
        structured_data: structuredData
      }, ['file_id', 'workspace_id']);
    } catch (error) {
      const resourceFileId = this.workspaceFileParsingService.getResourceId(file);
      return this.fileUploadRepository.upsert({
        filename: file.originalname,
        workspace_id: workspaceId,
        file_type: 'Resource',
        file_size: file.size,
        file_id: resourceFileId,
        data: file.buffer.toString(),
        structured_data: { metadata: {} }
      }, ['file_id', 'workspace_id']);
    }
  }

  private async handleOctetStreamFile(workspaceId: number, file: FileIo): Promise<void> {
    this.logger.log(`Processing octet-stream file: ${file.originalname} for workspace ${workspaceId}`);
    try {
      const fileExtension = path.extname(file.originalname).toLowerCase();
      let fileType = 'Resource';
      let fileContent: string | Buffer;
      let extractedInfo = {};

      const textFileExtensions = ['.xml', '.html', '.htm', '.xhtml', '.txt', '.json', '.csv', '.voud', '.vocs', '.vomd'];

      if (textFileExtensions.includes(fileExtension)) {
        // For text files, convert buffer to UTF8 string
        fileContent = file.buffer.toString('utf8');
      } else {
        // For binary files, convert to base64 to ensure valid UTF8 storage in database
        fileContent = file.buffer.toString('base64');
      }

      if (fileExtension === '.xml') {
        try {
          const $ = cheerio.load(fileContent as string, { xmlMode: true });
          if ($('Testtakers').length > 0) {
            fileType = 'TestTakers';
            extractedInfo = {
              rootElement: 'Testtakers',
              detectedVia: 'octet-stream-handler'
            };
          } else if ($('Booklet').length > 0) {
            fileType = 'Booklet';
            extractedInfo = {
              rootElement: 'Booklet',
              detectedVia: 'octet-stream-handler'
            };
          } else if ($('Unit').length > 0) {
            fileType = 'Unit';
            extractedInfo = {
              rootElement: 'Unit',
              detectedVia: 'octet-stream-handler'
            };
          } else if ($('SysCheck').length > 0) {
            fileType = 'SysCheck';
            extractedInfo = {
              rootElement: 'SysCheck',
              detectedVia: 'octet-stream-handler'
            };
          }
        } catch (error) {
          this.logger.warn(`Could not parse XML content for ${file.originalname}: ${error.message}`);
        }
      }

      const structuredData: StructuredFileData = {
        extractedInfo
      };

      const fileUpload = this.fileUploadRepository.create({
        workspace_id: workspaceId,
        filename: file.originalname,
        file_id: file.originalname.toUpperCase(),
        file_type: fileType,
        file_size: file.size,
        data: fileContent,
        structured_data: structuredData
      });

      await this.fileUploadRepository.upsert(fileUpload, ['file_id', 'workspace_id']);
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
      const fileIos = this.workspaceFileStorageService.unzipToFileIos(file.buffer);
      this.logger.log(`Found ${fileIos.length} entries in ZIP file ${file.originalname}`);

      fileIos.forEach(fileIo => {
        promises.push(...this.handleFile(workspaceId, fileIo));
      });

      return promises;
    } catch (error) {
      this.logger.error(`Error processing ZIP file ${file.originalname}: ${error.message}`, error.stack);
      return [Promise.reject(error)];
    }
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

  async getTestTakerContent(workspaceId: number, testTakerId: string): Promise<string> {
    const testTakerFile = await this.fileUploadRepository.findOne({
      where: {
        workspace_id: workspaceId,
        file_type: In(['TestTakers', 'Testtakers']),
        file_id: testTakerId
      }
    });

    if (!testTakerFile) {
      this.logger.error(`TestTakers file with ID ${testTakerId} not found in workspace ${workspaceId}`);
      throw new Error(`TestTakers file with ID ${testTakerId} not found`);
    }

    if (!testTakerFile.data) {
      this.logger.error(`TestTakers file with ID ${testTakerId} has no data content`);
      throw new Error('TestTakers file has no data content');
    }

    return testTakerFile.data.toString();
  }

  async getCodingSchemeByRef(workspaceId: number, codingSchemeRef: string): Promise<FileDownloadDto | null> {
    try {
      const fileId = codingSchemeRef.toUpperCase().endsWith('.VOCS') ?
        codingSchemeRef.toUpperCase() :
        `${codingSchemeRef.toUpperCase()}.VOCS`;

      const codingSchemeFile = await this.fileUploadRepository.findOne({
        where: {
          workspace_id: workspaceId,
          file_id: fileId
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

  async getVariableInfoForScheme(workspaceId: number, schemeFileId: string): Promise<VariableInfo[]> {
    try {
      const unitFiles = await this.fileUploadRepository.find({
        where: {
          workspace_id: workspaceId,
          file_type: 'Unit'
        }
      });

      if (!unitFiles || unitFiles.length === 0) {
        this.logger.warn(`No Unit files found in workspace ${workspaceId}`);
        return [];
      }

      const filteredUnitFiles = unitFiles.filter(file => file.file_id.toUpperCase() === schemeFileId.toUpperCase() &&
        !file.file_id.includes('VOCS')
      );

      if (filteredUnitFiles.length === 0) {
        this.logger.warn(`No Unit files with file_id ${schemeFileId} (without VOCS) found in workspace ${workspaceId}`);
        return [];
      }

      const variableInfoArray: VariableInfo[] = [];

      for (const unitFile of filteredUnitFiles) {
        try {
          const xmlContent = unitFile.data.toString();
          const parsedXml = await parseStringPromise(xmlContent, { explicitArray: false });

          if (parsedXml.Unit && parsedXml.Unit.BaseVariables && parsedXml.Unit.BaseVariables.Variable) {
            const baseVariables = Array.isArray(parsedXml.Unit.BaseVariables.Variable) ?
              parsedXml.Unit.BaseVariables.Variable :
              [parsedXml.Unit.BaseVariables.Variable];

            for (const variable of baseVariables) {
              if (variable.$ && variable.$.alias && variable.$.type) {
                const variableInfo: VariableInfo = {
                  id: variable.$.id,
                  alias: variable.$.alias,
                  type: variable.$.type,
                  multiple: variable.$.multiple === 'true' || variable.$.multiple === true,
                  nullable: variable.$.nullable !== 'false' && variable.$.nullable !== false, // Default to true if not specified
                  values: variable.$.values ? variable.$.values.split('|') : undefined,
                  valuesComplete: variable.$.valuesComplete === 'true' || variable.$.valuesComplete === true,
                  page: variable.$.page,
                  format: '',
                  valuePositionLabels: []
                };

                variableInfoArray.push(variableInfo);
              }
            }
          }
        } catch (e) {
          this.logger.error(`Error parsing XML for unit file ${unitFile.file_id}: ${e.message}`);
        }
      }

      return variableInfoArray;
    } catch (error) {
      this.logger.error(`Error retrieving variable info: ${error.message}`, error.stack);
      return [];
    }
  }

  async downloadWorkspaceFilesAsZip(workspaceId: number): Promise<Buffer> {
    try {
      this.logger.log(`Creating ZIP file for workspace ${workspaceId}`);

      const files = await this.fileUploadRepository.find({
        where: { workspace_id: workspaceId },
        order: { file_type: 'ASC', filename: 'ASC' },
        take: 3000
      });

      if (!files || files.length === 0) {
        this.logger.error(`No files found in workspace ${workspaceId}`);
      }

      this.logger.log(`Found ${files.length} files to include in ZIP`);

      const zipBuffer = this.workspaceFileStorageService.createZipBufferFromFiles(files);
      this.logger.log(`ZIP file created successfully (${zipBuffer.length} bytes)`);

      return zipBuffer;
    } catch (error) {
      this.logger.error(`Error creating ZIP file for workspace ${workspaceId}: ${error.message}`, error.stack);
      throw new Error(`Failed to create ZIP file: ${error.message}`);
    }
  }

  async validateVariables(workspaceId: number, page: number = 1, limit: number = 10): Promise<{ data: InvalidVariableDto[]; total: number; page: number; limit: number }> {
    return this.workspaceResponseValidationService.validateVariables(workspaceId, page, limit);
  }

  async validateVariableTypes(workspaceId: number, page: number = 1, limit: number = 10): Promise<{ data: InvalidVariableDto[]; total: number; page: number; limit: number }> {
    return this.workspaceResponseValidationService.validateVariableTypes(workspaceId, page, limit);
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
      throw new Error(`Error validating TestTakers for workspace ${workspaceId}: ${error.message}`);
    }
  }

  async validateDuplicateResponses(workspaceId: number, page: number = 1, limit: number = 10): Promise<DuplicateResponsesResultDto> {
    return this.workspaceResponseValidationService.validateDuplicateResponses(workspaceId, page, limit);
  }

  async validateResponseStatus(workspaceId: number, page: number = 1, limit: number = 10): Promise<{ data: InvalidVariableDto[]; total: number; page: number; limit: number }> {
    return this.workspaceResponseValidationService.validateResponseStatus(workspaceId, page, limit);
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
      throw new Error(`Error validating group responses for workspace ${workspaceId}: ${error.message}`);
    }
  }

  async deleteInvalidResponses(workspaceId: number, responseIds: number[]): Promise<number> {
    return this.workspaceResponseValidationService.deleteInvalidResponses(workspaceId, responseIds);
  }

  async deleteAllInvalidResponses(workspaceId: number, validationType: 'variables' | 'variableTypes' | 'responseStatus' | 'duplicateResponses'): Promise<number> {
    return this.workspaceResponseValidationService.deleteAllInvalidResponses(workspaceId, validationType);
  }

  async onModuleInit(): Promise<void> {
    this.logger.log('Initializing WorkspaceFilesService - refreshing unit variable cache for all workspaces');

    try {
      const workspacesWithUnits = await this.fileUploadRepository
        .createQueryBuilder('file')
        .select('DISTINCT file.workspace_id', 'workspace_id')
        .where('file.file_type = :fileType', { fileType: 'Unit' })
        .getRawMany();

      for (const { workspaceId } of workspacesWithUnits) {
        await this.refreshUnitVariableCache(workspaceId);
      }
      this.logger.log(`Successfully initialized unit variable cache for ${workspacesWithUnits.length} workspaces`);
    } catch (error) {
      this.logger.error(`Error initializing unit variable cache: ${error.message}`, error.stack);
    }
  }

  async refreshUnitVariableCache(workspaceId: number): Promise<void> {
    this.logger.log(`Refreshing unit variable cache for workspace ${workspaceId}`);

    try {
      const unitFiles = await this.fileUploadRepository.find({
        where: { workspace_id: workspaceId, file_type: 'Unit' }
      });

      const codingSchemes = await this.fileUploadRepository.find({
        where: {
          workspace_id: workspaceId,
          file_type: 'Resource',
          file_id: Like('%.VOCS')
        }
      });

      // Create a map of unitId to parsed coding scheme for quick lookup
      const codingSchemeMap = new Map<string, Map<string, string>>();
      for (const scheme of codingSchemes) {
        try {
          const unitId = scheme.file_id.replace('.VOCS', '');
          const parsedScheme = JSON.parse(scheme.data) as {
            variableCodings?: { id: string; sourceType?: string }[]
          };
          if (parsedScheme.variableCodings && Array.isArray(parsedScheme.variableCodings)) {
            const variableSourceTypes = new Map<string, string>();
            for (const vc of parsedScheme.variableCodings) {
              if (vc.id && vc.sourceType) {
                variableSourceTypes.set(vc.id, vc.sourceType);
              }
            }
            codingSchemeMap.set(unitId, variableSourceTypes);
          }
        } catch (error) {
          this.logger.error(`Error parsing coding scheme ${scheme.file_id}: ${error.message}`, error.stack);
        }
      }

      const unitVariables: Map<string, Set<string>> = new Map();
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
                if (variable.$.alias && variable.$.type !== 'no-value') {
                  const unitSourceTypes = codingSchemeMap.get(unitName);
                  const sourceType = unitSourceTypes?.get(variable.$.alias);
                  if (sourceType !== 'BASE_NO_VALUE') {
                    variables.add(variable.$.alias);
                  }
                }
              }
            }
            unitVariables.set(unitName, variables);
          }
        } catch (e) {
          this.logger.warn(`Error parsing unit file ${unitFile.file_id}: ${(e as Error).message}`);
        }
      }

      this.unitVariableCache.set(workspaceId, unitVariables);
      this.logger.log(`Cached ${unitVariables.size} units with their variables for workspace ${workspaceId}`);
    } catch (error) {
      this.logger.error(`Error refreshing unit variable cache for workspace ${workspaceId}: ${error.message}`, error.stack);
    }
  }

  async getUnitVariableMap(workspaceId: number): Promise<Map<string, Set<string>>> {
    if (!this.unitVariableCache.has(workspaceId)) {
      await this.refreshUnitVariableCache(workspaceId);
    }
    return this.unitVariableCache.get(workspaceId) || new Map();
  }

  async getUnitVariableDetails(workspaceId: number): Promise<UnitVariableDetailsDto[]> {
    this.logger.log(`Getting detailed unit variable information for workspace ${workspaceId}`);

    try {
      const unitFiles = await this.fileUploadRepository.find({
        where: { workspace_id: workspaceId, file_type: 'Unit' }
      });

      const codingSchemes = await this.fileUploadRepository.find({
        where: {
          workspace_id: workspaceId,
          file_type: 'Resource',
          file_id: Like('%.VOCS')
        }
      });

      const codingSchemeMap = new Map<string, string>();
      const codingSchemeVariablesMap = new Map<string, Map<string, string>>();
      const codingSchemeCodesMap = new Map<string, Map<string, Array<{ id: string | number; label: string; score?: number }>>>();
      const codingSchemeManualInstructionsMap = new Map<string, Map<string, boolean>>();
      const codingSchemeClosedCodingMap = new Map<string, Map<string, boolean>>();

      for (const scheme of codingSchemes) {
        try {
          const unitId = scheme.file_id.replace('.VOCS', '');
          codingSchemeMap.set(unitId, scheme.file_id);

          const parsedScheme = JSON.parse(scheme.data) as {
            variableCodings?: {
              id: string;
              sourceType?: string;
              codes?: Array<{ id: number | string; label?: string; score?: number; manualInstruction?: string; type?: string }>;
            }[]
          };
          if (parsedScheme.variableCodings && Array.isArray(parsedScheme.variableCodings)) {
            const variableSourceTypes = new Map<string, string>();
            const variableCodes = new Map<string, Array<{ id: string | number; label: string; score?: number }>>();
            const variableManualInstructions = new Map<string, boolean>();
            const variableClosedCoding = new Map<string, boolean>();

            for (const vc of parsedScheme.variableCodings) {
              if (vc.id && vc.sourceType) {
                variableSourceTypes.set(vc.id, vc.sourceType);
              }
              if (vc.id && vc.codes && Array.isArray(vc.codes)) {
                const codes = vc.codes
                  .filter(code => code.id !== undefined)
                  .map(code => ({
                    id: code.id,
                    label: code.label || String(code.id),
                    score: code.score
                  }));
                if (codes.length > 0) {
                  variableCodes.set(vc.id, codes);
                }

                // Check if any code has manual instruction (similar to isManual() in codebook-generator)
                const hasManualInstruction = vc.codes.some(code => code.manualInstruction && code.manualInstruction.trim() !== '');
                if (hasManualInstruction) {
                  variableManualInstructions.set(vc.id, true);
                }

                // Check if any code is closed coding (similar to isClosed() in codebook-generator)
                const hasClosedCoding = vc.codes.some(code => code.type === 'RESIDUAL_AUTO' || code.type === 'INTENDED_INCOMPLETE');
                if (hasClosedCoding) {
                  variableClosedCoding.set(vc.id, true);
                }
              }
            }
            codingSchemeVariablesMap.set(unitId, variableSourceTypes);
            codingSchemeCodesMap.set(unitId, variableCodes);
            codingSchemeManualInstructionsMap.set(unitId, variableManualInstructions);
            codingSchemeClosedCodingMap.set(unitId, variableClosedCoding);
          }
        } catch (error) {
          this.logger.error(`Error parsing coding scheme ${scheme.file_id}: ${error.message}`, error.stack);
        }
      }

      const unitVariableDetails: UnitVariableDetailsDto[] = [];

      for (const unitFile of unitFiles) {
        try {
          const xmlContent = unitFile.data.toString();
          const parsedXml = await parseStringPromise(xmlContent, { explicitArray: false });

          if (parsedXml.Unit && parsedXml.Unit.Metadata && parsedXml.Unit.Metadata.Id) {
            const unitName = parsedXml.Unit.Metadata.Id;
            const variables: Array<{
              id: string;
              alias: string;
              type: 'string' | 'integer' | 'number' | 'boolean' | 'attachment' | 'json' | 'no-value';
              hasCodingScheme: boolean;
              codingSchemeRef?: string;
              codes?: Array<{ id: string | number; label: string; score?: number }>;
              isDerived?: boolean;
              hasManualInstruction?: boolean;
              hasClosedCoding?: boolean;
            }> = [];

            // Process BaseVariables
            if (parsedXml.Unit.BaseVariables && parsedXml.Unit.BaseVariables.Variable) {
              const baseVariables = Array.isArray(parsedXml.Unit.BaseVariables.Variable) ?
                parsedXml.Unit.BaseVariables.Variable :
                [parsedXml.Unit.BaseVariables.Variable];

              for (const variable of baseVariables) {
                if (variable.$.alias && variable.$.type !== 'no-value') {
                  const variableId = variable.$.id || variable.$.alias;
                  const unitSourceTypes = codingSchemeVariablesMap.get(unitName);
                  const sourceType = unitSourceTypes?.get(variableId);

                  // Skip variables with BASE_NO_VALUE sourceType in coding scheme
                  // If no coding scheme exists, sourceType is undefined and variable is included
                  if (sourceType === 'BASE_NO_VALUE') {
                    continue;
                  }

                  const hasCodingScheme = codingSchemeMap.has(unitName);
                  const unitCodes = codingSchemeCodesMap.get(unitName);
                  const variableCodes = unitCodes?.get(variableId);
                  const unitManualInstructions = codingSchemeManualInstructionsMap.get(unitName);
                  const hasManualInstruction = unitManualInstructions?.get(variableId) || false;
                  const unitClosedCoding = codingSchemeClosedCodingMap.get(unitName);
                  const hasClosedCoding = unitClosedCoding?.get(variableId) || false;

                  variables.push({
                    id: variableId,
                    alias: variable.$.alias,
                    type: variable.$.type as 'string' | 'integer' | 'number' | 'boolean' | 'attachment' | 'json' | 'no-value',
                    hasCodingScheme,
                    codingSchemeRef: hasCodingScheme ? codingSchemeMap.get(unitName) : undefined,
                    codes: variableCodes,
                    isDerived: false,
                    hasManualInstruction,
                    hasClosedCoding
                  });
                }
              }
            }

            // Process DerivedVariables (derived variables are not BASE_NO_VALUE and not BASE type)
            if (parsedXml.Unit.DerivedVariables && parsedXml.Unit.DerivedVariables.Variable) {
              const derivedVariables = Array.isArray(parsedXml.Unit.DerivedVariables.Variable) ?
                parsedXml.Unit.DerivedVariables.Variable :
                [parsedXml.Unit.DerivedVariables.Variable];

              for (const variable of derivedVariables) {
                if (variable.$.alias && variable.$.type !== 'no-value') {
                  const variableId = variable.$.id || variable.$.alias;
                  const unitSourceTypes = codingSchemeVariablesMap.get(unitName);
                  const sourceType = unitSourceTypes?.get(variableId);

                  // Skip variables with BASE_NO_VALUE sourceType in coding scheme
                  // Skip variables with BASE sourceType (include only derived variables)
                  if (sourceType === 'BASE_NO_VALUE' || sourceType === 'BASE') {
                    continue;
                  }

                  const hasCodingScheme = codingSchemeMap.has(unitName);
                  const unitCodes = codingSchemeCodesMap.get(unitName);
                  const variableCodes = unitCodes?.get(variableId);
                  const unitManualInstructions = codingSchemeManualInstructionsMap.get(unitName);
                  const hasManualInstruction = unitManualInstructions?.get(variableId) || false;
                  const unitClosedCoding = codingSchemeClosedCodingMap.get(unitName);
                  const hasClosedCoding = unitClosedCoding?.get(variableId) || false;

                  variables.push({
                    id: variableId,
                    alias: variable.$.alias,
                    type: variable.$.type as 'string' | 'integer' | 'number' | 'boolean' | 'attachment' | 'json' | 'no-value',
                    hasCodingScheme,
                    codingSchemeRef: hasCodingScheme ? codingSchemeMap.get(unitName) : undefined,
                    codes: variableCodes,
                    isDerived: true,
                    hasManualInstruction,
                    hasClosedCoding
                  });
                }
              }
            }

            // Only include units with at least one variable
            if (variables.length > 0) {
              unitVariableDetails.push({
                unitName,
                unitId: unitName,
                variables
              });
            }
          }
        } catch (e) {
          this.logger.warn(`Error parsing unit file ${unitFile.file_id}: ${(e as Error).message}`);
        }
      }

      this.logger.log(`Retrieved ${unitVariableDetails.length} units with variables for workspace ${workspaceId}`);
      return unitVariableDetails;
    } catch (error) {
      this.logger.error(`Error getting unit variable details for workspace ${workspaceId}: ${error.message}`, error.stack);
      return [];
    }
  }
}
