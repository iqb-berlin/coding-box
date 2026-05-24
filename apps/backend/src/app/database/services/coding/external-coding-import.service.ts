import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, QueryRunner, Repository } from 'typeorm';
import * as fastCsv from 'fast-csv';
import * as ExcelJS from 'exceljs';
import { CodingScheme } from '@iqbspecs/coding-scheme';
import * as cheerio from 'cheerio';
import { ResponseEntity } from '../../entities/response.entity';
import Persons from '../../entities/persons.entity';
import { Unit } from '../../entities/unit.entity';
import { Booklet } from '../../entities/booklet.entity';
import { CacheService } from '../../../cache/cache.service';
import { statusStringToNumber, statusNumberToString } from '../../utils/response-status-converter';
import FileUpload from '../../entities/file_upload.entity';
import { CodingFreshnessService } from './coding-freshness.service';
import { lockWorkspaceTestResultsMutationInTransaction } from '../shared/workspace-test-results-lock.util';
import { getCodingIncompleteVariablesCacheKey } from './coding-incomplete-variables-cache-key.util';

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
  rowNumber?: number;
  [key: string]: string | number | undefined;
}

type ExternalCodingSourceFormat = 'external-coding' | 'coding-list' | 'coding-results';
type ExternalCodingDetectedFormat = ExternalCodingSourceFormat | 'test-results' | 'test-logs' | 'unknown';
type ExternalCodingSourceVersion = 'v1' | 'v2' | 'v3';
type ExternalCodingScoreMode = 'import' | 'derive';
type ExternalCodingExistingCodingMode = 'skip-conflicts' | 'fill-empty' | 'overwrite';
type ExternalCodingImportAction = 'update' | 'skip' | 'unchanged';

interface ImportContext {
  detectedFormat: ExternalCodingDetectedFormat;
  sourceFormat?: ExternalCodingSourceFormat;
  sourceVersion?: ExternalCodingSourceVersion;
  headers: string[];
  canImport: boolean;
  errors: string[];
}

interface CodeValidationResult {
  isValid: boolean;
  score: number | null;
  status: string;
  reason?: string;
}

interface ExistingManualCoding {
  status: string | null;
  code: number | null;
  score: number | null;
  hasAnyValue: boolean;
}

interface ResolvedCoding {
  status: string;
  code: number | null;
  score: number | null;
}

interface ImportDecision {
  action: ExternalCodingImportAction;
  reason?: string;
  hasExistingCoding: boolean;
  hasConflict: boolean;
}

export interface ExternalCodingImportBody {
  file: string; // base64 encoded file data
  fileName?: string;
  previewOnly?: boolean; // if true, only preview without applying changes
  sourceFormat?: ExternalCodingSourceFormat;
  sourceVersion?: ExternalCodingSourceVersion;
  scoreMode?: ExternalCodingScoreMode;
  existingCodingMode?: ExternalCodingExistingCodingMode;
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
    private cacheService: CacheService,
    @Optional()
    private codingFreshnessService?: CodingFreshnessService
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
        importAction?: ExternalCodingImportAction;
        actionReason?: string;
        hasExistingCoding?: boolean;
        hasConflict?: boolean;
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
        importAction?: ExternalCodingImportAction;
        actionReason?: string;
        hasExistingCoding?: boolean;
        hasConflict?: boolean;
      }>;
    }> {
    let queryRunner: QueryRunner | undefined;
    let transactionCommitted = false;

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

      const importContext = this.createImportContext(parsedData, body);
      if (!importContext.canImport) {
        const message = 'Die Datei konnte nicht als Kodierungsimport verarbeitet werden.';
        return {
          message,
          processedRows: parsedData.length,
          updatedRows: 0,
          errors: importContext.errors,
          affectedRows: []
        };
      }

      let updatedRows = 0;
      let skippedRowsWithoutCoding = 0;
      const processedRows = parsedData.length;
      const existingCodingMode = body.existingCodingMode || 'skip-conflicts';
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
        importAction?: ExternalCodingImportAction;
        actionReason?: string;
        hasExistingCoding?: boolean;
        hasConflict?: boolean;
      }> = [];
      const updatedResponseIds: number[] = [];

      // Process data in batches for better performance
      const batchSize = 1000;
      const totalBatches = Math.ceil(parsedData.length / batchSize);

      this.logger.log(`Processing ${parsedData.length} rows in ${totalBatches} batches of ${batchSize}`);
      progressCallback?.(25, `Starting to process ${parsedData.length} rows in ${totalBatches} batches`);

      if (!body.previewOnly) {
        queryRunner = this.responseRepository.manager.connection.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction('READ COMMITTED');
        await lockWorkspaceTestResultsMutationInTransaction(queryRunner.manager, workspaceId);
      }

      const responseRepository = queryRunner ?
        queryRunner.manager.getRepository(ResponseEntity) :
        this.responseRepository;

      for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
        const batchStart = batchIndex * batchSize;
        const batchEnd = Math.min(batchStart + batchSize, parsedData.length);
        const batch = parsedData.slice(batchStart, batchEnd);

        this.logger.log(`Processing batch ${batchIndex + 1}/${totalBatches} (rows ${batchStart + 1}-${batchEnd})`);

        // Calculate progress: 25% start + 70% for batch processing
        const batchProgress = 25 + Math.floor(((batchIndex) / totalBatches) * 70);
        progressCallback?.(batchProgress, `Processing batch ${batchIndex + 1}/${totalBatches} (rows ${batchStart + 1}-${batchEnd})`);

        for (const rawRow of batch) {
          try {
            const row = this.normalizeRowForImport(rawRow, importContext);
            const {
              unit_key: unitKey,
              unit_alias: unitAlias, variable_id: variableId, code, score, status,
              person_code: personCode, person_login: personLogin, person_group: personGroup, booklet_name: bookletName
            } = row;
            const rowPrefix = this.getRowPrefix(row);

            // Use unit_key if provided, otherwise fall back to unit_alias for backward compatibility
            const unitIdentifier = unitKey || unitAlias;

            if (!unitIdentifier || !variableId) {
              errors.push(`${rowPrefix}Pflichtfelder fehlen: unit_key/unit_alias=${unitIdentifier || ''}, variable_id=${variableId || ''}`);
              continue;
            }

            if (!this.hasCodingValue(row)) {
              if (importContext.sourceFormat === 'coding-list' || importContext.sourceFormat === 'coding-results') {
                skippedRowsWithoutCoding += 1;
                continue;
              }
              errors.push(`${rowPrefix}Keine Kodierungsspalte mit Wert gefunden. Erwartet wird mindestens 'code', 'score' oder 'status'.`);
              continue;
            }

            const parsedCode = this.parseOptionalInteger(code);
            if (!parsedCode.valid) {
              errors.push(`${rowPrefix}Ungültiger Code '${code}'. Bitte eine ganze Zahl verwenden.`);
              continue;
            }

            const parsedScore = this.parseOptionalInteger(score);
            if (!parsedScore.valid) {
              errors.push(`${rowPrefix}Ungültiger Score '${score}'. Bitte eine ganze Zahl verwenden.`);
              continue;
            }

            const parsedStatus = this.parseOptionalStatus(status);
            if (!parsedStatus.valid) {
              errors.push(`${rowPrefix}Ungültiger Status '${status}'. Bitte einen bekannten Status wie CODING_COMPLETE oder CODING_INCOMPLETE verwenden.`);
              continue;
            }

            const queryBuilder = responseRepository
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
                const validation = await this.validateCodeAgainstScheme(
                  response.unit!,
                  variableId,
                  parsedCode.value
                );
                const resolvedCoding = this.resolveImportedCoding(
                  parsedCode.value,
                  parsedScore.value,
                  parsedStatus.value,
                  validation,
                  body.scoreMode || 'import',
                  rowPrefix
                );
                const targetCoding: ResolvedCoding = {
                  status: resolvedCoding.status,
                  code: parsedCode.value,
                  score: resolvedCoding.score
                };
                const existingCoding = this.getExistingManualCoding(response);
                const decision = this.resolveExistingCodingDecision(
                  existingCoding,
                  targetCoding,
                  existingCodingMode
                );

                return {
                  responseId: response.id,
                  validatedStatus: resolvedCoding.status,
                  validatedScore: resolvedCoding.score,
                  validatedCode: parsedCode.value,
                  warnings: resolvedCoding.warnings,
                  decision,
                  existingCoding
                };
              });

              const validationResults = await Promise.all(validationPromises);
              validationResults.forEach(validation => {
                errors.push(...validation.warnings);
                if (validation.decision.reason && validation.decision.action === 'skip') {
                  errors.push(`${rowPrefix}${validation.decision.reason}`);
                }
              });

              // Only apply updates if not in preview mode
              if (!body.previewOnly) {
                // Update each response with validated status and score
                for (const validation of validationResults.filter(result => result.decision.action === 'update')) {
                  await responseRepository
                    .createQueryBuilder()
                    .update(ResponseEntity)
                    .set({
                      status_v2: statusStringToNumber(validation.validatedStatus) ?? null,
                      code_v2: validation.validatedCode,
                      score_v2: validation.validatedScore
                    })
                    .where('id = :responseId', { responseId: validation.responseId })
                    .execute();
                  updatedResponseIds.push(validation.responseId);
                }
              }
              updatedRows += validationResults.filter(result => result.decision.action === 'update').length;

              // Add comparison data for each affected response
              responsesToUpdate.forEach((response, index) => {
                const validation = validationResults[index];
                const responsePersonLogin = response.unit?.booklet?.person?.login || undefined;
                const responsePersonCode = response.unit?.booklet?.person?.code || undefined;
                const responsePersonGroup = response.unit?.booklet?.person?.group || undefined;
                const responseBookletName = response.unit?.booklet?.bookletinfo?.name || undefined;
                const originalStatus = response.status_v2 ?? response.status_v1;

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
                  originalCodedStatus: originalStatus != null ? statusNumberToString(originalStatus) || '' : '',
                  originalCode: response.code_v2 ?? response.code_v1,
                  originalScore: response.score_v2 ?? response.score_v1,
                  updatedCodedStatus: validation.validatedStatus,
                  updatedCode: validation.validatedCode,
                  updatedScore: validation.validatedScore,
                  importAction: validation.decision.action,
                  actionReason: validation.decision.reason,
                  hasExistingCoding: validation.decision.hasExistingCoding,
                  hasConflict: validation.decision.hasConflict
                });
              });
            } else {
              const matchingCriteria = [`unit_key/unit_alias=${unitIdentifier}`, `variable_id=${variableId}`];
              if (personCode) matchingCriteria.push(`person_code=${personCode}`);
              if (personLogin) matchingCriteria.push(`person_login=${personLogin}`);
              if (personGroup) matchingCriteria.push(`person_group=${personGroup}`);
              if (bookletName) matchingCriteria.push(`booklet_name=${bookletName}`);
              errors.push(`${rowPrefix}Keine passende Antwort gefunden für ${matchingCriteria.join(', ')}`);
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

      if (skippedRowsWithoutCoding > 0) {
        errors.push(
          skippedRowsWithoutCoding === 1 ?
            '1 Zeile ohne Kodierungswerte wurde übersprungen.' :
            `${skippedRowsWithoutCoding} Zeilen ohne Kodierungswerte wurden übersprungen.`
        );
      }

      this.logger.log(message);
      progressCallback?.(100, body.previewOnly ?
        `Preview completed: ${updatedRows} of ${processedRows} rows would be updated` :
        `Import completed: ${updatedRows} of ${processedRows} rows updated`);

      // Invalidate cache if rows were actually updated (not preview mode)
      if (updatedRows > 0 && !body.previewOnly) {
        await this.markManualFreshnessCurrent(
          workspaceId,
          updatedResponseIds,
          queryRunner?.manager
        );
      }

      if (queryRunner) {
        await queryRunner.commitTransaction();
        transactionCommitted = true;
      }

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
      if (queryRunner && !transactionCommitted) {
        try {
          await queryRunner.rollbackTransaction();
        } catch (rollbackError) {
          this.logger.error(
            `Error rolling back external coding import: ${rollbackError.message}`,
            rollbackError.stack
          );
        }
      }
      this.logger.error(`Error importing external coding: ${error.message}`, error.stack);
      progressCallback?.(0, `Import failed: ${error.message}`);
      throw new Error(`Could not import external coding data: ${error.message}`);
    } finally {
      if (queryRunner) {
        await queryRunner.release();
      }
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
        importAction?: ExternalCodingImportAction;
        actionReason?: string;
        hasExistingCoding?: boolean;
        hasConflict?: boolean;
      }>;
    }> {
    // Set previewOnly to false for actual application
    return this.importExternalCoding(workspaceId, { ...body, previewOnly: false }, progressCallback);
  }

  private async markManualFreshnessCurrent(
    workspaceId: number,
    responseIds: number[],
    manager?: EntityManager
  ): Promise<void> {
    if (!this.codingFreshnessService || responseIds.length === 0) {
      return;
    }

    await this.codingFreshnessService.markManualCodingCurrent(
      workspaceId,
      responseIds,
      { clearCoveredReviewJobs: true, manager }
    );
  }

  private createImportContext(
    parsedData: ExternalCodingRow[],
    body: ExternalCodingImportBody
  ): ImportContext {
    const headers = this.getHeaders(parsedData);
    const detectedFormat = body.sourceFormat || this.detectFormat(headers);
    const errors = this.getFormatErrors(detectedFormat, headers);

    if (errors.length > 0) {
      return {
        detectedFormat,
        headers,
        canImport: false,
        errors
      };
    }

    if (detectedFormat === 'coding-results') {
      const sourceVersion = this.resolveSourceVersion(headers, body.sourceVersion);
      if (!sourceVersion) {
        return {
          detectedFormat,
          headers,
          canImport: false,
          errors: [
            'Die Datei wurde als Kodierergebnis-Export erkannt, aber es wurde keine importierbare Version gefunden. Erwartet werden Spalten wie status_v1/code_v1/score_v1, status_v2/code_v2/score_v2 oder status_v3/code_v3/score_v3.'
          ]
        };
      }

      return {
        detectedFormat,
        sourceFormat: 'coding-results',
        sourceVersion,
        headers,
        canImport: true,
        errors: []
      };
    }

    return {
      detectedFormat,
      sourceFormat: detectedFormat === 'coding-list' ? 'coding-list' : 'external-coding',
      headers,
      canImport: true,
      errors: []
    };
  }

  private getHeaders(parsedData: ExternalCodingRow[]): string[] {
    const headerSet = new Set<string>();
    parsedData.forEach(row => {
      Object.keys(row)
        .filter(key => key !== 'rowNumber')
        .forEach(key => headerSet.add(this.normalizeHeader(key)));
    });
    return Array.from(headerSet);
  }

  private detectFormat(headers: string[]): ExternalCodingDetectedFormat {
    const has = (header: string) => headers.includes(header);
    const hasAny = (candidates: string[]) => candidates.some(candidate => has(candidate));

    if (
      has('groupname') &&
        has('loginname') &&
        has('code') &&
        has('bookletname') &&
        has('unitname') &&
        has('timestamp') &&
        has('logentry')
    ) {
      return 'test-logs';
    }

    if (
      has('groupname') &&
        has('loginname') &&
        has('code') &&
        has('bookletname') &&
        has('unitname') &&
        has('responses')
    ) {
      return 'test-results';
    }

    if (
      has('variable_id') &&
        hasAny([
          'status_v1', 'code_v1', 'score_v1',
          'status_v2', 'code_v2', 'score_v2',
          'status_v3', 'code_v3', 'score_v3'
        ])
    ) {
      return 'coding-results';
    }

    if (has('variable_id') && (has('unit_key') || has('unit_alias'))) {
      if (
        hasAny(['status', 'code', 'score']) ||
          hasAny(['person_login', 'person_code', 'person_group', 'booklet_name', 'variable_page', 'variable_anchor'])
      ) {
        return hasAny(['variable_page', 'variable_anchor']) ? 'coding-list' : 'external-coding';
      }
    }

    return 'unknown';
  }

  private getFormatErrors(
    detectedFormat: ExternalCodingDetectedFormat,
    headers: string[]
  ): string[] {
    if (headers.length === 0) {
      return [
        'Die Datei enthält keine lesbaren Spaltenüberschriften. Bitte prüfen Sie, ob die erste Zeile die Header enthält.'
      ];
    }

    if (detectedFormat === 'test-results') {
      return [
        'Die Datei wurde als Testergebnisse-Export erkannt. Bitte importieren Sie diese Datei über "Testergebnisse > Import > Antworten hochladen"; sie ist kein Code-/Score-Import.',
        `Erkannte Spalten: ${headers.join(', ')}`
      ];
    }

    if (detectedFormat === 'test-logs') {
      return [
        'Die Datei wurde als Testlogs-Export erkannt. Bitte importieren Sie diese Datei über "Testergebnisse > Import > Logs hochladen"; sie ist kein Code-/Score-Import.',
        `Erkannte Spalten: ${headers.join(', ')}`
      ];
    }

    if (detectedFormat === 'unknown') {
      return [
        'Die Datei konnte keinem unterstützten Kodierungsformat zugeordnet werden.',
        'Erwartet wird entweder eine Kodierliste mit unit_key oder unit_alias, variable_id und mindestens einer Spalte code, score oder status, oder ein Kodierergebnis-Export mit status_v*/code_v*/score_v*.',
        `Erkannte Spalten: ${headers.join(', ')}`
      ];
    }

    const hasCodingValue = ['status', 'code', 'score'].some(header => headers.includes(header));
    if ((detectedFormat === 'external-coding' || detectedFormat === 'coding-list') && !hasCodingValue) {
      return [
        'Die Datei wurde als Kodierliste erkannt, enthält aber keine importierbaren Kodierungsspalten.',
        'Bitte ergänzen Sie mindestens eine der Spalten code, score oder status.'
      ];
    }

    return [];
  }

  private resolveSourceVersion(
    headers: string[],
    requestedVersion?: ExternalCodingSourceVersion
  ): ExternalCodingSourceVersion | undefined {
    const hasVersion = (version: ExternalCodingSourceVersion) => (
      headers.includes(`status_${version}`) ||
        headers.includes(`code_${version}`) ||
        headers.includes(`score_${version}`)
    );

    if (requestedVersion && hasVersion(requestedVersion)) {
      return requestedVersion;
    }

    return (['v3', 'v2', 'v1'] as ExternalCodingSourceVersion[])
      .find(version => hasVersion(version));
  }

  private normalizeRowForImport(
    row: ExternalCodingRow,
    context: ImportContext
  ): ExternalCodingRow {
    if (context.sourceFormat !== 'coding-results' || !context.sourceVersion) {
      return row;
    }

    return {
      ...row,
      status: this.normalizeCellValue(row[`status_${context.sourceVersion}`]),
      code: row[`code_${context.sourceVersion}`],
      score: row[`score_${context.sourceVersion}`]
    };
  }

  private hasCodingValue(row: ExternalCodingRow): boolean {
    return [row.status, row.code, row.score]
      .some(value => this.normalizeCellValue(value) !== '');
  }

  private getRowPrefix(row: ExternalCodingRow): string {
    return row.rowNumber ? `Zeile ${row.rowNumber}: ` : '';
  }

  private parseOptionalInteger(value: string | number | undefined): { value: number | null; valid: boolean } {
    const normalized = this.normalizeCellValue(value);
    if (normalized === '') {
      return { value: null, valid: true };
    }

    const parsed = Number(normalized.replace(',', '.'));
    return Number.isInteger(parsed) ?
      { value: parsed, valid: true } :
      { value: null, valid: false };
  }

  private parseOptionalStatus(value: string | number | undefined): { value: string | null; valid: boolean } {
    const normalized = this.normalizeCellValue(value);
    if (normalized === '') {
      return { value: null, valid: true };
    }

    const statusCandidate = /^\d+$/.test(normalized) ?
      statusNumberToString(Number(normalized)) :
      normalized.toUpperCase();

    if (!statusCandidate || statusStringToNumber(statusCandidate) === null) {
      return { value: null, valid: false };
    }

    return { value: statusCandidate, valid: true };
  }

  private resolveImportedCoding(
    code: number | null,
    score: number | null,
    status: string | null,
    validation: CodeValidationResult,
    scoreMode: ExternalCodingScoreMode,
    rowPrefix: string
  ): { status: string; score: number | null; warnings: string[] } {
    const warnings: string[] = [];
    const shouldUseImportedScore = scoreMode !== 'derive' && score !== null;
    let resolvedScore = shouldUseImportedScore ? score : validation.score;

    if (code !== null && validation.reason) {
      warnings.push(`${rowPrefix}${validation.reason}`);
    }

    if (
      code !== null &&
        validation.isValid &&
        score !== null &&
        validation.score !== null &&
        score !== validation.score
    ) {
      warnings.push(`${rowPrefix}Der importierte Score ${score} weicht vom Score ${validation.score} im Kodierschema ab. Der importierte Score wird übernommen.`);
    }

    if (scoreMode === 'derive' && !validation.isValid) {
      resolvedScore = null;
    }

    if (status) {
      return { status, score: resolvedScore, warnings };
    }

    if (validation.isValid) {
      return { status: 'CODING_COMPLETE', score: resolvedScore, warnings };
    }

    if (code !== null && score !== null) {
      return { status: 'CODING_COMPLETE', score: resolvedScore, warnings };
    }

    return { status: 'CODING_INCOMPLETE', score: resolvedScore, warnings };
  }

  private getExistingManualCoding(response: ResponseEntity): ExistingManualCoding {
    const status = response.status_v2 != null ? statusNumberToString(response.status_v2) || null : null;
    const code = response.code_v2 ?? null;
    const score = response.score_v2 ?? null;

    return {
      status,
      code,
      score,
      hasAnyValue: status !== null || code !== null || score !== null
    };
  }

  private resolveExistingCodingDecision(
    existingCoding: ExistingManualCoding,
    targetCoding: ResolvedCoding,
    existingCodingMode: ExternalCodingExistingCodingMode
  ): ImportDecision {
    const hasConflict = this.hasExistingCodingConflict(existingCoding, targetCoding);
    const hasTargetChange = this.hasTargetCodingChange(existingCoding, targetCoding);

    if (!existingCoding.hasAnyValue) {
      return {
        action: 'update',
        hasExistingCoding: false,
        hasConflict: false
      };
    }

    if (existingCodingMode === 'fill-empty') {
      return {
        action: 'skip',
        reason: 'Bestehende manuelle Kodierung vorhanden. Im Modus "Nur leere Kodierungen füllen" wird diese Zeile übersprungen.',
        hasExistingCoding: true,
        hasConflict
      };
    }

    if (existingCodingMode === 'skip-conflicts' && hasConflict) {
      return {
        action: 'skip',
        reason: 'Konflikt mit vorhandener manueller Kodierung. Die vorhandenen Werte werden nicht überschrieben.',
        hasExistingCoding: true,
        hasConflict: true
      };
    }

    if (!hasTargetChange) {
      return {
        action: 'unchanged',
        reason: 'Die vorhandene manuelle Kodierung ist bereits identisch.',
        hasExistingCoding: true,
        hasConflict: false
      };
    }

    return {
      action: 'update',
      reason: existingCodingMode === 'overwrite' ?
        'Bestehende manuelle Kodierung wird überschrieben.' :
        'Vorhandene manuelle Kodierung wird ohne Konflikt ergänzt.',
      hasExistingCoding: true,
      hasConflict: false
    };
  }

  private hasExistingCodingConflict(
    existingCoding: ExistingManualCoding,
    targetCoding: ResolvedCoding
  ): boolean {
    return (
      this.hasConflictingValue(existingCoding.status, targetCoding.status) ||
      this.hasConflictingValue(existingCoding.code, targetCoding.code) ||
      this.hasConflictingValue(existingCoding.score, targetCoding.score)
    );
  }

  private hasConflictingValue<T>(existingValue: T | null, targetValue: T | null): boolean {
    return existingValue !== null && existingValue !== targetValue;
  }

  private hasTargetCodingChange(
    existingCoding: ExistingManualCoding,
    targetCoding: ResolvedCoding
  ): boolean {
    return (
      existingCoding.status !== targetCoding.status ||
      existingCoding.code !== targetCoding.code ||
      existingCoding.score !== targetCoding.score
    );
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
  ): Promise<CodeValidationResult> {
    try {
      const codingScheme = await this.getCodingSchemeForUnit(unit);

      if (!codingScheme) {
        // No coding scheme found, leave as CODING_INCOMPLETE
        return {
          isValid: false,
          score: null,
          status: 'CODING_INCOMPLETE',
          reason: `Kein Kodierschema für Unit '${unit.alias || unit.name}' gefunden. Code und Score werden als externe Kodierung übernommen, soweit vorhanden.`
        };
      }

      const variableCoding = Array.isArray(codingScheme.variableCodings) ?
        codingScheme.variableCodings.find(vc => vc.id === variableId) : null;

      if (!variableCoding) {
        // Variable not found in coding scheme, leave as CODING_INCOMPLETE
        return {
          isValid: false,
          score: null,
          status: 'CODING_INCOMPLETE',
          reason: `Variable '${variableId}' wurde im Kodierschema nicht gefunden. Code und Score werden als externe Kodierung übernommen, soweit vorhanden.`
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
          status: 'CODING_INCOMPLETE',
          reason: `Code '${code}' wurde im Kodierschema für Variable '${variableId}' nicht gefunden. Code und Score werden als externe Kodierung übernommen, soweit vorhanden.`
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

  private normalizeHeader(header: unknown): string {
    return String(header ?? '')
      .replace(/^\uFEFF/, '')
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_');
  }

  private normalizeCellValue(value: unknown): string {
    if (value === null || value === undefined) {
      return '';
    }
    return String(value).trim();
  }

  private detectCsvDelimiter(csvText: string): ';' | ',' | '\t' {
    const firstDataLine = csvText
      .split(/\r?\n/)
      .find(line => line.trim().length > 0) || '';
    const candidates: Array<';' | ',' | '\t'> = [';', ',', '\t'];
    let selected: ';' | ',' | '\t' = ',';
    let bestCount = -1;

    candidates.forEach(candidate => {
      const count = this.countDelimiterOutsideQuotes(firstDataLine, candidate);
      if (count > bestCount) {
        bestCount = count;
        selected = candidate;
      }
    });

    return selected;
  }

  private countDelimiterOutsideQuotes(line: string, delimiter: string): number {
    let count = 0;
    let inQuotes = false;

    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (!inQuotes && char === delimiter) {
        count += 1;
      }
    }

    return count;
  }

  private async parseCSVFile(fileData: string): Promise<ExternalCodingRow[]> {
    return new Promise((resolve, reject) => {
      const results: ExternalCodingRow[] = [];
      const buffer = Buffer.from(fileData, 'base64');
      const csvText = buffer.toString().replace(/^\uFEFF/, '');
      const delimiter = this.detectCsvDelimiter(csvText);
      let rowCount = 0;

      fastCsv.parseString(csvText, {
        headers: (headers: string[]) => headers.map(header => this.normalizeHeader(header)),
        delimiter
      })
        .on('error', error => reject(error))
        .on('data', row => {
          if (Object.values(row).some(value => value && value.toString().trim() !== '')) {
            rowCount += 1;
            const normalizedRow: ExternalCodingRow = {};
            Object.keys(row).forEach(key => {
              normalizedRow[this.normalizeHeader(key)] = this.normalizeCellValue(row[key]);
            });
            normalizedRow.rowNumber = rowCount + 1;
            results.push(normalizedRow);

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
      headers[colNumber] = this.normalizeHeader(cell.text || cell.value?.toString() || '');
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
          rowData[header] = this.normalizeCellValue(cell.text || cell.value?.toString() || '');
        }
      });
      rowData.rowNumber = rowNumber;

      // Only add non-empty rows
      if (Object.entries(rowData).some(([key, value]) => key !== 'rowNumber' && value && value.toString().trim() !== '')) {
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
    return getCodingIncompleteVariablesCacheKey(workspaceId);
  }

  /**
   * Clear the manual coding variables cache for a specific workspace
   * Should be called whenever coding status changes for the workspace
   * @param workspaceId The workspace ID to clear cache for
   */
  async invalidateIncompleteVariablesCache(workspaceId: number): Promise<void> {
    const cacheKey = this.generateIncompleteVariablesCacheKey(workspaceId);
    await this.cacheService.delete(cacheKey);
    this.logger.log(`Invalidated manual coding variables cache for workspace ${workspaceId}`);
  }
}
