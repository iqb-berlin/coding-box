import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Like, Repository } from 'typeorm';
import { parseStringPromise } from 'xml2js';
import {
  FileUpload, Unit
} from '../../common';
import { FilesDto } from '../../../../../../api-dto/files/files.dto';
import { UnitVariableDetailsDto } from '../../models/unit-variable-details.dto';
import { WorkspaceFileParsingService } from './workspace-file-parsing.service';

@Injectable()
export class FileQueryService {
  private readonly logger = new Logger(FileQueryService.name);
  private unitVariableCache: Map<number, Map<string, Set<string>>> = new Map();
  private voudCache = new Map<string, { data: Map<string, string>; timestamp: number }>();

  constructor(
    @InjectRepository(FileUpload)
    private fileUploadRepository: Repository<FileUpload>,
    @InjectRepository(Unit)
    private unitRepository: Repository<Unit>,
    private workspaceFileParsingService: WorkspaceFileParsingService
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
      this.logger.error(
        `Error fetching file types for workspace ${workspaceId}: ${error.message}`,
        error.stack
      );
      return [];
    }
  }

  async getVariablePageMap(
    unitName: string,
    workspaceId: number
  ): Promise<Map<string, string>> {
    const cacheKey = `${workspaceId}:${unitName}`;
    const cached = this.voudCache.get(cacheKey);
    // Cache for 5 minutes
    if (cached && Date.now() - cached.timestamp < 5 * 60 * 1000) {
      return cached.data;
    }

    const voudFile = await this.fileUploadRepository.findOne({
      where: {
        workspace_id: workspaceId,
        file_type: 'Resource',
        file_id: `${unitName}.VOUD`
      }
    });

    let variablePageMap = new Map<string, string>();

    if (voudFile) {
      variablePageMap = this.workspaceFileParsingService.extractVoudInfo(
        voudFile.data.toString()
      );
    }

    this.voudCache.set(cacheKey, { data: variablePageMap, timestamp: Date.now() });

    // Cleanup cache if too big (simple strategy)
    if (this.voudCache.size > 100) {
      const oldestKey = this.voudCache.keys().next().value;
      this.voudCache.delete(oldestKey);
    }

    return variablePageMap;
  }

  async findFiles(
    workspaceId: number,
    options?: {
      page: number;
      limit: number;
      fileType?: string;
      fileSize?: string;
      searchText?: string;
    }
  ): Promise<[FilesDto[], number, string[]]> {
    this.logger.log(`Fetching test files for workspace: ${workspaceId}`);
    const {
      page = 1,
      limit = 20,
      fileType,
      fileSize,
      searchText
    } = options || {};
    const MAX_LIMIT = 10000;
    const validPage = Math.max(1, page);
    const validLimit = Math.min(Math.max(1, limit), MAX_LIMIT);

    let qb = this.fileUploadRepository
      .createQueryBuilder('file')
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

    if (searchText) {
      const search = `%${searchText.toLowerCase()}%`;
      qb = qb.andWhere(
        "(LOWER(file.filename) LIKE :search OR LOWER(file.file_type) LIKE :search OR TO_CHAR(file.created_at, 'DD.MM.YYYY HH24:MI') ILIKE :search)",
        { search }
      );
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
  }

  async getUnitsWithFileIds(
    workspaceId: number
  ): Promise<{ unitId: string; fileName: string }[]> {
    this.logger.log(`Fetching units with file IDs for workspace: ${workspaceId}`);

    try {
      const units = await this.fileUploadRepository.find({
        where: { workspace_id: workspaceId, file_type: 'Unit' },
        select: ['file_id', 'filename']
      });

      return units.map(u => ({
        unitId: u.file_id,
        fileName: u.filename
      }));
    } catch (error) {
      this.logger.error(
        `Error fetching units with file IDs for workspace ${workspaceId}: ${error.message}`,
        error.stack
      );
      return [];
    }
  }

  async refreshUnitVariableCache(workspaceId: number): Promise<void> {
    this.logger.log(`Refreshing unit variable cache for workspace: ${workspaceId}`);
    const units = await this.getUnitVariableDetails(workspaceId);
    const workspaceCache = new Map<string, Set<string>>();

    units.forEach(unit => {
      const variableIds = new Set(unit.variables.map(v => v.id));
      workspaceCache.set(unit.unitName, variableIds);
    });

    this.unitVariableCache.set(workspaceId, workspaceCache);
  }

  async getUnitVariableMap(
    workspaceId: number
  ): Promise<Map<string, Set<string>>> {
    if (!this.unitVariableCache.has(workspaceId)) {
      await this.refreshUnitVariableCache(workspaceId);
    }
    return this.unitVariableCache.get(workspaceId)!;
  }

  async getUnitVariableDetails(
    workspaceId: number
  ): Promise<UnitVariableDetailsDto[]> {
    this.logger.log(`Getting unit variable details for workspace: ${workspaceId}`);

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
      const codingSchemeCodesMap = new Map<
      string,
      Map<
      string,
      Array<{ id: string | number; label: string; score?: number }>
      >
      >();
      const codingSchemeManualInstructionsMap = new Map<
      string,
      Map<string, boolean>
      >();
      const codingSchemeClosedCodingMap = new Map<
      string,
      Map<string, boolean>
      >();

      for (const scheme of codingSchemes) {
        try {
          const unitId = scheme.file_id.replace('.VOCS', '');
          codingSchemeMap.set(unitId, scheme.file_id);

          const parsedScheme = JSON.parse(scheme.data) as {
            variableCodings?: {
              id: string;
              sourceType?: string;
              codes?: Array<{
                id: number | string;
                label?: string;
                score?: number;
                manualInstruction?: string;
                type?: string;
              }>;
            }[];
          };
          if (
            parsedScheme.variableCodings &&
            Array.isArray(parsedScheme.variableCodings)
          ) {
            const variableSourceTypes = new Map<string, string>();
            const variableCodes = new Map<
            string,
            Array<{ id: string | number; label: string; score?: number }>
            >();
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

                // Check if any code has manual instruction
                const hasManualInstruction = vc.codes.some(
                  code => code.manualInstruction &&
                    code.manualInstruction.trim() !== ''
                );
                if (hasManualInstruction) {
                  variableManualInstructions.set(vc.id, true);
                }

                // Check if any code is closed coding
                const hasClosedCoding = vc.codes.some(
                  code => code.type === 'RESIDUAL_AUTO' ||
                    code.type === 'INTENDED_INCOMPLETE'
                );
                if (hasClosedCoding) {
                  variableClosedCoding.set(vc.id, true);
                }
              }
            }
            codingSchemeVariablesMap.set(unitId, variableSourceTypes);
            codingSchemeCodesMap.set(unitId, variableCodes);
            codingSchemeManualInstructionsMap.set(
              unitId,
              variableManualInstructions
            );
            codingSchemeClosedCodingMap.set(unitId, variableClosedCoding);
          }
        } catch (error) {
          this.logger.error(
            `Error parsing coding scheme ${scheme.file_id}: ${error.message}`,
            error.stack
          );
        }
      }

      const unitVariableDetails: UnitVariableDetailsDto[] = [];

      for (const unitFile of unitFiles) {
        try {
          const xmlContent = unitFile.data.toString();
          const parsedXml = await parseStringPromise(xmlContent, {
            explicitArray: false
          });

          if (
            parsedXml.Unit &&
            parsedXml.Unit.Metadata &&
            parsedXml.Unit.Metadata.Id
          ) {
            const unitName = parsedXml.Unit.Metadata.Id;
            const variables: Array<{
              id: string;
              alias: string;
              type:
              | 'string'
              | 'integer'
              | 'number'
              | 'boolean'
              | 'attachment'
              | 'json'
              | 'no-value';
              hasCodingScheme: boolean;
              codingSchemeRef?: string;
              codes?: Array<{
                id: string | number;
                label: string;
                score?: number;
              }>;
              isDerived?: boolean;
              hasManualInstruction?: boolean;
              hasClosedCoding?: boolean;
            }> = [];

            // Process BaseVariables
            if (
              parsedXml.Unit.BaseVariables &&
              parsedXml.Unit.BaseVariables.Variable
            ) {
              const baseVariables = Array.isArray(
                parsedXml.Unit.BaseVariables.Variable
              ) ?
                parsedXml.Unit.BaseVariables.Variable :
                [parsedXml.Unit.BaseVariables.Variable];

              for (const variable of baseVariables) {
                if (variable.$.alias && variable.$.type !== 'no-value') {
                  const variableId = variable.$.id || variable.$.alias;
                  const unitSourceTypes =
                    codingSchemeVariablesMap.get(unitName);
                  const sourceType = unitSourceTypes?.get(variableId);

                  if (sourceType === 'BASE_NO_VALUE') {
                    continue;
                  }

                  const hasCodingScheme = codingSchemeMap.has(unitName);
                  const unitCodes = codingSchemeCodesMap.get(unitName);
                  const variableCodes = unitCodes?.get(variableId);
                  const unitManualInstructions =
                    codingSchemeManualInstructionsMap.get(unitName);
                  const hasManualInstruction =
                    unitManualInstructions?.get(variableId) || false;
                  const unitClosedCoding =
                    codingSchemeClosedCodingMap.get(unitName);
                  const hasClosedCoding =
                    unitClosedCoding?.get(variableId) || false;

                  variables.push({
                    id: variableId,
                    alias: variable.$.alias,
                    type: variable.$.type as
                      | 'string'
                      | 'integer'
                      | 'number'
                      | 'boolean'
                      | 'attachment'
                      | 'json'
                      | 'no-value',
                    hasCodingScheme,
                    codingSchemeRef: hasCodingScheme ?
                      codingSchemeMap.get(unitName) :
                      undefined,
                    codes: variableCodes,
                    isDerived: false,
                    hasManualInstruction,
                    hasClosedCoding
                  });
                }
              }
            }

            // Process DerivedVariables
            if (
              parsedXml.Unit.DerivedVariables &&
              parsedXml.Unit.DerivedVariables.Variable
            ) {
              const derivedVariables = Array.isArray(
                parsedXml.Unit.DerivedVariables.Variable
              ) ?
                parsedXml.Unit.DerivedVariables.Variable :
                [parsedXml.Unit.DerivedVariables.Variable];

              for (const variable of derivedVariables) {
                if (variable.$.alias && variable.$.type !== 'no-value') {
                  const variableId = variable.$.id || variable.$.alias;
                  const unitSourceTypes =
                    codingSchemeVariablesMap.get(unitName);
                  const sourceType = unitSourceTypes?.get(variableId);

                  if (sourceType === 'BASE_NO_VALUE' || sourceType === 'BASE') {
                    continue;
                  }

                  const hasCodingScheme = codingSchemeMap.has(unitName);
                  const unitCodes = codingSchemeCodesMap.get(unitName);
                  const variableCodes = unitCodes?.get(variableId);
                  const unitManualInstructions =
                    codingSchemeManualInstructionsMap.get(unitName);
                  const hasManualInstruction =
                    unitManualInstructions?.get(variableId) || false;
                  const unitClosedCoding =
                    codingSchemeClosedCodingMap.get(unitName);
                  const hasClosedCoding =
                    unitClosedCoding?.get(variableId) || false;

                  variables.push({
                    id: variableId,
                    alias: variable.$.alias,
                    type: variable.$.type as
                      | 'string'
                      | 'integer'
                      | 'number'
                      | 'boolean'
                      | 'attachment'
                      | 'json'
                      | 'no-value',
                    hasCodingScheme,
                    codingSchemeRef: hasCodingScheme ?
                      codingSchemeMap.get(unitName) :
                      undefined,
                    codes: variableCodes,
                    isDerived: true,
                    hasManualInstruction,
                    hasClosedCoding
                  });
                }
              }
            }

            if (variables.length > 0) {
              unitVariableDetails.push({
                unitName,
                unitId: unitName,
                variables
              });
            }
          }
        } catch (e) {
          this.logger.warn(
            `Error parsing unit file ${unitFile.file_id}: ${
              (e as Error).message
            }`
          );
        }
      }

      this.logger.log(
        `Retrieved ${unitVariableDetails.length} units with variables for workspace ${workspaceId}`
      );
      return unitVariableDetails;
    } catch (error) {
      this.logger.error(
        `Error getting unit variable details for workspace ${workspaceId}: ${error.message}`,
        error.stack
      );
      return [];
    }
  }
}
