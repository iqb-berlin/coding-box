import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as ExcelJS from 'exceljs';
import { Request } from 'express';
import { CodingJobUnit } from '../entities/coding-job-unit.entity';
import { CodingListService } from './coding-list.service';
import { ExportFormattingService } from './export-formatting.service';
import { ExportUrlService } from './export-url.service';

@Injectable()
export class AggregatedExportService {
  private readonly logger = new Logger(AggregatedExportService.name);

  constructor(
    @InjectRepository(CodingJobUnit)
    private codingJobUnitRepository: Repository<CodingJobUnit>,
    private codingListService: CodingListService,
    private exportFormattingService: ExportFormattingService,
    private exportUrlService: ExportUrlService
  ) {}

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

    this.exportUrlService.clearPageMapsCache();

    if (doubleCodingMethod === 'new-row-per-variable') {
      return this.exportAggregatedNewRowPerVariable(workspaceId, outputCommentsInsteadOfCodes, includeReplayUrl, anonymizeCoders, usePseudoCoders, includeComments, includeModalValue, authToken, req, excludeAutoCoded, checkCancellation);
    }

    if (doubleCodingMethod === 'new-column-per-coder') {
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
        'response.unit.booklet.person',
        'response.unit.booklet.bookletinfo'
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
            const modalResult = this.exportFormattingService.calculateModalValue(codes);
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
              replayUrl = await this.exportUrlService.generateReplayUrlWithPageLookup(req, login, code, group, bookletName, unitName, variableId, workspaceId, authToken);
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

  async exportAggregatedNewRowPerVariable(
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
        'response.unit.booklet.person',
        'response.unit.booklet.bookletinfo'
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
        coderMapping = this.exportFormattingService.buildCoderMapping(codingJobUnits, usePseudoCoders);
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
            row['Replay URL'] = await this.exportUrlService.generateReplayUrlWithPageLookup(req, login, code, group, bookletName, unitName, variableId, workspaceId, authToken);
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
            const modalResult = this.exportFormattingService.calculateModalValue(codes);
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

  async exportAggregatedNewColumnPerCoder(
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
        'response.unit.booklet.person',
        'response.unit.booklet.bookletinfo'
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
        coderMapping = this.exportFormattingService.buildCoderMapping(codingJobUnits, usePseudoCoders);
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
      }

      worksheet.columns = headers.map(header => ({ header, key: header, width: header === 'Replay URL' ? 60 : 15 }));

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
            allComments.push(coding.comment);
          }
        }

        // Add modal value
        if (includeModalValue && allCodes.length > 0) {
          const modalResult = this.exportFormattingService.calculateModalValue(allCodes);
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
}
