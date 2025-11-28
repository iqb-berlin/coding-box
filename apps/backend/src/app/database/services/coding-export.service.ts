import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  In, IsNull, Not, Repository
} from 'typeorm';
import * as ExcelJS from 'exceljs';
import { Request } from 'express';
import { statusStringToNumber } from '../utils/response-status-converter';
import { CacheService } from '../../cache/cache.service';
import { MissingsProfilesService } from './missings-profiles.service';
import { WorkspaceFilesService } from './workspace-files.service';
import { CodingListService } from './coding-list.service';
import FileUpload from '../entities/file_upload.entity';
import Persons from '../entities/persons.entity';
import { Unit } from '../entities/unit.entity';
import { ResponseEntity } from '../entities/response.entity';
import { CodingJob } from '../entities/coding-job.entity';
import { CodingJobCoder } from '../entities/coding-job-coder.entity';
import { CodingJobVariable } from '../entities/coding-job-variable.entity';
import { CodingJobUnit } from '../entities/coding-job-unit.entity';

@Injectable()
export class CodingExportService {
  private readonly logger = new Logger(CodingExportService.name);

  constructor(
    @InjectRepository(FileUpload)
    private fileUploadRepository: Repository<FileUpload>,
    @InjectRepository(Persons)
    private personsRepository: Repository<Persons>,
    @InjectRepository(Unit)
    private unitRepository: Repository<Unit>,
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    @InjectRepository(CodingJob)
    private codingJobRepository: Repository<CodingJob>,
    @InjectRepository(CodingJobCoder)
    private codingJobCoderRepository: Repository<CodingJobCoder>,
    @InjectRepository(CodingJobVariable)
    private codingJobVariableRepository: Repository<CodingJobVariable>,
    @InjectRepository(CodingJobUnit)
    private codingJobUnitRepository: Repository<CodingJobUnit>,
    private cacheService: CacheService,
    private missingsProfilesService: MissingsProfilesService,
    private workspaceFilesService: WorkspaceFilesService,
    private codingListService: CodingListService
  ) {}

  private generateReplayUrl(
    req: Request,
    loginName: string,
    loginCode: string,
    group: string,
    bookletId: string,
    unitName: string,
    variableId: string,
    authToken: string
  ): string {
    if (!loginName || !loginCode || !bookletId || !unitName || !variableId) {
      return '';
    }

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const variablePage = '0';

    const encodedLoginName = encodeURIComponent(loginName);
    const encodedLoginCode = encodeURIComponent(loginCode);
    const encodedGroup = encodeURIComponent(group || '');
    const encodedBookletId = encodeURIComponent(bookletId);
    const encodedUnitName = encodeURIComponent(unitName);
    const encodedVariablePage = encodeURIComponent(variablePage);
    const encodedVariableId = encodeURIComponent(variableId);
    const encodedAuthToken = encodeURIComponent(authToken || '');

    return `${baseUrl}/#/replay/${encodedLoginName}@${encodedLoginCode}@${encodedGroup}@${encodedBookletId}/${encodedUnitName}/${encodedVariablePage}/${encodedVariableId}?auth=${encodedAuthToken}`;
  }

  private getLatestCode(response: ResponseEntity): { code: number | null; score: number | null; version: string } {
    // Priority: v3 > v2 > v1
    if (response.code_v3 !== null && response.code_v3 !== undefined) {
      return { code: response.code_v3, score: response.score_v3, version: 'v3' };
    }
    if (response.code_v2 !== null && response.code_v2 !== undefined) {
      return { code: response.code_v2, score: response.score_v2, version: 'v2' };
    }
    return { code: response.code_v1, score: response.score_v1, version: 'v1' };
  }

  private generateUniqueWorksheetName(workbook: ExcelJS.Workbook, baseName: string): string {
    // Clean the base name and limit to 20 characters initially
    // First decode any URL encoding, then replace special characters with underscores
    let cleanName = decodeURIComponent(baseName).replace(/[^a-zA-Z0-9\s\-_]/g, '_').substring(0, 20).trim();

    // If empty after cleaning, use a default
    if (!cleanName) {
      cleanName = 'Sheet';
    }

    let finalName = cleanName;
    let counter = 1;

    // Keep trying until we find a unique name
    while (workbook.getWorksheet(finalName)) {
      const suffix = `_${counter}`;
      const availableLength = 31 - suffix.length; // Excel limit is 31 chars
      finalName = cleanName.substring(0, availableLength) + suffix;
      counter += 1;

      // Safety check to prevent infinite loop
      if (counter > 1000) {
        finalName = `Sheet_${Date.now()}`;
        break;
      }
    }

    return finalName;
  }

  private buildCoderNameMapping(coders: string[], usePseudo: boolean): Map<string, string> {
    const mapping = new Map<string, string>();

    if (usePseudo) {
      // For pseudo mode: always use K1 and K2 for any pair of coders
      // Sort alphabetically for deterministic assignment
      const sortedCoders = [...coders].sort();
      sortedCoders.forEach((coder, index) => {
        mapping.set(coder, `K${index + 1}`);
      });
    } else {
      // For regular anonymization: shuffle and assign K1, K2, K3, etc.
      const shuffledCoders = [...coders].sort(() => Math.random() - 0.5);
      shuffledCoders.forEach((coder, index) => {
        mapping.set(coder, `K${index + 1}`);
      });
    }

    return mapping;
  }

  async exportCodingResultsAggregated(
    workspaceId: number,
    outputCommentsInsteadOfCodes = false,
    includeReplayUrl = false,
    anonymizeCoders = false,
    usePseudoCoders = false,
    doubleCodingMethod: 'new-row-per-variable' | 'new-column-per-coder' | 'most-frequent' = 'most-frequent',
    includeComments = false,
    includeModalValue = false,
    authToken = '',
    req?: Request,
    excludeAutoCoded = false,
    checkCancellation?: () => Promise<void>
  ): Promise<Buffer> {
    this.logger.log(`Exporting aggregated coding results for workspace ${workspaceId} with method: ${doubleCodingMethod}${outputCommentsInsteadOfCodes ? ' with comments instead of codes' : ''}${includeReplayUrl ? ' with replay URLs' : ''}${anonymizeCoders ? ' with anonymized coders' : ''}${excludeAutoCoded ? ' (manual coding only)' : ' (including auto-coded)'}`);

    if (doubleCodingMethod === 'new-row-per-variable') {
      return this.exportAggregatedNewRowPerVariable(workspaceId, outputCommentsInsteadOfCodes, includeReplayUrl, anonymizeCoders, usePseudoCoders, includeComments, includeModalValue, authToken, req, excludeAutoCoded, checkCancellation);
    } if (doubleCodingMethod === 'new-column-per-coder') {
      return this.exportAggregatedNewColumnPerCoder(workspaceId, outputCommentsInsteadOfCodes, anonymizeCoders, usePseudoCoders, includeComments, includeModalValue, excludeAutoCoded, checkCancellation);
    }
    this.logger.log(`Exporting aggregated results with most-frequent method for workspace ${workspaceId}`);

    if (checkCancellation) await checkCancellation();

    let manualCodingVariableSet: Set<string> | null = null;
    if (excludeAutoCoded) {
      const codingListVariables = await this.codingListService.getCodingListVariables(workspaceId);
      if (codingListVariables.length === 0) {
        throw new Error('No manual coding variables found in the coding list for this workspace');
      }
      this.logger.log(`Found ${codingListVariables.length} unique unit-variable combinations for workspace ${workspaceId}`);
      manualCodingVariableSet = new Set<string>();
      codingListVariables.forEach(item => {
        manualCodingVariableSet.add(`${item.unitName}|${item.variableId}`);
      });
    }

    const codingJobUnits = await this.codingJobUnitRepository.find({
      where: {
        coding_job: {
          workspace_id: workspaceId
        }
      },
      relations: [
        'coding_job',
        'coding_job.codingJobCoders',
        'coding_job.codingJobCoders.user',
        'response',
        'response.unit',
        'response.unit.booklet',
        'response.unit.booklet.bookletinfo',
        'response.unit.booklet.person'
      ]
    });

    if (codingJobUnits.length === 0) {
      throw new Error('No coding jobs found for this workspace');
    }

    if (checkCancellation) await checkCancellation();

    try {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Coding Results');

      const testPersonVariableCodes = new Map<string, Map<string, number[]>>();
      const testPersonVariableComments = new Map<string, Map<string, string[]>>();
      const testPersonList: string[] = [];
      const variableSet = new Set<string>();
      const personGroups = new Map<string, string>();
      const personBooklets = new Map<string, string>();
      const variableUnitNames = new Map<string, string>();

      for (const unit of codingJobUnits) {
        const person = unit.response?.unit?.booklet?.person;
        if (!person) continue;

        const testPersonKey = `${person.login}_${person.code}`;
        const variableId = unit.variable_id;
        const unitName = unit.unit_name;

        if (!unitName || !variableId) continue;

        if (manualCodingVariableSet) {
          const variableKey = `${unitName}|${variableId}`;
          if (!manualCodingVariableSet.has(variableKey)) {
            continue;
          }
        }

        const compositeVariableKey = `${unitName}_${variableId}`;

        const code = unit.response?.code_v3 ?? unit.response?.code_v2 ?? unit.response?.code_v1 ?? null;
        const comment = unit.notes || null;

        if (!testPersonVariableCodes.has(testPersonKey)) {
          testPersonVariableCodes.set(testPersonKey, new Map());
          testPersonVariableComments.set(testPersonKey, new Map());
          testPersonList.push(testPersonKey);
        }

        if (!testPersonVariableCodes.get(testPersonKey)!.has(compositeVariableKey)) {
          testPersonVariableCodes.get(testPersonKey)!.set(compositeVariableKey, []);
          testPersonVariableComments.get(testPersonKey)!.set(compositeVariableKey, []);
        }

        if (code !== null && code !== undefined) {
          testPersonVariableCodes.get(testPersonKey)!.get(compositeVariableKey)!.push(code);
        }

        if (comment) {
          const coderName = unit.coding_job?.codingJobCoders?.[0]?.user?.username || `Job ${unit.coding_job_id}`;
          testPersonVariableComments.get(testPersonKey)!.get(compositeVariableKey)!.push(`${coderName}: ${comment}`);
        }

        variableSet.add(compositeVariableKey);

        if (!personGroups.has(testPersonKey)) {
          personGroups.set(testPersonKey, person.group || '');
        }
        if (!personBooklets.has(testPersonKey)) {
          const bookletName = unit.response?.unit?.booklet?.bookletinfo?.name || '';
          personBooklets.set(testPersonKey, bookletName);
        }
        if (!variableUnitNames.has(compositeVariableKey)) {
          variableUnitNames.set(compositeVariableKey, unitName || '');
        }
      }

      this.logger.log(`Processed ${codingJobUnits.length} coding job units. Creating Excel file with ${testPersonList.length} test persons and ${variableSet.size} variables.`);

      const testPersonModalValues = new Map<string, Map<string, { modalValue: number | null; deviationCount: number }>>();

      for (const testPersonKey of testPersonList) {
        testPersonModalValues.set(testPersonKey, new Map());
        const variableCodes = testPersonVariableCodes.get(testPersonKey)!;

        for (const [variableKey, codes] of variableCodes.entries()) {
          if (codes.length > 0) {
            const modalResult = this.calculateModalValue(codes);
            testPersonModalValues.get(testPersonKey)!.set(variableKey, modalResult);
          } else {
            testPersonModalValues.get(testPersonKey)!.set(variableKey, { modalValue: null, deviationCount: 0 });
          }
        }
      }

      const variables = Array.from(variableSet).sort();
      const baseHeaders = ['Test Person Login', 'Test Person Code', 'Test Person Group'];
      if (includeReplayUrl) {
        baseHeaders.push('Replay URL');
      }

      const headers = [...baseHeaders, ...variables];

      worksheet.columns = headers.map(header => ({ header, key: header, width: header === 'Replay URL' ? 60 : 15 }));

      for (const testPersonKey of testPersonList) {
        const [login, code] = testPersonKey.split('_');
        const group = personGroups.get(testPersonKey) || '';
        const bookletName = personBooklets.get(testPersonKey) || '';
        const modalValues = testPersonModalValues.get(testPersonKey)!;
        const comments = testPersonVariableComments.get(testPersonKey)!;

        const row: Record<string, string | number | null> = {
          'Test Person Login': login,
          'Test Person Code': code,
          'Test Person Group': group
        };

        if (includeReplayUrl && req) {
          let replayUrl = '';
          for (const variable of variables) {
            if (modalValues.has(variable)) {
              const variableId = variable.split('_').slice(1).join('_');
              const unitName = variableUnitNames.get(variable) || '';
              replayUrl = this.generateReplayUrl(req, login, code, group, bookletName, unitName, variableId, authToken);
              break;
            }
          }
          row['Replay URL'] = replayUrl;
        }

        // Add modal values or comments for each variable
        for (const variable of variables) {
          const modalData = modalValues.get(variable);
          const variableComments = comments.get(variable);

          if (outputCommentsInsteadOfCodes) {
            row[variable] = variableComments ? variableComments.join(' | ') : '';
          } else {
            row[variable] = modalData?.modalValue ?? '';
          }
        }

        worksheet.addRow(row);
      }

      // Style the header row
      worksheet.getRow(1).font = { bold: true };
      worksheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' }
      };

      const buffer = await workbook.xlsx.writeBuffer();
      return Buffer.from(buffer);
    } catch (error) {
      this.logger.error(`Error exporting aggregated coding results (most-frequent): ${error.message}`, error.stack);
      throw new Error(`Could not export aggregated coding results: ${error.message}`);
    }
  }

  private async exportAggregatedNewRowPerVariable(
    workspaceId: number,
    outputCommentsInsteadOfCodes: boolean,
    includeReplayUrl: boolean,
    anonymizeCoders: boolean,
    usePseudoCoders: boolean,
    includeComments: boolean,
    includeModalValue: boolean,
    authToken: string,
    req?: Request,
    excludeAutoCoded = false,
    checkCancellation?: () => Promise<void>
  ): Promise<Buffer> {
    this.logger.log(`Exporting aggregated results with new-row-per-variable method for workspace ${workspaceId}`);

    const MODAL_VALUE_HEADER = 'Häufigster Wert';
    const DEVIATION_COUNT_HEADER = 'Anzahl der Abweichungen';
    const COMMENTS_HEADER = 'Kommentare';

    if (checkCancellation) await checkCancellation();

    let manualCodingVariableSet: Set<string> | null = null;
    if (excludeAutoCoded) {
      const codingListVariables = await this.codingListService.getCodingListVariables(workspaceId);
      if (codingListVariables.length === 0) {
        throw new Error('No manual coding variables found in the coding list for this workspace');
      }
      this.logger.log(`Found ${codingListVariables.length} unique unit-variable combinations for workspace ${workspaceId}`);
      manualCodingVariableSet = new Set<string>();
      codingListVariables.forEach(item => {
        manualCodingVariableSet.add(`${item.unitName}|${item.variableId}`);
      });
    }

    const codingJobUnits = await this.codingJobUnitRepository.find({
      where: {
        coding_job: {
          workspace_id: workspaceId
        }
      },
      relations: [
        'coding_job',
        'coding_job.codingJobCoders',
        'coding_job.codingJobCoders.user',
        'response',
        'response.unit',
        'response.unit.booklet',
        'response.unit.booklet.person'
      ]
    });

    if (codingJobUnits.length === 0) {
      throw new Error('No coding jobs found for this workspace');
    }

    try {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Coding Results');

      const dataMap = new Map<string, Map<string, { code: number | null; score: number | null; comment: string | null }>>();
      const testPersons = new Set<string>();
      const variables = new Set<string>();
      const personGroups = new Map<string, string>();
      const personBooklets = new Map<string, string>();
      const variableUnitNames = new Map<string, string>();
      const allCoders = new Set<string>();

      let coderMapping: Map<string, string> | null = null;
      if (anonymizeCoders) {
        coderMapping = this.buildCoderMapping(codingJobUnits, usePseudoCoders);
      }

      for (const unit of codingJobUnits) {
        const person = unit.response?.unit?.booklet?.person;
        if (!person) continue;

        const testPersonKey = `${person.login}_${person.code}`;
        const variableId = unit.variable_id;
        const unitName = unit.unit_name;

        if (!unitName || !variableId) continue;

        if (manualCodingVariableSet) {
          const variableKey = `${unitName}|${variableId}`;
          if (!manualCodingVariableSet.has(variableKey)) {
            continue;
          }
        }

        const compositeVariableKey = `${unitName}_${variableId}`;
        const rowKey = `${testPersonKey}_${compositeVariableKey}`;

        // Get coder name from the job's assigned coders (take first coder for the job)
        const coder = unit.coding_job?.codingJobCoders?.[0];
        let coderName = coder?.user?.username || `Job ${unit.coding_job_id}`;

        if (anonymizeCoders && coderMapping) {
          coderName = coderMapping.get(coderName) || coderName;
        }

        allCoders.add(coderName);
        testPersons.add(testPersonKey);
        variables.add(compositeVariableKey);

        // Cache metadata
        if (!personGroups.has(testPersonKey)) {
          personGroups.set(testPersonKey, person.group || '');
        }
        if (!personBooklets.has(testPersonKey)) {
          const bookletName = unit.response?.unit?.booklet?.bookletinfo?.name || '';
          personBooklets.set(testPersonKey, bookletName);
        }
        if (!variableUnitNames.has(compositeVariableKey)) {
          variableUnitNames.set(compositeVariableKey, unitName || '');
        }

        // Store coding data
        if (!dataMap.has(rowKey)) {
          dataMap.set(rowKey, new Map());
        }

        const code = unit.response?.code_v3 ?? unit.response?.code_v2 ?? unit.response?.code_v1 ?? null;
        const score = unit.response?.score_v3 ?? unit.response?.score_v2 ?? unit.response?.score_v1 ?? null;
        const comment = unit.notes || null;

        dataMap.get(rowKey)!.set(coderName, { code, score, comment });
      }

      // Build headers: Base columns + Coders + Optional columns
      const coderList = Array.from(allCoders).sort();
      const baseHeaders = ['Test Person Login', 'Test Person Code', 'Test Person Group', 'Variable'];

      const headers = [...baseHeaders, ...coderList];

      if (includeModalValue) {
        headers.push(MODAL_VALUE_HEADER, DEVIATION_COUNT_HEADER);
      }
      if (includeComments) {
        headers.push(COMMENTS_HEADER);
      }
      if (includeReplayUrl) {
        headers.push('Replay URL');
      }

      worksheet.columns = headers.map(header => ({ header, key: header, width: header === 'Replay URL' ? 60 : 15 }));

      // Create rows: one row per person-variable combination
      const sortedTestPersons = Array.from(testPersons).sort();
      const sortedVariables = Array.from(variables).sort();

      for (const testPersonKey of sortedTestPersons) {
        const [login, code] = testPersonKey.split('_');
        const group = personGroups.get(testPersonKey) || '';
        const bookletName = personBooklets.get(testPersonKey) || '';

        for (const compositeVariableKey of sortedVariables) {
          const rowKey = `${testPersonKey}_${compositeVariableKey}`;
          const coderData = dataMap.get(rowKey);

          if (!coderData || coderData.size === 0) continue;

          const variableId = compositeVariableKey.split('_').slice(1).join('_');
          const unitName = variableUnitNames.get(compositeVariableKey) || '';

          const row: Record<string, string | number | null> = {
            'Test Person Login': login,
            'Test Person Code': code,
            'Test Person Group': group,
            Variable: variableId
          };

          // Add replay URL
          if (includeReplayUrl && req) {
            row['Replay URL'] = this.generateReplayUrl(req, login, code, group, bookletName, unitName, variableId, authToken);
          }

          // Add coder codes/comments
          const codes: number[] = [];
          const comments: string[] = [];

          for (const coderName of coderList) {
            const coding = coderData.get(coderName);
            if (outputCommentsInsteadOfCodes) {
              row[coderName] = coding?.comment || '';
            } else {
              row[coderName] = coding?.code ?? '';
            }

            if (coding?.code !== null && coding?.code !== undefined) {
              codes.push(coding.code);
            }
            if (coding?.comment) {
              comments.push(`${coderName}: ${coding.comment}`);
            }
          }

          // Add modal value
          if (includeModalValue && codes.length > 0) {
            const modalResult = this.calculateModalValue(codes);
            row[MODAL_VALUE_HEADER] = modalResult.modalValue;
            row[DEVIATION_COUNT_HEADER] = modalResult.deviationCount;
          } else if (includeModalValue) {
            row[MODAL_VALUE_HEADER] = '';
            row[DEVIATION_COUNT_HEADER] = '';
          }

          // Add comments
          if (includeComments) {
            row[COMMENTS_HEADER] = comments.join(' | ');
          }

          worksheet.addRow(row);
        }
      }

      // Style the header row
      worksheet.getRow(1).font = { bold: true };
      worksheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' }
      };

      const buffer = await workbook.xlsx.writeBuffer();
      return Buffer.from(buffer);
    } catch (error) {
      this.logger.error(`Error exporting aggregated (new-row-per-variable): ${error.message}`, error.stack);
      throw new Error(`Could not export aggregated results: ${error.message}`);
    }
  }

  private async exportAggregatedNewColumnPerCoder(
    workspaceId: number,
    outputCommentsInsteadOfCodes: boolean,
    anonymizeCoders: boolean,
    usePseudoCoders: boolean,
    includeComments: boolean,
    includeModalValue: boolean,
    excludeAutoCoded = false,
    checkCancellation?: () => Promise<void>
  ): Promise<Buffer> {
    this.logger.log(`Exporting aggregated results with new-column-per-coder method for workspace ${workspaceId}`);

    const MODAL_VALUE_HEADER = 'Häufigster Wert';
    const DEVIATION_COUNT_HEADER = 'Anzahl der Abweichungen';
    const COMMENTS_HEADER = 'Kommentare';

    if (checkCancellation) await checkCancellation();

    // Get manual coding variables filter if enabled
    let manualCodingVariableSet: Set<string> | null = null;
    if (excludeAutoCoded) {
      const codingListVariables = await this.codingListService.getCodingListVariables(workspaceId);
      if (codingListVariables.length === 0) {
        throw new Error('No manual coding variables found in the coding list for this workspace');
      }
      this.logger.log(`Found ${codingListVariables.length} unique unit-variable combinations for workspace ${workspaceId}`);
      // Create set of unit-variable combinations
      manualCodingVariableSet = new Set<string>();
      codingListVariables.forEach(item => {
        manualCodingVariableSet.add(`${item.unitName}|${item.variableId}`);
      });
    }

    // Get all coding job units with their coders and responses
    const codingJobUnits = await this.codingJobUnitRepository.find({
      where: {
        coding_job: {
          workspace_id: workspaceId
        }
      },
      relations: [
        'coding_job',
        'coding_job.codingJobCoders',
        'coding_job.codingJobCoders.user',
        'response',
        'response.unit',
        'response.unit.booklet',
        'response.unit.booklet.person'
      ]
    });

    if (codingJobUnits.length === 0) {
      throw new Error('No coding jobs found for this workspace');
    }

    try {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Coding Results');

      // Structure: testPersonKey -> variableKey_coderName -> { code, score, comment }
      const dataMap = new Map<string, Map<string, { code: number | null; score: number | null; comment: string | null }>>();
      const testPersons = new Set<string>();
      const variableCoderColumns = new Set<string>();
      const personGroups = new Map<string, string>();
      const personBooklets = new Map<string, string>();
      const variableMetadata = new Map<string, { unitName: string; variableId: string }>();
      const allCoders = new Set<string>();

      // Build coder mapping for anonymization
      let coderMapping: Map<string, string> | null = null;
      if (anonymizeCoders) {
        coderMapping = this.buildCoderMapping(codingJobUnits, usePseudoCoders);
      }

      // Process all coding job units
      for (const unit of codingJobUnits) {
        const person = unit.response?.unit?.booklet?.person;
        if (!person) continue;

        const testPersonKey = `${person.login}_${person.code}`;
        const variableId = unit.variable_id;
        const unitName = unit.unit_name;

        if (!unitName || !variableId) continue;

        if (manualCodingVariableSet) {
          const variableKey = `${unitName}|${variableId}`;
          if (!manualCodingVariableSet.has(variableKey)) {
            continue;
          }
        }

        const compositeVariableKey = `${unitName}_${variableId}`;

        // Get coder name from the job's assigned coders (take first coder for the job)
        const coder = unit.coding_job?.codingJobCoders?.[0];
        let coderName = coder?.user?.username || `Job ${unit.coding_job_id}`;

        if (anonymizeCoders && coderMapping) {
          coderName = coderMapping.get(coderName) || coderName;
        }

        allCoders.add(coderName);
        testPersons.add(testPersonKey);

        const columnKey = `${compositeVariableKey}_${coderName}`;
        variableCoderColumns.add(columnKey);

        // Cache metadata
        if (!personGroups.has(testPersonKey)) {
          personGroups.set(testPersonKey, person.group || '');
        }
        if (!personBooklets.has(testPersonKey)) {
          const bookletName = unit.response?.unit?.booklet?.bookletinfo?.name || '';
          personBooklets.set(testPersonKey, bookletName);
        }
        if (!variableMetadata.has(compositeVariableKey)) {
          variableMetadata.set(compositeVariableKey, { unitName: unitName || '', variableId });
        }

        // Store coding data
        if (!dataMap.has(testPersonKey)) {
          dataMap.set(testPersonKey, new Map());
        }

        const code = unit.response?.code_v3 ?? unit.response?.code_v2 ?? unit.response?.code_v1 ?? null;
        const score = unit.response?.score_v3 ?? unit.response?.score_v2 ?? unit.response?.score_v1 ?? null;
        const comment = unit.notes || null;

        dataMap.get(testPersonKey)!.set(columnKey, { code, score, comment });
      }

      // Build headers: Base columns + Variable_Coder columns + Optional columns
      const sortedColumns = Array.from(variableCoderColumns).sort();
      const baseHeaders = ['Test Person Login', 'Test Person Code', 'Test Person Group'];

      // Create column labels like "Variablenname_Kodierer"
      const columnLabels = sortedColumns.map(col => {
        const parts = col.split('_');
        const coderName = parts[parts.length - 1];
        const variableKey = parts.slice(0, -1).join('_');
        return `${variableKey}_${coderName}`;
      });

      const headers = [...baseHeaders, ...columnLabels];

      if (includeModalValue) {
        headers.push(MODAL_VALUE_HEADER, DEVIATION_COUNT_HEADER);
      }
      if (includeComments) {
        headers.push(COMMENTS_HEADER);
      } worksheet.columns = headers.map(header => ({ header, key: header, width: header === 'Replay URL' ? 60 : 15 }));

      // Create rows: one row per person
      const sortedTestPersons = Array.from(testPersons).sort();

      for (const testPersonKey of sortedTestPersons) {
        const [login, code] = testPersonKey.split('_');
        const group = personGroups.get(testPersonKey) || '';
        const personData = dataMap.get(testPersonKey);

        if (!personData || personData.size === 0) continue;

        const row: Record<string, string | number | null> = {
          'Test Person Login': login,
          'Test Person Code': code,
          'Test Person Group': group
        };

        // Add variable-coder data
        const allCodes: number[] = [];
        const allComments: string[] = [];

        for (let i = 0; i < sortedColumns.length; i++) {
          const columnKey = sortedColumns[i];
          const columnLabel = columnLabels[i];
          const coding = personData.get(columnKey);

          if (outputCommentsInsteadOfCodes) {
            row[columnLabel] = coding?.comment || '';
          } else {
            row[columnLabel] = coding?.code ?? '';
          }

          if (coding?.code !== null && coding?.code !== undefined) {
            allCodes.push(coding.code);
          }
          if (coding?.comment) {
            const coderName = columnKey.split('_').slice(-1)[0];
            allComments.push(`${coderName}: ${coding.comment}`);
          }
        }

        // Add modal value
        if (includeModalValue && allCodes.length > 0) {
          const modalResult = this.calculateModalValue(allCodes);
          row[MODAL_VALUE_HEADER] = modalResult.modalValue;
          row[DEVIATION_COUNT_HEADER] = modalResult.deviationCount;
        } else if (includeModalValue) {
          row[MODAL_VALUE_HEADER] = '';
          row[DEVIATION_COUNT_HEADER] = '';
        }

        // Add comments
        if (includeComments) {
          row[COMMENTS_HEADER] = allComments.join(' | ');
        }

        worksheet.addRow(row);
      }

      // Style the header row
      worksheet.getRow(1).font = { bold: true };
      worksheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' }
      };

      const buffer = await workbook.xlsx.writeBuffer();
      return Buffer.from(buffer);
    } catch (error) {
      this.logger.error(`Error exporting aggregated (new-column-per-coder): ${error.message}`, error.stack);
      throw new Error(`Could not export aggregated results: ${error.message}`);
    }
  }

  private buildCoderMapping(codingJobUnits: CodingJobUnit[], usePseudo = false): Map<string, string> {
    const coderMapping = new Map<string, string>();
    const allCoders = new Set<string>();

    for (const unit of codingJobUnits) {
      const coder = unit.coding_job?.codingJobCoders?.[0];
      const coderName = coder?.user?.username || `Job ${unit.coding_job_id}`;
      allCoders.add(coderName);
    }

    let codersList: string[];
    if (usePseudo) {
      codersList = Array.from(allCoders).sort();
    } else {
      codersList = Array.from(allCoders).sort(() => Math.random() - 0.5);
    }

    codersList.forEach((coderName, index) => {
      coderMapping.set(coderName, `K${index + 1}`);
    });

    return coderMapping;
  }

  private calculateModalValue(codes: number[]): { modalValue: number; deviationCount: number } {
    if (codes.length === 0) {
      return { modalValue: 0, deviationCount: 0 };
    }

    const frequency = new Map<number, number>();
    codes.forEach(code => {
      frequency.set(code, (frequency.get(code) || 0) + 1);
    });

    let maxFrequency = 0;
    const modalCodes: number[] = [];

    frequency.forEach((count, code) => {
      if (count > maxFrequency) {
        maxFrequency = count;
        modalCodes.length = 0;
        modalCodes.push(code);
      } else if (count === maxFrequency) {
        modalCodes.push(code);
      }
    });

    const modalValue = modalCodes[Math.floor(Math.random() * modalCodes.length)];
    const deviationCount = codes.length - maxFrequency;

    return { modalValue, deviationCount };
  }

  async exportCodingResultsByCoder(workspaceId: number, outputCommentsInsteadOfCodes = false, includeReplayUrl = false, anonymizeCoders = false, usePseudoCoders = false, authToken = '', req?: Request, excludeAutoCoded = false, checkCancellation?: () => Promise<void>): Promise<Buffer> {
    this.logger.log(`Exporting coding results by coder for workspace ${workspaceId}${outputCommentsInsteadOfCodes ? ' with comments instead of codes' : ''}${includeReplayUrl ? ' with replay URLs' : ''}${anonymizeCoders ? ' with anonymized coders' : ''}${usePseudoCoders ? ' using pseudo coders' : ''}${excludeAutoCoded ? ' (manual coding only)' : ''}`);

    // Check for cancellation before starting
    if (checkCancellation) await checkCancellation();

    let manualCodingVariableSet: Set<string> | null = null;
    if (excludeAutoCoded) {
      const codingListVariables = await this.codingListService.getCodingListVariables(workspaceId);
      if (codingListVariables.length === 0) {
        throw new Error('No manual coding variables found in the coding list for this workspace');
      }
      manualCodingVariableSet = new Set<string>();
      codingListVariables.forEach(item => {
        manualCodingVariableSet.add(`${item.unitName}|${item.variableId}`);
      });
    }

    const codingJobs = await this.codingJobRepository.find({
      where: { workspace_id: workspaceId },
      relations: ['codingJobCoders', 'codingJobCoders.user', 'codingJobUnits', 'codingJobUnits.response', 'codingJobUnits.response.unit']
    });

    if (codingJobs.length === 0) {
      throw new Error('No coding jobs found for this workspace');
    }

    // Check for cancellation after data fetch
    if (checkCancellation) await checkCancellation();

    try {
      const jobIds = codingJobs.map(job => job.id);
      const codingJobVariables = await this.codingJobVariableRepository.find({
        where: { coding_job_id: In(jobIds) }
      });

      const variablesByJobId = new Map<number, CodingJobVariable[]>();
      codingJobVariables.forEach(variable => {
        if (!variablesByJobId.has(variable.coding_job_id)) {
          variablesByJobId.set(variable.coding_job_id, []);
        }
        variablesByJobId.get(variable.coding_job_id)!.push(variable);
      });

      const workbook = new ExcelJS.Workbook();
      const coderJobs = new Map<string, CodingJob[]>();

      const allCoderNames = new Set<string>();
      for (const job of codingJobs) {
        for (const jobCoder of job.codingJobCoders) {
          allCoderNames.add(jobCoder.user.username);
          const coderKey = `${jobCoder.user.username}_${jobCoder.user.id}`;
          if (!coderJobs.has(coderKey)) {
            coderJobs.set(coderKey, []);
          }
          coderJobs.get(coderKey)!.push(job);
        }
      }

      const coderNameMapping = anonymizeCoders ?
        this.buildCoderNameMapping(Array.from(allCoderNames), usePseudoCoders) :
        null;

      for (const [coderKey, jobs] of coderJobs) {
        const [coderName] = coderKey.split('_');
        const displayName = anonymizeCoders && coderNameMapping ? coderNameMapping.get(coderName) || coderName : coderName;
        const worksheetName = this.generateUniqueWorksheetName(workbook, displayName);
        const worksheet = workbook.addWorksheet(worksheetName);

        // Collect all variables and testpersons for this coder
        const variableSet = new Set<string>();
        const testPersonMap = new Map<string, Map<string, { code: number | null; score: number | null }>>();
        const testPersonComments = new Map<string, Map<string, string | null>>();
        const testPersonList: string[] = [];
        const personGroups = new Map<string, string>();
        const personBooklets = new Map<string, string>();
        const variableUnitNames = new Map<string, string>();

        for (const job of jobs) {
          // Get responses for this job's variables and units
          const unitIds = job.codingJobUnits.map(ju => ju.response?.unit?.id).filter((id): id is number => id !== undefined);
          const jobVariables = variablesByJobId.get(job.id) || [];
          const variableIds = jobVariables.map(jv => jv.variable_id);

          if (unitIds.length === 0 || variableIds.length === 0) continue;

          const responses = await this.responseRepository.find({
            where: {
              unitid: In(unitIds),
              variableid: In(variableIds)
            },
            relations: ['unit', 'unit.booklet', 'unit.booklet.person'],
            select: {
              id: true,
              variableid: true,
              code_v1: true,
              score_v1: true,
              code_v2: true,
              score_v2: true,
              code_v3: true,
              score_v3: true,
              unit: {
                id: true,
                name: true,
                booklet: {
                  id: true,
                  person: {
                    id: true,
                    login: true,
                    code: true,
                    group: true
                  }
                }
              }
            }
          });

          for (const response of responses) {
            const person = response.unit?.booklet?.person;
            const testPersonKey = `${person?.login}_${person?.code}`;
            const variableId = response.variableid;
            const unitName = response.unit?.name;
            const compositeKey = unitName ? `${unitName}_${variableId}` : variableId;
            const latestCoding = this.getLatestCode(response);

            // Store person group and booklet
            if (!personGroups.has(testPersonKey)) {
              personGroups.set(testPersonKey, person?.group || '');
            }
            if (!personBooklets.has(testPersonKey)) {
              personBooklets.set(testPersonKey, response.unit?.booklet?.bookletinfo?.name || '');
            }

            // Store unit name for this variable
            if (!variableUnitNames.has(compositeKey)) {
              variableUnitNames.set(compositeKey, unitName || '');
            }

            if (!testPersonMap.has(testPersonKey)) {
              testPersonMap.set(testPersonKey, new Map());
              testPersonList.push(testPersonKey);
            }

            testPersonMap.get(testPersonKey)!.set(compositeKey, {
              code: latestCoding.code,
              score: latestCoding.score
            });
            // Apply manual coding filter if needed
            if (manualCodingVariableSet) {
              const variableKey = `${unitName}|${response.variableid}`;
              if (!manualCodingVariableSet.has(variableKey)) {
                continue;
              }
            }

            variableSet.add(compositeKey);
          }

          // Fetch comments if needed
          if (outputCommentsInsteadOfCodes) {
            for (const unit of job.codingJobUnits) {
              if (!unit.notes) continue;

              const person = unit.response?.unit?.booklet?.person;
              const testPersonKey = `${person?.login}_${person?.code}`;
              const unitName = unit.response?.unit?.name;
              const compositeKey = unitName ? `${unitName}_${unit.variable_id}` : unit.variable_id;

              if (!testPersonComments.has(testPersonKey)) {
                testPersonComments.set(testPersonKey, new Map());
              }
              testPersonComments.get(testPersonKey)!.set(compositeKey, unit.notes);
            }
          }
        }

        const variables = Array.from(variableSet).sort();

        if (variables.length === 0) continue;

        const baseHeaders = ['Test Person Login', 'Test Person Code', 'Test Person Group'];
        if (includeReplayUrl) {
          baseHeaders.push('Replay URL');
        }
        const headers = [...baseHeaders, ...variables];
        worksheet.columns = headers.map(header => ({ header, key: header, width: header === 'Replay URL' ? 60 : 15 }));

        for (const testPersonKey of testPersonList) {
          const [login, code] = testPersonKey.split('_');
          const personData = testPersonMap.get(testPersonKey)!;
          const group = personGroups.get(testPersonKey) || '';
          const bookletName = personBooklets.get(testPersonKey) || '';

          const row: Record<string, string | number | null> = {
            'Test Person Login': login,
            'Test Person Code': code,
            'Test Person Group': group
          };

          // Add replay URL if requested - use first variable with data
          if (includeReplayUrl && req) {
            let replayUrl = '';
            for (const variable of variables) {
              if (personData.has(variable)) {
                const parts = variable.split('_');
                const varId = parts[parts.length - 1];
                const unitName = variableUnitNames.get(variable) || '';
                replayUrl = this.generateReplayUrl(req, login, code, group, bookletName, unitName, varId, authToken);
                break;
              }
            }
            row['Replay URL'] = replayUrl;
          }

          for (const variable of variables) {
            const coding = personData.get(variable);
            if (outputCommentsInsteadOfCodes) {
              const comments = testPersonComments.get(testPersonKey);
              const comment = comments?.get(variable);
              row[variable] = comment || '';
            } else {
              row[variable] = coding?.code ?? '';
            }
          }

          worksheet.addRow(row);
        }

        // Style the header row
        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFE0E0E0' }
        };
      }

      const buffer = await workbook.xlsx.writeBuffer();
      return Buffer.from(buffer);
    } catch (error) {
      this.logger.error(`Error exporting coding results by coder: ${error.message}`, error.stack);
      throw new Error('Could not export coding results by coder. Please check the database connection or query.');
    }
  }

  async exportCodingResultsByVariable(workspaceId: number, includeModalValue = false, includeDoubleCoded = false, includeComments = false, outputCommentsInsteadOfCodes = false, includeReplayUrl = false, anonymizeCoders = false, usePseudoCoders = false, authToken = '', req?: Request, excludeAutoCoded = false, checkCancellation?: () => Promise<void>): Promise<Buffer> {
    this.logger.log(`Exporting coding results by variable for workspace ${workspaceId}${excludeAutoCoded ? ' (CODING_INCOMPLETE only)' : ''}${includeModalValue ? ' with modal value' : ''}${includeDoubleCoded ? ' with double coding indicator' : ''}${includeComments ? ' with comments' : ''}${outputCommentsInsteadOfCodes ? ' with comments instead of codes' : ''}${includeReplayUrl ? ' with replay URLs' : ''}${anonymizeCoders ? ' with anonymized coders' : ''}${usePseudoCoders ? ' using pseudo coders' : ''}`);

    const MAX_WORKSHEETS = parseInt(process.env.EXPORT_MAX_WORKSHEETS || '100', 10);
    const MAX_RESPONSES_PER_WORKSHEET = parseInt(process.env.EXPORT_MAX_RESPONSES_PER_WORKSHEET || '10000', 10);
    const BATCH_SIZE = parseInt(process.env.EXPORT_BATCH_SIZE || '50', 10);

    // Column header constants
    const MODAL_VALUE_HEADER = 'Häufigster Wert';
    const DEVIATION_COUNT_HEADER = 'Anzahl der Abweichungen';
    const DOUBLE_CODED_HEADER = 'Doppelkodierung';
    const COMMENTS_HEADER = 'Kommentare';

    // Check for cancellation before starting
    if (checkCancellation) await checkCancellation();

    let incompleteVariables: Array<{ unitName: string; variableId: string }> = [];
    if (excludeAutoCoded) {
      incompleteVariables = await this.codingListService.getCodingListVariables(workspaceId);

      if (incompleteVariables.length === 0) {
        throw new Error('No CODING_INCOMPLETE variables found for this workspace');
      }
      this.logger.log(`Found ${incompleteVariables.length} CODING_INCOMPLETE variables for workspace ${workspaceId}`);
    }

    // Create a filter set for quick lookup: "unitName|variableId"
    const incompleteVariableSet = new Set<string>();
    if (excludeAutoCoded) {
      incompleteVariables.forEach(variable => {
        incompleteVariableSet.add(`${variable.unitName}|${variable.variableId}`);
      });
    }

    // Get distinct unit-variable combinations for CODING_INCOMPLETE responses only
    const unitVariableResults = await this.responseRepository
      .createQueryBuilder('response')
      .select('unit.name', 'unitName')
      .addSelect('response.variableid', 'variableId')
      .leftJoin('response.unit', 'unit')
      .leftJoin('unit.booklet', 'booklet')
      .leftJoin('booklet.person', 'person')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('response.status_v1 = :status', { status: statusStringToNumber('CODING_INCOMPLETE') })
      .groupBy('unit.name')
      .addGroupBy('response.variableid')
      .orderBy('unit.name', 'ASC')
      .addOrderBy('response.variableid', 'ASC')
      .getRawMany();

    // Filter to only include variables that are in the incomplete set
    const filteredUnitVariableResults = unitVariableResults.filter(result => incompleteVariableSet.has(`${result.unitName}|${result.variableId}`)
    );

    this.logger.log(`Filtered to ${filteredUnitVariableResults.length} unit-variable combinations from ${unitVariableResults.length} total CODING_INCOMPLETE responses`);

    if (filteredUnitVariableResults.length === 0) {
      throw new Error('No CODING_INCOMPLETE variables with responses found for this workspace');
    }

    // Check if we exceed the worksheet limit
    if (filteredUnitVariableResults.length > MAX_WORKSHEETS) {
      this.logger.warn(`Too many unit-variable combinations (${filteredUnitVariableResults.length}) for workspace ${workspaceId}. Limiting to ${MAX_WORKSHEETS} worksheets.`);
      filteredUnitVariableResults.splice(MAX_WORKSHEETS); // Truncate to limit
    }

    this.logger.log(`Processing ${filteredUnitVariableResults.length} unit-variable combinations in batches of ${BATCH_SIZE}`);

    let processedCombinations = 0;
    let resultBuffer: Buffer;

    try {
      const workbook = new ExcelJS.Workbook();

      // Process in batches to avoid memory spikes
      for (let i = 0; i < filteredUnitVariableResults.length; i += BATCH_SIZE) {
        const batch = filteredUnitVariableResults.slice(i, i + BATCH_SIZE);
        this.logger.log(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(filteredUnitVariableResults.length / BATCH_SIZE)} (${batch.length} combinations)`);

        // Process each combination in the current batch
        for (const { unitName, variableId } of batch) {
          try {
            // Get coding job units for this specific unit-variable combination
            const codingJobUnits = await this.codingJobUnitRepository.find({
              where: {
                unit_name: unitName,
                variable_id: variableId,
                coding_job: {
                  workspace_id: workspaceId
                }
              },
              relations: [
                'coding_job',
                'coding_job.codingJobCoders',
                'coding_job.codingJobCoders.user',
                'response',
                'response.unit',
                'response.unit.booklet',
                'response.unit.booklet.person'
              ],
              take: MAX_RESPONSES_PER_WORKSHEET * 10
            });

            if (codingJobUnits.length === 0) continue;

            const worksheetName = this.generateUniqueWorksheetName(workbook, `${unitName}_${variableId}`);
            const worksheet = workbook.addWorksheet(worksheetName);

            const testPersonMap = new Map<string, Map<string, number | null>>();
            const testPersonComments = new Map<string, Map<string, string | null>>();
            const coderSet = new Set<string>();
            const testPersonData = new Map<string, { login: string; code: string; group: string; booklet: string }>();

            for (const unit of codingJobUnits) {
              if (unit.code === null || unit.code === undefined) {
                continue;
              }

              const person = unit.response?.unit?.booklet?.person;
              const testPersonKey = `${person?.login || ''}_${person?.code || ''}`;

              const coderName = unit.coding_job?.codingJobCoders?.[0]?.user?.username || 'Unknown';
              coderSet.add(coderName);

              if (!testPersonData.has(testPersonKey)) {
                testPersonData.set(testPersonKey, {
                  login: person?.login || '',
                  code: person?.code || '',
                  group: person?.group || '',
                  booklet: unit.response?.unit?.booklet?.bookletinfo?.name || ''
                });
              }

              if (!testPersonMap.has(testPersonKey)) {
                testPersonMap.set(testPersonKey, new Map());
              }
              testPersonMap.get(testPersonKey)!.set(coderName, unit.code);

              if (includeComments) {
                if (!testPersonComments.has(testPersonKey)) {
                  testPersonComments.set(testPersonKey, new Map());
                }
                if (unit.notes) {
                  testPersonComments.get(testPersonKey)!.set(coderName, unit.notes);
                }
              }
            }

            if (testPersonMap.size === 0) continue;

            const coderList = Array.from(coderSet).sort();
            let coderNameMapping: Map<string, string> | null;
            if (anonymizeCoders && usePseudoCoders) {
              coderNameMapping = this.buildCoderNameMapping(coderList, true); // Pseudo mode: deterministic K1/K2 per variable
            } else if (anonymizeCoders) {
              coderNameMapping = this.buildCoderNameMapping(coderList, false); // Regular: random mapping
            } else {
              coderNameMapping = null;
            }

            const displayCoderList = coderNameMapping ?
              coderList.map(coder => coderNameMapping.get(coder) || coder) :
              coderList;

            const baseHeaders = ['Test Person Login', 'Test Person Code', 'Test Person Group'];

            if (includeReplayUrl) {
              baseHeaders.push('Replay URL');
            }

            baseHeaders.push(...displayCoderList);

            if (includeModalValue) {
              baseHeaders.push(MODAL_VALUE_HEADER, DEVIATION_COUNT_HEADER);
            }

            if (includeDoubleCoded) {
              baseHeaders.push(DOUBLE_CODED_HEADER);
            }

            if (includeComments) {
              baseHeaders.push(COMMENTS_HEADER);
            }

            worksheet.columns = baseHeaders.map(header => ({ header, key: header, width: header === 'Replay URL' ? 60 : 15 }));

            for (const [testPersonKey, codings] of testPersonMap) {
              const personData = testPersonData.get(testPersonKey)!;

              const row: Record<string, string | number | null> = {
                'Test Person Login': personData.login,
                'Test Person Code': personData.code,
                'Test Person Group': personData.group
              };

              if (includeReplayUrl && req) {
                row['Replay URL'] = this.generateReplayUrl(
                  req,
                  personData.login,
                  personData.code,
                  personData.group,
                  personData.booklet,
                  unitName,
                  variableId,
                  authToken
                );
              }

              // Add coding values for each coder
              const codeValues: (number | null)[] = [];
              for (let coderIndex = 0; coderIndex < coderList.length; coderIndex++) {
                const coder = coderList[coderIndex];
                const displayCoder = displayCoderList[coderIndex];
                const code = codings.get(coder) ?? null;

                if (outputCommentsInsteadOfCodes) {
                  // Output comments instead of codes
                  const comments = testPersonComments.get(testPersonKey);
                  const comment = comments?.get(coder);
                  row[displayCoder] = comment || '';
                } else {
                  // Display empty cell for negative codes (coding issues)
                  row[displayCoder] = (code !== null && code >= 0) ? code : '';
                }

                // Only include non-negative codes in modal value calculation
                if (code !== null && code >= 0) {
                  codeValues.push(code);
                }
              }

              // Calculate modal value and deviations if requested
              if (includeModalValue && codeValues.length > 0) {
                // Count frequency of each code
                const frequencyMap = new Map<number, number>();
                for (const code of codeValues) {
                  frequencyMap.set(code, (frequencyMap.get(code) || 0) + 1);
                }

                // Find the maximum frequency
                let maxFrequency = 0;
                for (const freq of frequencyMap.values()) {
                  if (freq > maxFrequency) {
                    maxFrequency = freq;
                  }
                }

                // Collect all codes with the maximum frequency
                const modalCandidates: number[] = [];
                for (const [code, freq] of frequencyMap.entries()) {
                  if (freq === maxFrequency) {
                    modalCandidates.push(code);
                  }
                }

                // Select randomly if there are multiple modal values (tie)
                const modalValue = modalCandidates.length > 0 ?
                  modalCandidates[Math.floor(Math.random() * modalCandidates.length)] :
                  null;

                // Count deviations from modal value (number of coders who used a different code)
                const deviations = modalValue !== null ?
                  codeValues.filter(code => code !== modalValue).length :
                  0;

                row[MODAL_VALUE_HEADER] = modalValue ?? '';
                row[DEVIATION_COUNT_HEADER] = deviations;
              } else if (includeModalValue) {
                row[MODAL_VALUE_HEADER] = '';
                row[DEVIATION_COUNT_HEADER] = '';
              }

              if (includeDoubleCoded) {
                const codedByCount = coderList.filter(coder => {
                  const code = codings.get(coder) ?? null;
                  return code !== null && code >= 0;
                }).length;
                row[DOUBLE_CODED_HEADER] = codedByCount > 1 ? 1 : 0;
              }

              if (includeComments) {
                const comments = testPersonComments.get(testPersonKey);
                if (comments && comments.size > 0) {
                  const commentsList = coderList.map(coder => {
                    const comment = comments.get(coder);
                    return comment ? `${coder}: ${comment}` : null;
                  }).filter(c => c !== null);
                  row[COMMENTS_HEADER] = commentsList.length > 0 ? commentsList.join(' | ') : '';
                } else {
                  row[COMMENTS_HEADER] = '';
                }
              }

              worksheet.addRow(row);
            }

            worksheet.getRow(1).font = { bold: true };
            worksheet.getRow(1).fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFE0E0E0' }
            };
            processedCombinations += 1;
          } catch (error) {
            this.logger.error(`Error processing combination ${unitName}_${variableId}: ${error.message}`);
            // Continue with next combination instead of failing entirely
          }
        }

        // Force cleanup between batches to help with memory management
        if (global.gc) {
          global.gc();
        }
      }

      this.logger.log(`Successfully processed ${processedCombinations} worksheets for workspace ${workspaceId}`);

      const buffer = await workbook.xlsx.writeBuffer();
      resultBuffer = Buffer.from(buffer);
    } catch (error) {
      this.logger.error(`Error exporting coding results by variable: ${error.message}`, error.stack);
      throw new Error(`Could not export coding results by variable: ${error.message}. This may be due to memory constraints with large datasets.`);
    }

    // Check after try-catch to avoid 'throw of exception caught locally'
    if (processedCombinations === 0) {
      throw new Error('No worksheets could be created within the memory limits. Try reducing the dataset size or increasing the limits.');
    }

    return resultBuffer;
  }

  async exportCodingResultsDetailed(workspaceId: number, outputCommentsInsteadOfCodes = false, includeReplayUrl = false, anonymizeCoders = false, usePseudoCoders = false, authToken = '', req?: Request, excludeAutoCoded = false, checkCancellation?: () => Promise<void>): Promise<Buffer> {
    this.logger.log(`Exporting detailed coding results for workspace ${workspaceId}${outputCommentsInsteadOfCodes ? ' with comments instead of codes' : ''}${includeReplayUrl ? ' with replay URLs' : ''}${anonymizeCoders ? ' with anonymized coders' : ''}${usePseudoCoders ? ' using pseudo coders' : ''}${excludeAutoCoded ? ' (manual coding only)' : ''}`);

    // Check for cancellation before starting
    if (checkCancellation) await checkCancellation();

    let manualCodingVariableSet: Set<string> | null = null;
    if (excludeAutoCoded) {
      const codingListVariables = await this.codingListService.getCodingListVariables(workspaceId);
      if (codingListVariables.length === 0) {
        throw new Error('No manual coding variables found in the coding list for this workspace');
      }
      manualCodingVariableSet = new Set<string>();
      codingListVariables.forEach(item => {
        manualCodingVariableSet.add(`${item.unitName}|${item.variableId}`);
      });
    }

    const codingJobUnits = await this.codingJobUnitRepository.find({
      where: {
        coding_job: {
          workspace_id: workspaceId
        }
      },
      relations: [
        'coding_job',
        'coding_job.codingJobCoders',
        'coding_job.codingJobCoders.user',
        'response',
        'response.unit',
        'response.unit.booklet',
        'response.unit.booklet.person'
      ],
      order: {
        created_at: 'ASC'
      }
    });

    this.logger.log(`Found ${codingJobUnits.length} coding job units for workspace ${workspaceId}`);

    try {
      let coderNameMapping: Map<string, string> | null = null;
      if (anonymizeCoders) {
        if (usePseudoCoders) {
          coderNameMapping = new Map<string, string>();
        } else {
          const allCoders = new Set<string>();
          for (const unit of codingJobUnits) {
            const coderName = unit.coding_job?.codingJobCoders?.[0]?.user?.username || '';
            if (coderName) {
              allCoders.add(coderName);
            }
          }
          coderNameMapping = this.buildCoderNameMapping(Array.from(allCoders), false);
        }
      }

      const pseudoCoderMappings = new Map<string, Map<string, string>>();
      const csvRows: string[] = [];
      const headerColumns = ['"Person"', '"Kodierer"', '"Variable"', '"Kommentar"', '"Kodierzeitpunkt"', '"Code"'];
      if (includeReplayUrl) {
        headerColumns.push('"Replay URL"');
      }
      csvRows.push(headerColumns.join(';'));
      for (const unit of codingJobUnits) {
        if (unit.code === null || unit.code === undefined) {
          continue;
        }

        if (manualCodingVariableSet) {
          const variableKey = `${unit.unit_name}|${unit.variable_id}`;
          if (!manualCodingVariableSet.has(variableKey)) {
            continue;
          }
        }

        const person = unit.response?.unit?.booklet?.person;
        const personId = person?.code || person?.login || '';

        let coder = unit.coding_job?.codingJobCoders?.[0]?.user?.username || '';

        if (anonymizeCoders && coder) {
          if (usePseudoCoders) {
            const varPersonKey = `${unit.variable_id}_${personId}`;
            if (!pseudoCoderMappings.has(varPersonKey)) {
              pseudoCoderMappings.set(varPersonKey, new Map<string, string>());
            }
            const varPersonMap = pseudoCoderMappings.get(varPersonKey)!;

            if (!varPersonMap.has(coder)) {
              const existingCoders = Array.from(varPersonMap.keys()).sort();
              existingCoders.push(coder);
              const sortedCoders = existingCoders.sort();
              const index = sortedCoders.indexOf(coder);
              varPersonMap.set(coder, `K${index + 1}`);
            }
            coder = varPersonMap.get(coder)!;
          } else {
            coder = coderNameMapping?.get(coder) || coder;
          }
        }

        const timestamp = unit.updated_at ?
          new Date(unit.updated_at).toLocaleString('de-DE', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
          }).replace(',', '') : '';

        const escapeCsvField = (field: string): string => `"${field.replace(/"/g, '""')}"`;

        const getCodingIssueText = (issueOption: number | null): string => {
          if (!issueOption) return '';
          const issueTexts: { [key: number]: string } = {
            1: 'Code-Vergabe unsicher',
            2: 'Neuer Code nötig',
            3: 'Ungültig (Spaßantwort)',
            4: 'Technische Probleme'
          };
          return issueTexts[issueOption] || '';
        };

        let commentValue: string;
        if (outputCommentsInsteadOfCodes) {
          commentValue = unit.notes || '';
        } else if (unit.coding_issue_option) {
          commentValue = getCodingIssueText(unit.coding_issue_option);
        } else if (unit.code === 0) {
          commentValue = '';
        } else {
          commentValue = unit.notes || '';
        }

        const codeValue = (unit.code >= -4 && unit.code <= -1) ? '' : unit.code.toString();

        const rowFields = [
          escapeCsvField(personId),
          escapeCsvField(coder),
          escapeCsvField(unit.variable_id),
          escapeCsvField(commentValue),
          escapeCsvField(timestamp),
          escapeCsvField(codeValue)
        ];

        if (includeReplayUrl && req) {
          const bookletName = unit.response?.unit?.booklet?.bookletinfo?.name || '';
          const unitName = unit.response?.unit?.name || '';
          const group = person?.group || '';
          const replayUrl = this.generateReplayUrl(
            req,
            person?.login || '',
            person?.code || '',
            group,
            bookletName,
            unitName,
            unit.variable_id,
            authToken
          );
          rowFields.push(escapeCsvField(replayUrl));
        }

        csvRows.push(rowFields.join(';'));
      }

      this.logger.log(`Generated ${csvRows.length - 1} CSV rows for workspace ${workspaceId}`);

      const csvContent = csvRows.join('\n');
      return Buffer.from(csvContent, 'utf-8');
    } catch (error) {
      this.logger.error(`Error exporting detailed coding results: ${error.message}`, error.stack);
      throw new Error(`Could not export detailed coding results: ${error.message}`);
    }
  }

  async exportCodingTimesReport(workspaceId: number, anonymizeCoders = false, usePseudoCoders = false, excludeAutoCoded = false, checkCancellation?: () => Promise<void>): Promise<Buffer> {
    this.logger.log(`Exporting coding times report for workspace ${workspaceId}${anonymizeCoders ? ' with anonymized coders' : ''}${usePseudoCoders ? ' using pseudo coders' : ''}${excludeAutoCoded ? ' (manual coding only)' : ''}`);

    // Check for cancellation before starting
    if (checkCancellation) await checkCancellation();

    let manualCodingVariableSet: Set<string> | null = null;
    if (excludeAutoCoded) {
      const codingListVariables = await this.codingListService.getCodingListVariables(workspaceId);
      if (codingListVariables.length === 0) {
        throw new Error('No manual coding variables found in the coding list for this workspace');
      }
      manualCodingVariableSet = new Set<string>();
      codingListVariables.forEach(item => {
        manualCodingVariableSet.add(`${item.unitName}|${item.variableId}`);
      });
    }

    const codingJobUnits = await this.codingJobUnitRepository.find({
      where: {
        coding_job: {
          workspace_id: workspaceId
        },
        code: Not(IsNull()) // Only include units that have been coded
      },
      relations: [
        'coding_job',
        'coding_job.codingJobCoders',
        'coding_job.codingJobCoders.user',
        'response',
        'response.unit'
      ],
      select: {
        id: true,
        variable_id: true,
        updated_at: true,
        code: true,
        coding_job: {
          id: true,
          codingJobCoders: {
            id: true,
            user: {
              id: true,
              username: true
            }
          }
        },
        response: {
          id: true,
          unit: {
            id: true,
            name: true
          }
        }
      },
      order: {
        updated_at: 'ASC'
      }
    });

    this.logger.log(`Found ${codingJobUnits.length} coded coding job units for workspace ${workspaceId}`);

    try {
      let coderNameMapping: Map<string, string> | null = null;
      if (anonymizeCoders) {
        const allCoders = new Set<string>();
        for (const unit of codingJobUnits) {
          const coderName = unit.coding_job?.codingJobCoders?.[0]?.user?.username || '';
          if (coderName) {
            allCoders.add(coderName);
          }
        }
        coderNameMapping = this.buildCoderNameMapping(Array.from(allCoders), usePseudoCoders);
      }

      if (codingJobUnits.length > 0) {
        this.logger.log('Sample coded coding job unit:', {
          id: codingJobUnits[0].id,
          variable_id: codingJobUnits[0].variable_id,
          code: codingJobUnits[0].code,
          updated_at: codingJobUnits[0].updated_at,
          unit_name: codingJobUnits[0].response?.unit?.name,
          coders_count: codingJobUnits[0].coding_job?.codingJobCoders?.length,
          first_coder: codingJobUnits[0].coding_job?.codingJobCoders?.[0]?.user?.username
        });
      } else {
        this.logger.warn(`No coded coding job units found for workspace ${workspaceId}`);
      }

      if (codingJobUnits.length === 0) {
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Kodierzeiten-Bericht');

        worksheet.columns = [
          { header: 'Unit', key: 'unit', width: 20 },
          { header: 'Variable', key: 'variable', width: 20 },
          { header: 'Gesamt', key: 'gesamt', width: 15 }
        ];

        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFE0E0E0' }
        };

        worksheet.getColumn('unit').font = { bold: true };
        worksheet.getColumn('variable').font = { bold: true };

        this.logger.log('Generated empty coding times report (no coded units found)');
        const buffer = await workbook.xlsx.writeBuffer();
        return Buffer.from(buffer);
      }

      const coderTimestamps = new Map<string, Date[]>();

      for (const unit of codingJobUnits) {
        if (!unit.updated_at || !unit.coding_job?.codingJobCoders?.length) {
          continue;
        }

        const timestamp = new Date(unit.updated_at);

        for (const jobCoder of unit.coding_job.codingJobCoders) {
          const coderName = jobCoder.user?.username || 'Unknown';

          if (!coderTimestamps.has(coderName)) {
            coderTimestamps.set(coderName, []);
          }

          coderTimestamps.get(coderName)!.push(timestamp);
        }
      }

      const coderAverages = new Map<string, number | null>();
      for (const [coderName, timestamps] of coderTimestamps) {
        const avgTime = this.calculateAverageCodingTime(timestamps);
        coderAverages.set(coderName, avgTime);
      }

      const variableUnitCoders = new Map<string, Set<string>>();

      for (const unit of codingJobUnits) {
        if (!unit.response?.unit?.name) continue;

        const variableId = unit.variable_id;
        const unitName = unit.response.unit.name;
        const variableUnitKey = `${unitName}|${variableId}`;

        if (manualCodingVariableSet) {
          if (!manualCodingVariableSet.has(variableUnitKey)) {
            continue;
          }
        }

        if (!variableUnitCoders.has(variableUnitKey)) {
          variableUnitCoders.set(variableUnitKey, new Set());
        }

        for (const jobCoder of unit.coding_job?.codingJobCoders || []) {
          const coderName = jobCoder.user?.username || 'Unknown';
          variableUnitCoders.get(variableUnitKey)!.add(coderName);
        }
      }

      const coderList = Array.from(coderTimestamps.keys()).sort();

      const displayCoderList = coderNameMapping ?
        coderList.map(coder => coderNameMapping.get(coder) || coder) :
        coderList;

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Kodierzeiten-Bericht');

      worksheet.columns = [
        { header: 'Unit', key: 'unit', width: 20 },
        { header: 'Variable', key: 'variable', width: 20 },
        ...displayCoderList.map((displayCoder, index) => ({ header: displayCoder, key: `coder_${index}`, width: 15 })),
        { header: 'Gesamt', key: 'gesamt', width: 15 }
      ];

      const sortedVariableUnitKeys = Array.from(variableUnitCoders.keys()).sort();

      for (const variableUnitKey of sortedVariableUnitKeys) {
        const [unitName, variableId] = variableUnitKey.split('|');
        const assignedCoders = variableUnitCoders.get(variableUnitKey)!;

        const rowData: { [key: string]: string | number | null } = {
          unit: unitName,
          variable: variableId,
          gesamt: null
        };

        let totalTimeSum = 0;
        let totalValidCodings = 0;

        for (let i = 0; i < coderList.length; i++) {
          const coderName = coderList[i];
          const columnKey = `coder_${i}`;

          if (assignedCoders.has(coderName)) {
            const avgTime = coderAverages.get(coderName);
            rowData[columnKey] = avgTime !== null ? Math.round(avgTime! * 100) / 100 : null;
            if (avgTime !== null) {
              totalTimeSum += avgTime;
              totalValidCodings += 1;
            }
          } else {
            rowData[columnKey] = null;
          }
        }

        rowData.gesamt = totalValidCodings > 0 ? Math.round((totalTimeSum / totalValidCodings) * 100) / 100 : null;

        worksheet.addRow(rowData);
      }

      worksheet.getRow(1).font = { bold: true };
      worksheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' }
      };

      worksheet.getColumn('unit').font = { bold: true };
      worksheet.getColumn('variable').font = { bold: true };

      this.logger.log(`Generated coding times pivot table with ${sortedVariableUnitKeys.length} variable-unit combinations and ${coderList.length} coders`);

      const buffer = await workbook.xlsx.writeBuffer();
      return Buffer.from(buffer);
    } catch (error) {
      this.logger.error(`Error exporting coding times report: ${error.message}`, error.stack);
      throw new Error(`Could not export coding times report: ${error.message}`);
    }
  }

  private calculateAverageCodingTime(timestamps: Date[]): number | null {
    if (timestamps.length < 2) {
      return null;
    }

    const sortedTimestamps = [...timestamps].sort((a, b) => a.getTime() - b.getTime());

    const timeSpans: number[] = [];
    const MAX_GAP_MS = 10 * 60 * 1000; // 10 minutes in milliseconds

    for (let i = 1; i < sortedTimestamps.length; i++) {
      const timeSpan = sortedTimestamps[i].getTime() - sortedTimestamps[i - 1].getTime();

      if (timeSpan <= MAX_GAP_MS) {
        timeSpans.push(timeSpan);
      }
    }

    if (timeSpans.length === 0) {
      return null;
    }

    const totalTimeMs = timeSpans.reduce((sum, span) => sum + span, 0);
    const averageTimeMs = totalTimeMs / timeSpans.length;

    return averageTimeMs / 1000; // Convert to seconds
  }
}
