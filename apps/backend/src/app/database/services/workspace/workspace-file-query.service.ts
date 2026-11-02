import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  FindOperator, In, Like, QueryRunner, Repository, SelectQueryBuilder
} from 'typeorm';
import * as path from 'path';
import { WorkspaceFileMetadataService } from './workspace-file-metadata.service';
import { getErrorMessage, getErrorStack } from '../../../utils/error.util';
import FileUpload from '../../entities/file_upload.entity';
import { FilesDto } from '../../../../../../../api-dto/files/files.dto';
import { FileDownloadDto } from '../../../../../../../api-dto/files/file-download.dto';
import { WorkspaceFileStorageService } from './workspace-file-storage.service';
import { assertValidRegexSearchPattern, withRegexSearchStatementTimeout } from '../../../utils/regex-search.util';

type WorkspaceUnitVisibility = {
  globalIgnoredUnits: Set<string>;
  visibleUnitIds: Set<string> | null;
};

@Injectable()
export class WorkspaceFileQueryService {
  private readonly logger = new Logger(WorkspaceFileQueryService.name);
  private readonly resourceTypeLabel = 'Resource';

  constructor(
    @InjectRepository(FileUpload) private readonly fileUploadRepository: Repository<FileUpload>,
    private readonly fileMetadata: WorkspaceFileMetadataService,
    private readonly workspaceFileStorageService: WorkspaceFileStorageService
  ) {}

  private async getWorkspaceUnitVisibility(
    workspaceId: number
  ): Promise<WorkspaceUnitVisibility> {
    return this.fileMetadata.getWorkspaceUnitVisibility(workspaceId);
  }

  private isUnitVisibleInWorkspace(
    unitId: string | null | undefined,
    visibility: WorkspaceUnitVisibility
  ): boolean {
    return this.fileMetadata.isUnitVisibleInWorkspace(unitId, visibility);
  }

  async findAllFileTypes(workspaceId: number): Promise<string[]> {
    this.logger.log(`Fetching all file types for workspace: ${workspaceId}`);

    try {
      const result = await this.fileUploadRepository
        .createQueryBuilder('file')
        .select('DISTINCT file.file_type', 'file_type')
        .where('file.workspace_id = :workspaceId', { workspaceId })
        .andWhere('file.file_type IS NOT NULL')
        .getRawMany();

      const fileTypes = result.map(item => item.file_type);
      const resourceExtensions = new Set(['.vocs', '.voud', '.vomd', '.html']);
      if (fileTypes.includes(this.resourceTypeLabel)) {
        const resourceFiles = await this.fileUploadRepository
          .createQueryBuilder('file')
          .select('file.filename', 'filename')
          .where('file.workspace_id = :workspaceId', { workspaceId })
          .andWhere('file.file_type = :fileType', {
            fileType: this.resourceTypeLabel
          })
          .getRawMany();

        const resourceSubTypes = new Set<string>();
        resourceFiles.forEach(({ filename }) => {
          const extension = path.extname(String(filename)).toLowerCase();
          if (resourceExtensions.has(extension)) {
            resourceSubTypes.add(`${this.resourceTypeLabel} (${extension})`);
          }
        });

        resourceSubTypes.forEach(t => fileTypes.push(t));
      }

      return Array.from(new Set(fileTypes)).sort();
    } catch (error) {
      this.logger.error(
        `Error fetching file types for workspace ${workspaceId}: ${getErrorMessage(error)}`,
        getErrorStack(error)
      );
      return [];
    }
  }

  async findFiles(
    workspaceId: number,
    options?: {
      page: number;
      limit: number;
      fileType?: string;
      fileSize?: string;
      searchText?: string;
      regexSearch?: boolean;
    }
  ): Promise<[FilesDto[], number, string[]]> {
    this.logger.log(`Fetching test files for workspace: ${workspaceId}`);
    const {
      page = 1,
      limit = 20,
      fileType,
      fileSize,
      searchText,
      regexSearch
    } = options || {};
    const MAX_LIMIT = 10000;
    const validPage = Math.max(1, page);
    const validLimit = Math.min(Math.max(1, limit), MAX_LIMIT);

    const runFindFiles = async (
      queryRunner?: QueryRunner
    ): Promise<[FilesDto[], number, string[]]> => {
      let qb = this.fileUploadRepository
        .createQueryBuilder('file', queryRunner)
        .where('file.workspace_id = :workspaceId', { workspaceId });

      if (fileType) {
        const resourceExtension = this.getResourceSubtypeExtension(fileType);
        if (resourceExtension) {
          qb = qb
            .andWhere('file.file_type = :fileType', {
              fileType: this.resourceTypeLabel
            })
            .andWhere('LOWER(file.filename) LIKE :extension', {
              extension: `%${resourceExtension}`
            });
        } else {
          qb = qb.andWhere('file.file_type = :fileType', { fileType });
        }
      }

      qb = this.applyFileSizeFilter(qb, fileSize);

      if (searchText) {
        if (regexSearch) {
          const searchRegex = assertValidRegexSearchPattern(searchText, 'searchText');
          if (searchRegex) {
            qb = qb.andWhere(
              "(file.filename ~ :searchRegex OR file.file_type ~ :searchRegex OR TO_CHAR(file.created_at, 'DD.MM.YYYY HH24:MI') ~ :searchRegex)",
              { searchRegex }
            );
          }
        } else {
          const search = `%${searchText.toLowerCase()}%`;
          qb = qb.andWhere(
            "(LOWER(file.filename) LIKE :search OR LOWER(file.file_type) LIKE :search OR TO_CHAR(file.created_at, 'DD.MM.YYYY HH24:MI') ILIKE :search)",
            { search }
          );
        }
      }

      qb = qb
        .select([
          'file.id',
          'file.filename',
          'file.file_id',
          'file.file_size',
          'file.file_type',
          'file.created_at'
        ])
        .orderBy('file.created_at', 'DESC')
        .skip((validPage - 1) * validLimit)
        .take(validLimit);

      const [files, total] = await qb.getManyAndCount();
      this.logger.log(
        `Found ${files.length} files (page ${validPage}, limit ${validLimit}, total ${total}).`
      );

      const fileTypes = await this.findAllFileTypes(workspaceId);

      return [files, total, fileTypes];
    };

    if (regexSearch) {
      return withRegexSearchStatementTimeout(
        this.fileUploadRepository.manager.connection,
        runFindFiles
      );
    }

    return runFindFiles();
  }

  async getUnitsWithFileIds(
    workspaceId: number
  ): Promise<{ id: number; unitId: string; fileName: string; data: string }[]> {
    try {
      const units = await this.fileUploadRepository.find({
        where: {
          workspace_id: workspaceId,
          file_type: 'Resource',
          file_id: Like('%.VOCS')
        }
      });

      if (!units || units.length === 0) {
        this.logger.warn(
          `No schmemes found in workspace with ID ${workspaceId}.`
        );
        return [];
      }

      const visibility = await this.getWorkspaceUnitVisibility(workspaceId);
      return units
        .filter(unit => this.isUnitVisibleInWorkspace(unit.file_id, visibility))
        .map(unit => ({
          id: unit.id,
          unitId: unit.file_id,
          fileName: unit.filename,
          data: unit.data
        }));
    } catch (error) {
      this.logger.error(
        `Error getting units with file IDs for workspace ${workspaceId}: ${getErrorMessage(error)}`,
        getErrorStack(error)
      );
      return [];
    }
  }

  async getVocs(workspaceId: number, vocs: string): Promise<FilesDto[]> {
    try {
      const fileId = vocs.toUpperCase().endsWith('.VOCS') ?
        vocs.toUpperCase() :
        `${vocs.toUpperCase()}.VOCS`;

      const vocsFile = await this.fileUploadRepository.findOne({
        where: {
          workspace_id: workspaceId,
          file_id: fileId
        }
      });

      if (!vocsFile) {
        this.logger.warn(
          `VOCS file for ${vocs} not found in workspace ${workspaceId}`
        );
        return [];
      }

      return [
        {
          file_id: vocsFile.file_id,
          data: vocsFile.data.toString(),
          workspace_id: vocsFile.workspace_id
        }
      ];
    } catch (error) {
      this.logger.error(`Error retrieving VOCS file: ${getErrorMessage(error)}`);
      return [];
    }
  }

  async getItemIdsFromMetadataFiles(
    workspaceId: number
  ): Promise<{ fileId: string; id: number; items: string[] }[]> {
    try {
      const metadataFiles = await this.fileUploadRepository.find({
        where: {
          workspace_id: workspaceId,
          file_type: 'Resource',
          filename: Like('%.vomd')
        }
      });

      const result: { fileId: string; id: number; items: string[] }[] = [];

      metadataFiles.forEach(file => {
        try {
          const content = JSON.parse(file.data);
          if (Array.isArray(content.items)) {
            const ids: string[] = [];
            content.items.forEach((item: { id?: string | number }) => {
              if (item.id) {
                ids.push(String(item.id));
              }
            });
            if (ids.length > 0) {
              result.push({
                fileId: file.file_id,
                id: file.id,
                items: ids.sort()
              });
            }
          }
        } catch (e) {
          this.logger.warn(
            `Failed to parse metadata file ${file.filename}: ${getErrorMessage(e)}`
          );
        }
      });

      return result.sort((a, b) => a.fileId.localeCompare(b.fileId));
    } catch (error) {
      this.logger.error(
        `Error fetching item IDs from metadata files: ${getErrorMessage(error)}`
      );
      return [];
    }
  }

  async downloadTestFile(
    workspace_id: number,
    fileId: number
  ): Promise<FileDownloadDto> {
    this.logger.log(
      `Downloading file with ID ${fileId} for workspace ${workspace_id}`
    );

    const file = await this.fileUploadRepository.findOne({
      where: { id: fileId, workspace_id: workspace_id }
    });

    if (!file) {
      this.logger.warn(
        `File with ID ${fileId} not found in workspace ${workspace_id}`
      );
      throw new Error('File not found');
    }

    this.logger.log(
      `File ${file.filename} found. Preparing to convert to Base64.`
    );

    let base64Data: string;
    try {
      // If data is already base64-encoded (binary files), use it directly
      // Base64 strings are valid UTF-8 and contain specific character patterns
      if (
        /^[A-Za-z0-9+/]*={0,2}$/.test(file.data) &&
        file.data.length % 4 === 0
      ) {
        base64Data = file.data;
        this.logger.log(`File ${file.filename} already stored as base64.`);
      } else {
        // For UTF-8 text files, convert the string to base64
        base64Data = Buffer.from(file.data, 'utf8').toString('base64');
        this.logger.log(
          `File ${file.filename} converted from UTF-8 to base64.`
        );
      }
    } catch (error) {
      this.logger.warn(
        `Failed to process file data for ${file.filename}, falling back to binary conversion: ${getErrorMessage(error)}`
      );
      base64Data = Buffer.from(file.data, 'binary').toString('base64');
    }

    this.logger.log(`File ${file.filename} successfully converted to Base64.`);

    return {
      filename: file.filename,
      base64Data,
      mimeType: 'application/xml'
    };
  }

  async getUnitContent(workspaceId: number, unitId: number): Promise<string> {
    const unitFile = await this.fileUploadRepository.findOne({
      where: { workspace_id: workspaceId, file_id: `${unitId}` }
    });

    if (!unitFile) {
      this.logger.error(
        `Unit file with ID ${unitId} not found in workspace ${workspaceId}`
      );
      throw new Error(`Unit file with ID ${unitId} not found`);
    }

    if (!unitFile.data) {
      this.logger.error(`Unit file with ID ${unitId} has no data content`);
      throw new Error('Unit file has no data content');
    }

    return unitFile.data.toString();
  }

  async getTestTakerContent(
    workspaceId: number,
    testTakerId: string
  ): Promise<string> {
    const testTakerFile = await this.fileUploadRepository.findOne({
      where: {
        workspace_id: workspaceId,
        file_type: In(['TestTakers', 'Testtakers']),
        file_id: testTakerId
      }
    });

    if (!testTakerFile) {
      this.logger.error(
        `TestTakers file with ID ${testTakerId} not found in workspace ${workspaceId}`
      );
      throw new Error(`TestTakers file with ID ${testTakerId} not found`);
    }

    if (!testTakerFile.data) {
      this.logger.error(
        `TestTakers file with ID ${testTakerId} has no data content`
      );
      throw new Error('TestTakers file has no data content');
    }

    return testTakerFile.data.toString();
  }

  async getCodingSchemeByRef(
    workspaceId: number,
    codingSchemeRef: string
  ): Promise<FileDownloadDto | null> {
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
        this.logger.warn(
          `Coding scheme file '${codingSchemeRef.toUpperCase()}' not found in workspace ${workspaceId}`
        );
        return null;
      }

      const base64Data = codingSchemeFile.data.toString();

      return {
        filename: codingSchemeFile.filename,
        base64Data,
        mimeType: codingSchemeFile.file_type
      };
    } catch (error) {
      this.logger.error(
        `Error retrieving coding scheme: ${getErrorMessage(error)}`,
        getErrorStack(error)
      );
      return null;
    }
  }

  async downloadWorkspaceFilesAsZip(
    workspaceId: number,
    fileTypes?: string[]
  ): Promise<Buffer> {
    try {
      this.logger.log(`Creating ZIP file for workspace ${workspaceId}`);

      const normalizedFileTypes = (fileTypes || [])
        .map(t => t.trim())
        .filter(Boolean);
      const resourceExtensions = new Set<string>();
      let resourceAllSelected = false;
      const baseTypes = new Set<string>();

      normalizedFileTypes.forEach(type => {
        if (type === this.resourceTypeLabel) {
          resourceAllSelected = true;
          baseTypes.add(this.resourceTypeLabel);
          resourceExtensions.clear();
          return;
        }
        const extension = this.getResourceSubtypeExtension(type);
        if (extension) {
          if (!resourceAllSelected) {
            resourceExtensions.add(extension);
          }
          baseTypes.add(this.resourceTypeLabel);
          return;
        }
        baseTypes.add(type);
      });

      let where: { workspace_id: number; file_type?: FindOperator<string> } = {
        workspace_id: workspaceId
      };
      if (baseTypes.size > 0) {
        where = {
          workspace_id: workspaceId,
          file_type: In(Array.from(baseTypes))
        };
      }

      let files = await this.fileUploadRepository.find({
        where,
        order: { file_type: 'ASC', filename: 'ASC' }
      });

      if (!resourceAllSelected && resourceExtensions.size > 0) {
        files = files.filter(file => {
          if (file.file_type !== this.resourceTypeLabel) return true;
          const extension = path.extname(file.filename).toLowerCase();
          return resourceExtensions.has(extension);
        });
      }

      if (!files || files.length === 0) {
        this.logger.error(`No files found in workspace ${workspaceId}`);
      }

      this.logger.log(`Found ${files.length} files to include in ZIP`);

      const folderNameMap: Record<string, string> = {
        Booklet: 'Testhefte',
        Unit: 'Aufgaben',
        Resource: 'Ressourcen',
        Schemer: 'Kodierschemata',
        TestTakers: 'Testteilnehmer',
        Testtakers: 'Testteilnehmer'
      };

      const zipBuffer =
        this.workspaceFileStorageService.createZipBufferFromFiles(
          files,
          folderNameMap
        );
      this.logger.log(
        `ZIP file created successfully (${zipBuffer.length} bytes)`
      );

      return zipBuffer;
    } catch (error) {
      this.logger.error(
        `Error creating ZIP file for workspace ${workspaceId}: ${getErrorMessage(error)}`,
        getErrorStack(error)
      );
      throw new Error(`Failed to create ZIP file: ${getErrorMessage(error)}`);
    }
  }

  async readMetadataFile(workspaceId: number, fileId: number): Promise<FileDownloadDto> {
    const file = await this.fileUploadRepository.findOne({
      where: { id: fileId, workspace_id: workspaceId, file_type: 'Resource' }
    });
    if (!file || !file.filename.toLowerCase().endsWith('.vomd')) {
      throw new NotFoundException('Metadata resource not found');
    }
    return {
      filename: file.filename,
      base64Data: Buffer.from(file.data, 'utf8').toString('base64'),
      mimeType: 'application/json'
    };
  }

  private applyFileSizeFilter(query: SelectQueryBuilder<FileUpload>, fileSize?: string): SelectQueryBuilder<FileUpload> {
    let qb = query;
    if (fileSize) {
      const KB = 1024;
      const MB = 1024 * KB;
      // eslint-disable-next-line default-case
      switch (fileSize) {
        case '0-10KB':
          qb = qb.andWhere('file.file_size < :max', { max: 10 * KB });
          break;
        case '10KB-100KB':
          qb = qb.andWhere('file.file_size >= :min AND file.file_size < :max', {
            min: 10 * KB,
            max: 100 * KB
          });
          break;
        case '100KB-1MB':
          qb = qb.andWhere('file.file_size >= :min AND file.file_size < :max', {
            min: 100 * KB,
            max: MB
          });
          break;
        case '1MB-10MB':
          qb = qb.andWhere('file.file_size >= :min AND file.file_size < :max', {
            min: MB,
            max: 10 * MB
          });
          break;
        case '10MB+':
          qb = qb.andWhere('file.file_size >= :min', { min: 10 * MB });
          break;
      }
    }
    return qb;
  }

  private getResourceSubtypeExtension(fileType: string): string | null {
    const match = fileType.match(/^Resource\s*\((\.[^)]+)\)$/i);
    return match ? match[1].toLowerCase() : null;
  }
}
