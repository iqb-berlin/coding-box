import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository, FindOperator } from 'typeorm';
import { parseStringPromise } from 'xml2js';
import { VariableInfo } from '@iqbspecs/variable-info/variable-info.interface';
import {
  FileUpload
} from '../../common';
import { FileDownloadDto } from '../../../../../../api-dto/files/file-download.dto';
import { WorkspaceFileStorageService } from './workspace-file-storage.service';

@Injectable()
export class FileDownloadService {
  private readonly logger = new Logger(FileDownloadService.name);

  constructor(
    @InjectRepository(FileUpload)
    private fileUploadRepository: Repository<FileUpload>,
    private workspaceFileStorageService: WorkspaceFileStorageService
  ) {}

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
      if (
        /^[A-Za-z0-9+/]*={0,2}$/.test(file.data) &&
        file.data.length % 4 === 0
      ) {
        base64Data = file.data;
        this.logger.log(`File ${file.filename} already stored as base64.`);
      } else {
        base64Data = Buffer.from(file.data, 'utf8').toString('base64');
        this.logger.log(
          `File ${file.filename} converted from UTF-8 to base64.`
        );
      }
    } catch (error) {
      this.logger.warn(
        `Failed to process file data for ${file.filename}, falling back to binary conversion: ${error.message}`
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
        `Error retrieving coding scheme: ${error.message}`,
        error.stack
      );
      return null;
    }
  }

  async getVariableInfoForScheme(
    workspaceId: number,
    schemeFileId: string
  ): Promise<VariableInfo[]> {
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

      const filteredUnitFiles = unitFiles.filter(
        file => file.file_id.toUpperCase() === schemeFileId.toUpperCase() &&
          !file.file_id.includes('VOCS')
      );

      if (filteredUnitFiles.length === 0) {
        this.logger.warn(
          `No Unit files with file_id ${schemeFileId} (without VOCS) found in workspace ${workspaceId}`
        );
        return [];
      }

      const variableInfoArray: VariableInfo[] = [];

      for (const unitFile of filteredUnitFiles) {
        try {
          const xmlContent = unitFile.data.toString();
          const parsedXml = await parseStringPromise(xmlContent, {
            explicitArray: false
          });

          if (
            parsedXml.Unit &&
            parsedXml.Unit.BaseVariables &&
            parsedXml.Unit.BaseVariables.Variable
          ) {
            const baseVariables = Array.isArray(
              parsedXml.Unit.BaseVariables.Variable
            ) ?
              parsedXml.Unit.BaseVariables.Variable :
              [parsedXml.Unit.BaseVariables.Variable];

            for (const variable of baseVariables) {
              if (variable.$ && variable.$.alias && variable.$.type) {
                const variableInfo: VariableInfo = {
                  id: variable.$.id,
                  alias: variable.$.alias,
                  type: variable.$.type,
                  multiple:
                    variable.$.multiple === 'true' ||
                    variable.$.multiple === true,
                  nullable:
                    variable.$.nullable !== 'false' &&
                    variable.$.nullable !== false, // Default to true if not specified
                  values: variable.$.values ?
                    variable.$.values.split('|') :
                    undefined,
                  valuesComplete:
                    variable.$.valuesComplete === 'true' ||
                    variable.$.valuesComplete === true,
                  page: variable.$.page,
                  format: '',
                  valuePositionLabels: []
                };

                variableInfoArray.push(variableInfo);
              }
            }
          }
        } catch (e) {
          this.logger.error(
            `Error parsing XML for unit file ${unitFile.file_id}: ${e.message}`
          );
        }
      }

      return variableInfoArray;
    } catch (error) {
      this.logger.error(
        `Error retrieving variable info: ${error.message}`,
        error.stack
      );
      return [];
    }
  }

  async downloadWorkspaceFilesAsZip(
    workspaceId: number,
    fileTypes?: string[]
  ): Promise<Buffer> {
    try {
      this.logger.log(`Creating ZIP file for workspace ${workspaceId}`);

      let where: { workspace_id: number; file_type?: FindOperator<string> } = {
        workspace_id: workspaceId
      };
      if (fileTypes && fileTypes.length > 0) {
        where = {
          workspace_id: workspaceId,
          file_type: In(fileTypes)
        };
      }

      const files = await this.fileUploadRepository.find({
        where,
        order: { file_type: 'ASC', filename: 'ASC' },
        take: 3000
      });

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
        `Error creating ZIP file for workspace ${workspaceId}: ${error.message}`,
        error.stack
      );
      throw new Error(`Failed to create ZIP file: ${error.message}`);
    }
  }
}
