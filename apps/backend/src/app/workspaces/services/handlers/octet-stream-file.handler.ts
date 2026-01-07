import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as cheerio from 'cheerio';
import * as path from 'path';
import {
  FileUpload, StructuredFileData
} from '../../../common';
import { FileIo } from '../../../admin/workspace/file-io.interface';

@Injectable()
export class OctetStreamFileHandler {
  private readonly logger = new Logger(OctetStreamFileHandler.name);

  constructor(
    @InjectRepository(FileUpload)
    private fileUploadRepository: Repository<FileUpload>
  ) {}

  async handleOctetStreamFile(
    workspaceId: number,
    file: FileIo,
    overwriteExisting: boolean,
    overwriteAllowList?: Set<string>
  ): Promise<unknown> {
    this.logger.log(
      `Processing octet-stream file: ${file.originalname} for workspace ${workspaceId}`
    );
    try {
      const fileExtension = path.extname(file.originalname).toLowerCase();
      let fileType = 'Resource';
      let fileContent: string | Buffer;
      let extractedInfo = {};

      const textFileExtensions = [
        '.xml',
        '.html',
        '.htm',
        '.xhtml',
        '.txt',
        '.json',
        '.csv',
        '.voud',
        '.vocs',
        '.vomd'
      ];

      if (textFileExtensions.includes(fileExtension)) {
        fileContent = file.buffer.toString('utf8');
      } else {
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
          this.logger.warn(
            `Could not parse XML content for ${file.originalname}: ${error.message}`
          );
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
        created_at: new Date() as unknown as number,
        data: fileContent,
        structured_data: structuredData
      });

      const existing = await this.fileUploadRepository.findOne({
        where: { file_id: fileUpload.file_id, workspace_id: workspaceId }
      });
      const fileIdNormalized = (fileUpload.file_id || '').toUpperCase();
      const overwriteAllowed =
        overwriteExisting &&
        (!overwriteAllowList || overwriteAllowList.has(fileIdNormalized));
      if (existing && !overwriteAllowed) {
        if (overwriteExisting && overwriteAllowList) {
          return await Promise.resolve();
        }
        return {
          conflict: true,
          fileId: fileUpload.file_id,
          filename: file.originalname,
          fileType
        };
      }

      await this.fileUploadRepository.upsert(fileUpload, [
        'file_id',
        'workspace_id'
      ]);
      this.logger.log(
        `Successfully processed octet-stream file: ${file.originalname} as ${fileType}`
      );
      return {
        fileId: fileUpload.file_id,
        filename: file.originalname,
        fileType
      };
    } catch (error) {
      this.logger.error(
        `Error processing octet-stream file ${file.originalname}: ${error.message}`,
        error.stack
      );
      throw error;
    }
  }
}
