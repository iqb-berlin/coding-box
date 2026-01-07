import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as cheerio from 'cheerio';
import {
  FileUpload, StructuredFileData
} from '../../../common';
import { FileIo } from '../../../admin/workspace/file-io.interface';
import { WorkspaceFileParsingService } from '../workspace-file-parsing.service';

@Injectable()
export class HtmlFileHandler {
  private readonly logger = new Logger(HtmlFileHandler.name);

  constructor(
    @InjectRepository(FileUpload)
    private fileUploadRepository: Repository<FileUpload>,
    private workspaceFileParsingService: WorkspaceFileParsingService
  ) {}

  async handleHtmlFile(
    workspaceId: number,
    file: FileIo,
    overwriteExisting: boolean,
    overwriteAllowList?: Set<string>
  ): Promise<unknown> {
    try {
      const playerCode = file.buffer.toString();
      const playerContent = cheerio.load(playerCode);
      const metaDataElement = playerContent(
        'script[type="application/ld+json"]'
      );
      let metadata = {};

      try {
        metadata = JSON.parse(metaDataElement.text());
      } catch (metadataError) {
        this.logger.warn(
          `Error parsing metadata from HTML file: ${metadataError.message}`
        );
      }
      const structuredData: StructuredFileData = {
        metadata
      };

      if (metadata['@type'] === 'schemer') {
        const resourceFileId =
          this.workspaceFileParsingService.getSchemerId(file);
        const existing = await this.fileUploadRepository.findOne({
          where: { file_id: resourceFileId, workspace_id: workspaceId }
        });
        const resourceFileIdNormalized = (resourceFileId || '').toUpperCase();
        const overwriteAllowed =
          overwriteExisting &&
          (!overwriteAllowList ||
            overwriteAllowList.has(resourceFileIdNormalized));
        if (existing && !overwriteAllowed) {
          if (overwriteExisting && overwriteAllowList) {
            return await Promise.resolve();
          }
          return {
            conflict: true,
            fileId: resourceFileId,
            filename: file.originalname,
            fileType: 'Schemer'
          };
        }
        await this.fileUploadRepository.upsert(
          {
            filename: file.originalname,
            workspace_id: workspaceId,
            file_type: 'Schemer',
            file_size: file.size,
            created_at: new Date() as unknown as number,
            file_id: resourceFileId,
            data: file.buffer.toString(),
            structured_data: structuredData
          },
          ['file_id', 'workspace_id']
        );

        return {
          fileId: resourceFileId,
          filename: file.originalname,
          fileType: 'Schemer'
        };
      }

      const resourceFileId = this.workspaceFileParsingService.getPlayerId(file);
      const existing = await this.fileUploadRepository.findOne({
        where: { file_id: resourceFileId, workspace_id: workspaceId }
      });
      const resourceFileIdNormalized = (resourceFileId || '').toUpperCase();
      const overwriteAllowed =
        overwriteExisting &&
        (!overwriteAllowList ||
          overwriteAllowList.has(resourceFileIdNormalized));
      if (existing && !overwriteAllowed) {
        if (overwriteExisting && overwriteAllowList) {
          return await Promise.resolve();
        }
        return {
          conflict: true,
          fileId: resourceFileId,
          filename: file.originalname,
          fileType: 'Resource'
        };
      }
      await this.fileUploadRepository.upsert(
        {
          filename: file.originalname,
          workspace_id: workspaceId,
          file_type: 'Resource',
          file_size: file.size,
          created_at: new Date() as unknown as number,
          file_id: resourceFileId,
          data: file.buffer.toString(),
          structured_data: structuredData
        },
        ['file_id', 'workspace_id']
      );

      return {
        fileId: resourceFileId,
        filename: file.originalname,
        fileType: 'Resource'
      };
    } catch (error) {
      const resourceFileId =
        this.workspaceFileParsingService.getResourceId(file);
      await this.fileUploadRepository.upsert(
        {
          filename: file.originalname,
          workspace_id: workspaceId,
          file_type: 'Resource',
          file_size: file.size,
          created_at: new Date() as unknown as number,
          file_id: resourceFileId,
          data: file.buffer.toString(),
          structured_data: { metadata: {} }
        },
        ['file_id', 'workspace_id']
      );

      return {
        fileId: resourceFileId,
        filename: file.originalname,
        fileType: 'Resource'
      };
    }
  }
}
