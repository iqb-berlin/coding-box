import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fastCsv from 'fast-csv';
import * as ExcelJS from 'exceljs';
import { CodingScheme } from '@iqbspecs/coding-scheme/coding-scheme.interface';
import * as cheerio from 'cheerio';
import { ResponseEntity } from '../entities/response.entity';
import Persons from '../entities/persons.entity';
import { Unit } from '../entities/unit.entity';
import { Booklet } from '../entities/booklet.entity';
import { CacheService } from '../../cache/cache.service';
import { statusStringToNumber, statusNumberToString } from '../utils/response-status-converter';
import FileUpload from '../entities/file_upload.entity';

interface ExternalCodingRow {
  unit_key?: string;
  unit_alias?: string;
  variable_id?: string;
  status?: string;
  score?: string | number;
  code?: string | number;
  person_code?: string;
  person_login?: string;
  person_group?: string;
  booklet_name?: string;
  [key: string]: string | number | undefined;
}

export interface ExternalCodingImportBody {
  file: string; // base64 encoded file data
  fileName?: string;
  previewOnly?: boolean; // if true, only preview without applying changes
}

interface QueryParameters {
  unitAlias?: string;
  unitName?: string;
  variableId: string;
  workspaceId: number;
  personCode?: string;
  personLogin?: string;
  personGroup?: string;
  bookletName?: string;
}

@Injectable()
export class ExternalCodingImportService {
  private readonly logger = new Logger(ExternalCodingImportService.name);

  constructor(
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    @InjectRepository(Persons)
    private personRepository: Repository<Persons>,
    @InjectRepository(Unit)
    private unitRepository: Repository<Unit>,
    @InjectRepository(Booklet)
    private bookletRepository: Repository<Booklet>,
    @InjectRepository(FileUpload)
    private fileUploadRepository: Repository<FileUpload>,
    private cacheService: CacheService
  ) {}

  async importExternalCodingWithProgress(
    workspaceId: number,
    body: ExternalCodingImportBody,
    progressCallback: (progress: number, message: string) => void
  ): Promise<{
      message: string;
      processedRows: number;
      updatedRows: number;
      errors: string[];
      affectedRows: Array<{
        unitAlias: string;
        variableId: string;
        personCode?: string;
        personLogin?: string;
        personGroup?: string;
        bookletName?: string;
        originalCodedStatus: string;
        originalCode: number | null;
        originalScore: number | null;
        updatedCodedStatus: string | null;
        updatedCode: number | null;
        updatedScore: number | null;
      }>;
    }> {
    return this.importExternalCoding(workspaceId, body, progressCallback);
  }

  async importExternalCoding(
    workspaceId: number,
    body: ExternalCodingImportBody,
    progressCallback?: (progress: number, message: string) => void
  ): Promise<{
      message: string;
      processedRows: number;
      updatedRows: number;
      errors: string[];
      affectedRows: Array<{
        unitAlias: string;
        variableId: string;
        personCode?: string;
        personLogin?: string;
        personGroup?: string;
        bookletName?: string;
        originalCodedStatus: string;
        originalCode: number | null;
        originalScore: number | null;
        updatedCodedStatus: string | null;
        updatedCode: number | null;
        updatedScore: number | null;
      }>;
    }> {
    try {
      this.logger.log(`Starting external coding import for workspace ${workspaceId}`);
      progressCallback?.(5, 'Starting external coding import...');

      const fileData = body.file; // Assuming base64 encoded file data
      const fileName = body.fileName || 'external-coding.csv';

      let parsedData: ExternalCodingRow[] = [];
      const errors: string[] = [];

      progressCallback?.(10, 'Parsing file...');

      if (fileName.endsWith('.csv')) {
        parsedData = await this.parseCSVFile(fileData);
      } else if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
        parsedData = await this.parseExcelFile(fileData);
      } else {
        this.logger.error(`Unsupported file format: ${fileName}. Please use CSV or Excel files.`);
        return {
          message: 'Unsupported file format. Please use CSV or Excel files.',
          processedRows: 0,
          updatedRows: 0,
          errors: ['Unsupported file format. Please use CSV or Excel files.'],
          affectedRows: []
        };
      }

      this.logger.log(`Parsed ${parsedData.length} rows from external coding file`);
      progressCallback?.(20, `Parsed ${parsedData.length} rows from file`);

      const updatedRows = 0;
      const processedRows = parsedData.length;
      const affectedRows: Array<{
        unitAlias: string;
        variableId: string;
        personCode?: string;
        personLogin?: string;
        personGroup?: string;
        bookletName?: string;
        originalCodedStatus: string;
        originalCode: number | null;
        originalScore: number | null;
        updatedCodedStatus: string | null;
        updatedCode: number | null;
        updatedScore: number | null;
      }> = [];

      // Process data in batches for better performance
      const batchSize = 1000;
      const totalBatches = Math.ceil(parsedData.length / batchSize);

      this.logger.log(`Processing ${parsedData.length} rows in ${totalBatches} batches of ${batchSize}`);
      progressCallback?.(25, `Starting to process ${parsedData.length} rows in ${totalBatches} batches`);

      for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
        const batchStart = batchIndex * batchSize;
        const batchEnd = Math.min(batchStart + batchSize, parsedData.length);
        const batch = parsedData.slice(batchStart, batchEnd);

        this.logger.log(`Processing batch ${batchIndex + 1}/${totalBatches} (rows ${batchStart + 1}-${batchEnd})`);

        // Calculate progress: 25% start + 70% for batch processing
        const batchProgress = 25 + Math.floor(((batchIndex) / totalBatches) * 70);
        progressCallback?.(batchProgress, `Processing batch ${batchIndex + 1}/${totalBatches} (rows ${batchStart + 1}-${batchEnd})`);

        for (const row of batch) {
          try {
            const {
              unit_key: unitKey,
              unit_alias: unitAlias, variable_id: variableId, code,
              person_code: personCode, person_login: personLogin, person_group: personGroup, booklet_name: bookletName
            } = row;

            // Use unit_key if provided, otherwise fall back to unit_alias for backward compatibility
            const unitIdentifier = unitKey || unitAlias;

            if (!unitIdentifier || !variableId) {
              errors.push(`Row missing required fields: unit_key=${unitKey}, unit_alias=${unitAlias}, variable_id=${variableId}`);
              continue;
            }

            const queryBuilder = this.responseRepository
              .createQueryBuilder('response')
              .leftJoinAndSelect('response.unit', 'unit')
              .leftJoinAndSelect('unit.booklet', 'booklet')
              .leftJoinAndSelect('booklet.person', 'person')
              .leftJoinAndSelect('booklet.bookletinfo', 'bookletinfo');

            // Use unit.name if unit_key was provided, otherwise unit.alias for unit_alias
            if (unitKey) {
              queryBuilder.andWhere('unit.name = :unitIdentifier', { unitIdentifier });
            } else {
              queryBuilder.andWhere('unit.alias = :unitIdentifier', { unitIdentifier });
            }

            queryBuilder
              .andWhere('response.variableid = :variableId', { variableId })
              .andWhere('person.workspace_id = :workspaceId', { workspaceId });

            if (personCode) {
              queryBuilder.andWhere('person.code = :personCode', { personCode });
            }
            if (personLogin) {
              queryBuilder.andWhere('person.login = :personLogin', { personLogin });
            }
            if (personGroup) {
              queryBuilder.andWhere('person.group = :personGroup', { personGroup });
            }
            if (bookletName) {
              queryBuilder.andWhere('bookletinfo.name = :bookletName', { bookletName });
            }

            const queryParameters: QueryParameters = {
              unitAlias: unitAlias || unitKey,
              unitName: unitKey || unitAlias,
              variableId,
              workspaceId
            };

            if (personCode) {
              queryParameters.personCode = personCode;
            }
            if (personLogin) {
              queryParameters.personLogin = personLogin;
            }
            if (personGroup) {
              queryParameters.personGroup = personGroup;
            }
            if (bookletName) {
              queryParameters.bookletName = bookletName;
            }

            const responsesToUpdate = await queryBuilder.setParameters(queryParameters).getMany();

            if (responsesToUpdate.length > 0) {
              // Validate code against coding scheme for each response
              const validationPromises = responsesToUpdate.map(async response => {
                const parsedCode = code ? parseInt(code.toString(), 10) : null;
                const validation = await this.validateCodeAgainstScheme(
                  response.unit!,
                  variableId,
                  parsedCode
                );

                return {
                  responseId: response.id,
                  validatedStatus: validation.status,
                  validatedScore: validation.score,
                  validatedCode: parsedCode
                };
              });

              const validationResults = await Promise.all(validationPromises);

              // Only apply updates if not in preview mode
              if (!body.previewOnly) {
                // Update each response with validated status and score
                for (const validation of validationResults) {
                  await this.responseRepository
                    .createQueryBuilder()
                    .update(ResponseEntity)
                    .set({
                      status_v2: statusStringToNumber(validation.validatedStatus) || null,
                      code_v2: validation.validatedCode,
                      score_v2: validation.validatedScore
                    })
                    .where('id = :responseId', { responseId: validation.responseId })
                    .execute();
                }
              }

              // Add comparison data for each affected response
              responsesToUpdate.forEach((response, index) => {
                const validation = validationResults[index];
                const responsePersonLogin = response.unit?.booklet?.person?.login || undefined;
                const responsePersonCode = response.unit?.booklet?.person?.code || undefined;
                const responsePersonGroup = response.unit?.booklet?.person?.group || undefined;
                const responseBookletName = response.unit?.booklet?.bookletinfo?.name || undefined;

                // Debug logging to verify data is populated
                this.logger.debug(`Response ${response.id}: personLogin=${responsePersonLogin}, personCode=${responsePersonCode}, personGroup=${responsePersonGroup}, bookletName=${responseBookletName}`);
                this.logger.debug(`Validation result: status=${validation.validatedStatus}, score=${validation.validatedScore}, isValid=${validation.validatedStatus === 'CODING_COMPLETE'}`);

                affectedRows.push({
                  unitAlias: response.unit?.alias || unitAlias,
                  variableId,
                  personCode: responsePersonCode,
                  personLogin: responsePersonLogin,
                  personGroup: responsePersonGroup,
                  bookletName: responseBookletName,
                  originalCodedStatus: statusNumberToString(response.status_v1) || '',
                  originalCode: response.code_v1,
                  originalScore: response.score_v1,
                  updatedCodedStatus: validation.validatedStatus,
                  updatedCode: validation.validatedCode,
                  updatedScore: validation.validatedScore
                });
              });
            } else {
              const matchingCriteria = [`unit_alias=${unitAlias}`, `variable_id=${variableId}`];
              if (personCode) matchingCriteria.push(`person_code=${personCode}`);
              if (personLogin) matchingCriteria.push(`person_login=${personLogin}`);
              if (personGroup) matchingCriteria.push(`person_group=${personGroup}`);
              if (bookletName) matchingCriteria.push(`booklet_name=${bookletName}`);
              errors.push(`No response found for ${matchingCriteria.join(', ')}`);
            }
          } catch (rowError) {
            errors.push(`Error processing row: ${rowError.message}`);
            this.logger.error(`Error processing row: ${rowError.message}`, rowError.stack);
          }
        }

        // Small delay between batches to prevent overwhelming the database
        if (batchIndex < totalBatches - 1) {
          await new Promise(resolve => {
            setTimeout(resolve, 10);
          });
        }
      }

      const message = body.previewOnly ?
        `External coding preview completed. Processed ${processedRows} rows, ${updatedRows} response records would be updated.` :
        `External coding import completed. Processed ${processedRows} rows, updated ${updatedRows} response records.`;
      this.logger.log(message);
      progressCallback?.(100, body.previewOnly ?
        `Preview completed: ${updatedRows} of ${processedRows} rows would be updated` :
        `Import completed: ${updatedRows} of ${processedRows} rows updated`);

      // Invalidate cache if rows were actually updated (not preview mode)
      if (updatedRows > 0 && !body.previewOnly) {
        await this.invalidateIncompleteVariablesCache(workspaceId);
      }

      return {
        message,
        processedRows,
        updatedRows,
        errors,
        affectedRows
      };
    } catch (error) {
      this.logger.error(`Error importing external coding: ${error.message}`, error.stack);
      progressCallback?.(0, `Import failed: ${error.message}`);
      throw new Error(`Could not import external coding data: ${error.message}`);
    }
  }

  async applyExternalCoding(
    workspaceId: number,
    body: ExternalCodingImportBody,
    progressCallback?: (progress: number, message: string) => void
  ): Promise<{
      message: string;
      processedRows: number;
      updatedRows: number;
      errors: string[];
      affectedRows: Array<{
        unitAlias: string;
        variableId: string;
        personCode?: string;
        personLogin?: string;
        personGroup?: string;
        bookletName?: string;
        originalCodedStatus: string;
        originalCode: number | null;
        originalScore: number | null;
        updatedCodedStatus: string | null;
        updatedCode: number | null;
        updatedScore: number | null;
      }>;
    }> {
    // Set previewOnly to false for actual application
    return this.importExternalCoding(workspaceId, { ...body, previewOnly: false }, progressCallback);
  }

  private async getCodingSchemeForUnit(unit: Unit): Promise<CodingScheme | null> {
    try {
      // Get the unit's test file to access the coding scheme reference
      const testFile = await this.fileUploadRepository.findOne({
        where: { file_id: unit.alias.toUpperCase() }
      });

      if (!testFile) {
        this.logger.warn(`Test file not found for unit: ${unit.alias}`);
        return null;
      }

      // Load the unit test file XML to find coding scheme reference
      const $ = cheerio.load(testFile.data, { xmlMode: true });
      const codingSchemeRefText = $('codingSchemeRef').text();

      if (!codingSchemeRefText) {
        return null;
      }

      const codingSchemeRef = codingSchemeRefText.toUpperCase();

      // Get the coding scheme file from the database
      const codingSchemeFile = await this.fileUploadRepository.findOne({
        where: { file_id: codingSchemeRef }
      });

      if (!codingSchemeFile) {
        this.logger.warn(`Coding scheme file not found: ${codingSchemeRef}`);
        return null;
      }

      // Parse and return the coding scheme
      return new CodingScheme(Buffer.from(codingSchemeFile.data));
    } catch (error) {
      this.logger.error(`Error loading coding scheme for unit ${unit.id}: ${error.message}`, error.stack);
      return null;
    }
  }

  private async validateCodeAgainstScheme(
    unit: Unit,
    variableId: string,
    code: number | null
  ): Promise<{ isValid: boolean; score: number | null; status: string }> {
    try {
      const codingScheme = await this.getCodingSchemeForUnit(unit);

      if (!codingScheme) {
        // No coding scheme found, leave as CODING_INCOMPLETE
        return {
          isValid: false,
          score: null,
          status: 'CODING_INCOMPLETE'
        };
      }

      const variableCoding = Array.isArray(codingScheme.variableCodings) ?
        codingScheme.variableCodings.find(vc => vc.id === variableId) : null;

      if (!variableCoding) {
        // Variable not found in coding scheme, leave as CODING_INCOMPLETE
        return {
          isValid: false,
          score: null,
          status: 'CODING_INCOMPLETE'
        };
      }

      if (code === null || code === undefined) {
        // No code provided, leave as CODING_INCOMPLETE
        return {
          isValid: false,
          score: null,
          status: 'CODING_INCOMPLETE'
        };
      }

      // Check if the code exists in the variable's codes
      const codeDefinition = variableCoding.codes.find(c => c.id === code);

      if (!codeDefinition) {
        // Code not found in coding scheme, leave as CODING_INCOMPLETE
        return {
          isValid: false,
          score: null,
          status: 'CODING_INCOMPLETE'
        };
      }

      // Code is valid, return the score and CODING_COMPLETE status
      return {
        isValid: true,
        score: codeDefinition.score || 0,
        status: 'CODING_COMPLETE'
      };
    } catch (error) {
      this.logger.error(`Error validating code against scheme: ${error.message}`, error.stack);
      // On error, leave as CODING_INCOMPLETE
      return {
        isValid: false,
        score: null,
        status: 'CODING_INCOMPLETE'
      };
    }
  }

  private async parseCSVFile(fileData: string): Promise<ExternalCodingRow[]> {
    return new Promise((resolve, reject) => {
      const results: ExternalCodingRow[] = [];
      const buffer = Buffer.from(fileData, 'base64');
      let rowCount = 0;

      fastCsv.parseString(buffer.toString(), { headers: true })
        .on('error', error => reject(error))
        .on('data', row => {
          if (Object.values(row).some(value => value && value.toString().trim() !== '')) {
            results.push(row);
            rowCount += 1;

            // Log progress for large files
            if (rowCount % 10000 === 0) {
              this.logger.log(`Parsed ${rowCount} rows...`);
            }

            // Memory protection: limit to 200k rows to prevent memory overflow
            if (rowCount > 200000) {
              reject(new Error('File too large. Maximum 200,000 rows supported.'));
            }
          }
        })
        .on('end', () => {
          this.logger.log(`CSV parsing completed. Total rows: ${results.length}`);
          resolve(results);
        });
    });
  }

  private async parseExcelFile(fileData: string): Promise<ExternalCodingRow[]> {
    const buffer = Buffer.from(fileData, 'base64');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as Buffer);

    const worksheet = workbook.getWorksheet(1);
    if (!worksheet) {
      throw new Error('No worksheet found in Excel file');
    }

    const results: ExternalCodingRow[] = [];
    const headers: string[] = [];

    const headerRow = worksheet.getRow(1);
    headerRow.eachCell((cell, colNumber) => {
      headers[colNumber] = cell.text || cell.value?.toString() || '';
    });
    this.logger.log(`Starting Excel parsing. Total rows: ${worksheet.rowCount - 1}`);

    // Memory protection: limit to 200k rows
    const maxRows = Math.min(worksheet.rowCount, 200001); // +1 for header row
    if (worksheet.rowCount > 200001) {
      throw new Error('File too large. Maximum 200,000 rows supported.');
    }

    // Parse data rows
    for (let rowNumber = 2; rowNumber <= maxRows; rowNumber++) {
      const row = worksheet.getRow(rowNumber);
      const rowData: ExternalCodingRow = {};

      row.eachCell((cell, colNumber) => {
        const header = headers[colNumber];
        if (header) {
          rowData[header] = cell.text || cell.value?.toString() || '';
        }
      });

      // Only add non-empty rows
      if (Object.values(rowData).some(value => value && value.toString().trim() !== '')) {
        results.push(rowData);
      }

      // Log progress for large files
      if ((rowNumber - 1) % 10000 === 0) {
        this.logger.log(`Parsed ${rowNumber - 1} rows...`);
      }
    }

    this.logger.log(`Excel parsing completed. Total rows: ${results.length}`);
    return results;
  }

  private generateIncompleteVariablesCacheKey(workspaceId: number): string {
    return `coding_incomplete_variables:${workspaceId}`;
  }

  /**
   * Clear the CODING_INCOMPLETE variables cache for a specific workspace
   * Should be called whenever coding status changes for the workspace
   * @param workspaceId The workspace ID to clear cache for
   */
  async invalidateIncompleteVariablesCache(workspaceId: number): Promise<void> {
    const cacheKey = this.generateIncompleteVariablesCacheKey(workspaceId);
    await this.cacheService.delete(cacheKey);
    this.logger.log(`Invalidated CODING_INCOMPLETE variables cache for workspace ${workspaceId}`);
  }
}
