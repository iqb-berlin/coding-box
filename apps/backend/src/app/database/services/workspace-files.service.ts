import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as cheerio from 'cheerio';
import AdmZip = require('adm-zip');
import * as fs from 'fs';
import * as path from 'path';
import * as libxmljs from 'libxmljs2';
import FileUpload from '../entities/file_upload.entity';
import { FilesDto } from '../../../../../../api-dto/files/files.dto';
import { FileIo } from '../../admin/workspace/file-io.interface';
import { FileDownloadDto } from '../../../../../../api-dto/files/file-download.dto';
import { FileValidationResultDto } from '../../../../../../api-dto/files/file-validation-result.dto';

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
    private fileUploadRepository: Repository<FileUpload>
  ) {}

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

  private async handleXmlFile(workspaceId: number, file: FileIo): Promise<void> {
    this.logger.log(`Processing XML file: ${file.originalname} for workspace ${workspaceId}`);
    try {
      const fileContent = file.buffer.toString('utf8');
      const $ = cheerio.load(fileContent, { xmlMode: true });

      let fileType = 'Resource';
      let fileId = file.originalname.toUpperCase();

      if ($('Testtakers').length > 0) {
        fileType = 'TestTakers';
        fileId = 'TESTTAKERS.XML';
      } else if ($('Booklet').length > 0) {
        fileType = 'Booklet';
        const bookletId = $('Booklet').attr('id');
        if (bookletId) {
          fileId = bookletId.toUpperCase();
        }
      } else if ($('Unit').length > 0) {
        fileType = 'Unit';
        const unitId = $('Unit').attr('id');
        if (unitId) {
          fileId = unitId.toUpperCase();
        }
      } else if ($('SysCheck').length > 0) {
        fileType = 'SysCheck';
        const sysCheckId = $('SysCheck').attr('id');
        if (sysCheckId) {
          fileId = sysCheckId.toUpperCase();
        }
      }

      const fileUpload = this.fileUploadRepository.create({
        workspace_id: workspaceId,
        filename: file.originalname,
        file_id: fileId,
        file_type: fileType,
        file_size: file.size,
        data: fileContent
      });

      await this.fileUploadRepository.save(fileUpload);
      this.logger.log(`Successfully processed XML file: ${file.originalname} as ${fileType} with ID ${fileId}`);
    } catch (error) {
      this.logger.error(`Error processing XML file ${file.originalname}: ${error.message}`, error.stack);
      throw error;
    }
  }

  private async handleHtmlFile(workspaceId: number, file: FileIo): Promise<void> {
    this.logger.log(`Processing HTML file: ${file.originalname} for workspace ${workspaceId}`);
    try {
      const fileUpload = this.fileUploadRepository.create({
        workspace_id: workspaceId,
        filename: file.originalname,
        file_id: file.originalname.toUpperCase(),
        file_type: 'Resource',
        file_size: file.size,
        data: file.buffer.toString('utf8')
      });

      await this.fileUploadRepository.save(fileUpload);
      this.logger.log(`Successfully processed HTML file: ${file.originalname}`);
    } catch (error) {
      this.logger.error(`Error processing HTML file ${file.originalname}: ${error.message}`, error.stack);
      throw error;
    }
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

  private async checkMissingUnits(bookletNames: string[]): Promise<ValidationResult> {
    this.logger.log(`Checking for missing units in ${bookletNames.length} booklets`);

    const unitRefs = new Set<string>();
    const playerRefs = new Set<string>();
    const codingSchemeRefs = new Set<string>();
    const definitionRefs = new Set<string>();

    // Get all booklet files
    const booklets = await this.fileUploadRepository.find({
      where: { file_id: In(bookletNames.map(b => b.toUpperCase())), file_type: 'Booklet' }
    });

    // Extract unit references from booklets
    for (const booklet of booklets) {
      try {
        const $ = cheerio.load(booklet.data, { xmlMode: true });
        $('Unit').each((_, element) => {
          const unitId = $(element).text().trim();
          if (unitId) {
            unitRefs.add(unitId.toUpperCase());
          }

          const playerIdAttr = $(element).attr('player');
          if (playerIdAttr) {
            playerRefs.add(playerIdAttr.toUpperCase());
          }
        });
      } catch (error) {
        this.logger.error(`Error parsing booklet ${booklet.file_id}: ${error.message}`);
      }
    }

    // Process in batches to avoid excessive memory usage
    const unitRefsArray = Array.from(unitRefs);
    const batchSize = 100;
    const unitBatches = [];

    for (let i = 0; i < unitRefsArray.length; i += batchSize) {
      unitBatches.push(unitRefsArray.slice(i, i + batchSize));
    }

    // Get all unit files and extract coding scheme and definition references
    for (const batch of unitBatches) {
      const units = await this.fileUploadRepository.find({
        where: { file_id: In(batch.map(unit => unit.toUpperCase())), file_type: 'Unit' }
      });

      for (const unit of units) {
        try {
          const $ = cheerio.load(unit.data, { xmlMode: true });
          $('CodingSchemeRef').each((_, element) => {
            const schemeRef = $(element).text().trim();
            if (schemeRef) {
              codingSchemeRefs.add(schemeRef.toUpperCase());
            }

            // Check for player references in unit files
            const playerIdAttr = $(element).attr('player');
            if (playerIdAttr) {
              playerRefs.add(playerIdAttr.toUpperCase());
            }
          });

          $('DefinitionRef').each((_, element) => {
            const defRef = $(element).text().trim();
            if (defRef) {
              definitionRefs.add(defRef.toUpperCase());
            }

            // Check for player references in unit files
            const playerIdAttr = $(element).attr('player');
            if (playerIdAttr) {
              playerRefs.add(playerIdAttr.toUpperCase());
            }
          });

          // Check for player references directly on Unit element
          const playerIdAttr = $('Unit').attr('player');
          if (playerIdAttr) {
            playerRefs.add(playerIdAttr.toUpperCase());
          }
        } catch (error) {
          this.logger.error(`Error parsing unit ${unit.file_id}: ${error.message}`);
        }
      }
    }

    // Check which units exist
    const unitFiles: FileStatus[] = [];
    const missingUnits: string[] = [];

    for (const unitId of unitRefs) {
      const existingUnit = await this.fileUploadRepository.findOne({
        where: { file_id: unitId, file_type: 'Unit' }
      });

      unitFiles.push({
        filename: unitId,
        exists: !!existingUnit
      });

      if (!existingUnit) {
        missingUnits.push(unitId);
      }
    }

    // Check which coding schemes exist
    const schemeFiles: FileStatus[] = [];
    const missingCodingSchemeRefs: string[] = [];

    for (const ref of codingSchemeRefs) {
      const existingScheme = await this.fileUploadRepository.findOne({
        where: { file_id: ref }
      });

      schemeFiles.push({
        filename: ref,
        exists: !!existingScheme
      });

      if (!existingScheme) {
        missingCodingSchemeRefs.push(ref);
      }
    }

    // Check which definitions exist
    const definitionFiles: FileStatus[] = [];
    const missingDefinitionRefs: string[] = [];

    for (const ref of definitionRefs) {
      const existingDefinition = await this.fileUploadRepository.findOne({
        where: { file_id: ref }
      });

      definitionFiles.push({
        filename: ref,
        exists: !!existingDefinition
      });

      if (!existingDefinition) {
        missingDefinitionRefs.push(ref);
      }
    }

    // Check which players exist
    const playerFiles: FileStatus[] = [];
    const missingPlayerRefs: string[] = [];

    for (const ref of playerRefs) {
      const existingPlayer = await this.fileUploadRepository.findOne({
        where: { file_id: ref }
      });

      playerFiles.push({
        filename: ref,
        exists: !!existingPlayer
      });

      if (!existingPlayer) {
        missingPlayerRefs.push(ref);
      }
    }

    return {
      allUnitsExist: missingUnits.length === 0,
      missingUnits,
      unitFiles,
      allCodingSchemesExist: missingCodingSchemeRefs.length === 0,
      allCodingDefinitionsExist: missingDefinitionRefs.length === 0,
      missingCodingSchemeRefs,
      missingDefinitionRefs,
      schemeFiles,
      definitionFiles,
      allPlayerRefsExist: missingPlayerRefs.length === 0,
      missingPlayerRefs,
      playerFiles
    };
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
}
