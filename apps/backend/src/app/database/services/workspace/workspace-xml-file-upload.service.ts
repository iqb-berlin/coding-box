import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as cheerio from 'cheerio';
import { getErrorMessage } from '../../../utils/error.util';
import FileUpload, { StructuredFileData } from '../../entities/file_upload.entity';
import { FileIo } from '../../../admin/workspace/file-io.interface';
import { WorkspaceXmlSchemaValidationService } from './workspace-xml-schema-validation.service';
import { WorkspaceFileParsingService } from './workspace-file-parsing.service';
import { withNormalizedFileLookupFields, toFailedUploadResult, WorkspaceFilesMutationContext } from './workspace-file-write.util';

@Injectable()
export class WorkspaceXmlFileUploadService {
  private readonly logger = new Logger(WorkspaceXmlFileUploadService.name);

  constructor(
    @InjectRepository(FileUpload) private readonly fileUploadRepository: Repository<FileUpload>,
    private readonly workspaceXmlSchemaValidationService: WorkspaceXmlSchemaValidationService,
    private readonly workspaceFileParsingService: WorkspaceFileParsingService
  ) {}

  async handleXmlFile(
    workspaceId: number,
    file: FileIo,
    overwriteExisting: boolean,
    overwriteAllowList?: Set<string>,
    mutationContext?: WorkspaceFilesMutationContext
  ): Promise<unknown> {
    const fileUploadRepository =
      mutationContext?.fileUploadRepository ?? this.fileUploadRepository;
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

      const validationFailure = await this.validateXml(file, xmlContent);
      if (validationFailure) return validationFailure;

      const metadata = xmlDocument('Metadata');
      const idElement = metadata.find('Id');
      const fileId = idElement.length ?
        idElement.text().toUpperCase().trim() :
        null;
      const resolvedFileId =
        fileType === 'TestTakers' ? fileId || file.originalname : fileId;
      if (!resolvedFileId) throw new Error('File metadata must contain an ID');
      const resolvedFileIdNormalized = resolvedFileId.toUpperCase();

      const existingFile = await fileUploadRepository.findOne({
        where: { file_id: resolvedFileId, workspace_id: workspaceId }
      });
      if (existingFile) {
        const overwriteAllowed =
          this.isOverwriteAllowed(overwriteExisting, overwriteAllowList, resolvedFileIdNormalized);
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

      const structuredData = await this.extractStructuredData(fileType, xmlDocument);

      await fileUploadRepository.upsert(
        withNormalizedFileLookupFields({
          workspace_id: workspaceId,
          filename: file.originalname,
          file_type: fileType,
          file_size: file.size,
          created_at: new Date() as unknown as number,
          data: file.buffer.toString(),
          file_id: resolvedFileId,
          structured_data: structuredData
        }),
        ['file_id', 'workspace_id']
      );

      return {
        fileId: resolvedFileId,
        filename: file.originalname,
        fileType
      };
    } catch (error) {
      this.logger.error(`Error processing XML file: ${getErrorMessage(error)}`);
      throw error;
    }
  }

  private async validateXml(file: FileIo, xmlContent: string): Promise<ReturnType<typeof toFailedUploadResult> | undefined> {
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
      const failureMessage = `XSD validation failed: ${file.originalname}`;
      this.logger.warn(
        `XSD validation failed on upload: ${file.originalname} (errors: ${
          xmlValidation.errors.length
        }) ${JSON.stringify(errorsPreview)}`
      );
      return toFailedUploadResult(
        file.originalname,
        failureMessage,
        errorsPreview
      );
    }

    return undefined;
  }

  private async extractStructuredData(fileType: string, xmlDocument: cheerio.CheerioAPI): Promise<StructuredFileData> {
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
        `Error extracting information from ${fileType} file: ${getErrorMessage(extractError)}`
      );
    }

    return {
      extractedInfo
    };
  }

  private isOverwriteAllowed(overwriteExisting: boolean, allowList: Set<string> | undefined, fileId: string): boolean {
    return overwriteExisting && (!allowList || allowList.has(fileId));
  }
}
