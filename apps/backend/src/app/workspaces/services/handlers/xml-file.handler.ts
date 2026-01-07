import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as cheerio from 'cheerio';
import {
  FileUpload, StructuredFileData
} from '../../../common';
import { FileIo } from '../../../admin/workspace/file-io.interface';
import { WorkspaceXmlSchemaValidationService } from '../workspace-xml-schema-validation.service';
import { WorkspaceFileParsingService } from '../workspace-file-parsing.service';

@Injectable()
export class XmlFileHandler {
  private readonly logger = new Logger(XmlFileHandler.name);

  constructor(
    @InjectRepository(FileUpload)
    private fileUploadRepository: Repository<FileUpload>,
    private workspaceXmlSchemaValidationService: WorkspaceXmlSchemaValidationService,
    private workspaceFileParsingService: WorkspaceFileParsingService
  ) {}

  async handleXmlFile(
    workspaceId: number,
    file: FileIo,
    overwriteExisting: boolean,
    overwriteAllowList?: Set<string>
  ): Promise<unknown> {
    try {
      if (!file.buffer || !file.buffer.length) {
        this.logger.warn('Empty file buffer');
        return await Promise.resolve();
      }

      const xmlContent = file.buffer.toString('utf8');
      const xmlDocument = cheerio.load(file.buffer.toString('utf8'), {
        xml: true
      });
      const firstChild = xmlDocument.root().children().first();
      const rootTagName = firstChild ? firstChild.prop('tagName') : null;
      const normalizedRootTagName = (rootTagName || '').toUpperCase();

      if (!normalizedRootTagName) {
        throw new Error('Invalid XML: No root tag found');
      }

      const fileTypeMapping: Record<string, string> = {
        UNIT: 'Unit',
        BOOKLET: 'Booklet',
        TESTTAKERS: 'TestTakers'
      };

      const fileType = fileTypeMapping[normalizedRootTagName];
      if (!fileType) {
        throw new Error(`Unsupported root tag: ${rootTagName}`);
      }

      let xmlValidation: { schemaValid: boolean; errors: string[] };
      try {
        xmlValidation =
          await this.workspaceXmlSchemaValidationService.validateXmlViaXsdUrl(
            xmlContent
          );
      } catch (e) {
        const message =
          e instanceof Error ?
            e.message :
            'Unknown XML schema validation error';
        throw new Error(message);
      }

      if (!xmlValidation.schemaValid) {
        const maxErrors = 10;
        const errorsPreview = (xmlValidation.errors || []).slice(0, maxErrors);
        this.logger.warn(
          `XSD validation failed on upload: ${file.originalname} (errors: ${
            xmlValidation.errors.length
          }) ${JSON.stringify(errorsPreview)}`
        );
        throw new Error(
          `XSD validation failed: ${file.originalname}`
        );
      }

      const metadata = xmlDocument('Metadata');
      const idElement = metadata.find('Id');
      const fileId = idElement.length ?
        idElement.text().toUpperCase().trim() :
        null;
      const resolvedFileId =
        fileType === 'TestTakers' ? fileId || file.originalname : fileId;
      const resolvedFileIdNormalized = (resolvedFileId || '').toUpperCase();

      const existingFile = await this.fileUploadRepository.findOne({
        where: { file_id: resolvedFileId, workspace_id: workspaceId }
      });
      if (existingFile) {
        const overwriteAllowed =
          overwriteExisting &&
          (!overwriteAllowList ||
            overwriteAllowList.has(resolvedFileIdNormalized));
        if (!overwriteAllowed) {
          if (overwriteExisting && overwriteAllowList) {
            return await Promise.resolve();
          }
          this.logger.warn(
            `File with ID ${resolvedFileId} in Workspace ${workspaceId} already exists.`
          );
          return {
            conflict: true,
            fileId: resolvedFileId,
            filename: file.originalname,
            fileType
          };
        }
      }

      let extractedInfo: Record<string, unknown> = {};
      try {
        if (fileType === 'Unit') {
          extractedInfo =
            await this.workspaceFileParsingService.extractUnitInfo(xmlDocument);
        } else if (fileType === 'Booklet') {
          extractedInfo =
            await this.workspaceFileParsingService.extractBookletInfo(
              xmlDocument
            );
        } else if (fileType === 'TestTakers') {
          extractedInfo =
            await this.workspaceFileParsingService.extractTestTakersInfo(
              xmlDocument
            );
        }
        this.logger.log(
          `Extracted information from ${fileType} file: ${JSON.stringify(
            extractedInfo
          )}`
        );
      } catch (extractError) {
        this.logger.error(
          `Error extracting information from ${fileType} file: ${extractError.message}`
        );
      }

      const structuredData: StructuredFileData = {
        extractedInfo
      };

      await this.fileUploadRepository.upsert(
        {
          workspace_id: workspaceId,
          filename: file.originalname,
          file_type: fileType,
          file_size: file.size,
          created_at: new Date() as unknown as number,
          data: file.buffer.toString(),
          file_id: resolvedFileId,
          structured_data: structuredData
        },
        ['file_id', 'workspace_id']
      );

      return {
        fileId: resolvedFileId,
        filename: file.originalname,
        fileType
      };
    } catch (error) {
      this.logger.error(`Error processing XML file: ${error.message}`);
      throw error;
    }
  }
}
