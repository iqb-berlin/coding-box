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
    private workspaceFilesService: WorkspaceFilesService
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

  async exportCodingResultsAggregated(workspaceId: number, outputCommentsInsteadOfCodes = false, includeReplayUrl = false, authToken = '', req?: Request): Promise<Buffer> {
    this.logger.log(`Exporting aggregated coding results for workspace ${workspaceId}${outputCommentsInsteadOfCodes ? ' with comments instead of codes' : ''}${includeReplayUrl ? ' with replay URLs' : ''}`);
    const BATCH_SIZE = parseInt(process.env.EXPORT_AGGREGATED_BATCH_SIZE || '10000', 10);

    try {
      const unitVariables = await this.workspaceFilesService.getUnitVariableMap(workspaceId);
      const validVariableSets = new Map<string, Set<string>>();
      unitVariables.forEach((vars: Set<string>, unitName: string) => {
        validVariableSets.set(unitName.toUpperCase(), vars);
      });

      const validUnitNames = Array.from(validVariableSets.keys());
      const totalCount = await this.responseRepository
        .createQueryBuilder('response')
        .leftJoin('response.unit', 'unit')
        .leftJoin('unit.booklet', 'booklet')
        .leftJoin('booklet.person', 'person')
        .where('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('UPPER(unit.name) IN (:...validUnitNames)', { validUnitNames })
        .andWhere('(response.code_v1 IS NOT NULL OR response.code_v2 IS NOT NULL OR response.code_v3 IS NOT NULL)')
        .getCount();

      if (totalCount === 0) {
        throw new Error('No coded responses found for this workspace');
      }

      this.logger.log(`Processing ${totalCount} coded responses in batches of ${BATCH_SIZE} for workspace ${workspaceId}`);

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Coding Results');

      const testPersonMap = new Map<string, Map<string, { code: number | null; score: number | null }>>();
      const testPersonComments = new Map<string, Map<string, string | null>>();
      const variableSet = new Set<string>();
      const testPersonList: string[] = [];
      const personGroups = new Map<string, string>();
      const personBooklets = new Map<string, string>();
      const variableUnitNames = new Map<string, string>();

      if (outputCommentsInsteadOfCodes) {
        const codingJobUnits = await this.codingJobUnitRepository.find({
          where: {
            coding_job: {
              workspace_id: workspaceId
            }
          },
          relations: [
            'response',
            'response.unit',
            'response.unit.booklet',
            'response.unit.booklet.person'
          ]
        });

        for (const unit of codingJobUnits) {
          if (!unit.notes) continue;

          const person = unit.response?.unit?.booklet?.person;
          const testPersonKey = `${person?.login || ''}_${person?.code || ''}`;
          const unitId = unit.response?.unit?.id;
          const variableId = unit.variable_id;
          const compositeVariableKey = `${unitId}_${variableId}`;

          if (!testPersonComments.has(testPersonKey)) {
            testPersonComments.set(testPersonKey, new Map());
          }
          testPersonComments.get(testPersonKey)!.set(compositeVariableKey, unit.notes);
        }
      }

      let processedCount = 0;
      let offset = 0;

      while (offset < totalCount) {
        const batchSize = Math.min(BATCH_SIZE, totalCount - offset);

        this.logger.log(`Processing batch ${Math.floor(offset / BATCH_SIZE) + 1}/${Math.ceil(totalCount / BATCH_SIZE)} (${batchSize} responses)`);

        const batchResponses = await this.responseRepository
          .createQueryBuilder('response')
          .leftJoin('response.unit', 'unit')
          .leftJoin('unit.booklet', 'booklet')
          .leftJoin('booklet.bookletinfo', 'bookletinfo')
          .leftJoin('booklet.person', 'person')
          .select([
            'response.id',
            'response.variableid',
            `CASE
              WHEN response.code_v3 IS NOT NULL THEN response.code_v3
              WHEN response.code_v2 IS NOT NULL THEN response.code_v2
              ELSE response.code_v1
            END AS latest_code`,
            `CASE
              WHEN response.code_v3 IS NOT NULL THEN response.score_v3
              WHEN response.code_v2 IS NOT NULL THEN response.score_v2
              ELSE response.score_v1
            END AS latest_score`,
            'unit.id',
            'unit.name',
            'bookletinfo.name',
            'person.login',
            'person.code',
            'person.group'
          ])
          .where('person.workspace_id = :workspaceId', { workspaceId })
          .andWhere('(response.code_v1 IS NOT NULL OR response.code_v2 IS NOT NULL OR response.code_v3 IS NOT NULL)')
          .orderBy('response.id', 'ASC')
          .skip(offset)
          .take(batchSize)
          .getRawMany();

        // Filter responses to only include valid unit-variable combinations
        const filteredBatchResponses = batchResponses.filter(response => {
          const unitName = response.unit_name?.toUpperCase();
          const validVars = validVariableSets.get(unitName || '');
          return validVars?.has(response.variableid);
        });

        // Process this batch
        for (const response of filteredBatchResponses) {
          const testPersonKey = `${response.person_login}_${response.person_code}`;
          const variableId = response.variableid;
          const unitId = response.unit_id;

          // Skip if unit ID is missing
          if (!unitId) continue;

          const compositeVariableKey = `${unitId}_${variableId}`;

          // Cache person group and booklet
          if (!personGroups.has(testPersonKey)) {
            personGroups.set(testPersonKey, response.person_group || '');
          }
          if (!personBooklets.has(testPersonKey)) {
            personBooklets.set(testPersonKey, response.booklet_name || '');
          }

          // Cache unit name for this variable
          if (!variableUnitNames.has(compositeVariableKey)) {
            variableUnitNames.set(compositeVariableKey, response.unit_name || '');
          }

          if (!testPersonMap.has(testPersonKey)) {
            testPersonMap.set(testPersonKey, new Map());
            testPersonList.push(testPersonKey);
          }

          testPersonMap.get(testPersonKey)!.set(compositeVariableKey, {
            code: response.latest_code,
            score: response.latest_score
          });
          variableSet.add(compositeVariableKey);
        }

        processedCount += batchResponses.length;
        offset += batchSize;

        if (global.gc) {
          global.gc();
        }
      }

      this.logger.log(`Processed ${processedCount} responses total. Creating Excel file with ${testPersonList.length} test persons and ${variableSet.size} variables.`);

      const variables = Array.from(variableSet).sort();
      const baseHeaders = ['Test Person Login', 'Test Person Code', 'Group'];
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
          Group: group
        };

        // Add replay URL if requested - use first variable with data
        if (includeReplayUrl && req) {
          let replayUrl = '';
          for (const variable of variables) {
            if (personData.has(variable)) {
              const [varId] = variable.split('_').slice(1);
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

      // Clear memory-intensive data structures
      testPersonMap.clear();
      variableSet.clear();
      personGroups.clear();

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
      this.logger.error(`Error exporting aggregated coding results: ${error.message}`, error.stack);
      throw new Error(`Could not export aggregated coding results: ${error.message}. This may be due to memory constraints with large datasets. Consider using smaller batch sizes or variable-specific exports.`);
    }
  }

  async exportCodingResultsByCoder(workspaceId: number, outputCommentsInsteadOfCodes = false, includeReplayUrl = false, authToken = '', req?: Request): Promise<Buffer> {
    this.logger.log(`Exporting coding results by coder for workspace ${workspaceId}${outputCommentsInsteadOfCodes ? ' with comments instead of codes' : ''}${includeReplayUrl ? ' with replay URLs' : ''}`);

    try {
      const codingJobs = await this.codingJobRepository.find({
        where: { workspace_id: workspaceId },
        relations: ['codingJobCoders', 'codingJobCoders.user', 'codingJobUnits', 'codingJobUnits.response', 'codingJobUnits.response.unit']
      });

      if (codingJobs.length === 0) {
        throw new Error('No coding jobs found for this workspace');
      }

      const jobIds = codingJobs.map(job => job.id);
      const codingJobVariables = await this.codingJobVariableRepository.find({
        where: { coding_job_id: In(jobIds) }
      });

      // Group variables by job ID
      const variablesByJobId = new Map<number, CodingJobVariable[]>();
      codingJobVariables.forEach(variable => {
        if (!variablesByJobId.has(variable.coding_job_id)) {
          variablesByJobId.set(variable.coding_job_id, []);
        }
        variablesByJobId.get(variable.coding_job_id)!.push(variable);
      });

      const workbook = new ExcelJS.Workbook();
      const coderJobs = new Map<string, CodingJob[]>();

      for (const job of codingJobs) {
        for (const jobCoder of job.codingJobCoders) {
          const coderKey = `${jobCoder.user.username}_${jobCoder.user.id}`;
          if (!coderJobs.has(coderKey)) {
            coderJobs.set(coderKey, []);
          }
          coderJobs.get(coderKey)!.push(job);
        }
      }

      // Create a sheet for each coder
      for (const [coderKey, jobs] of coderJobs) {
        const [coderName] = coderKey.split('_');
        const worksheetName = this.generateUniqueWorksheetName(workbook, coderName);
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

        const baseHeaders = ['Test Person Login', 'Test Person Code', 'Group'];
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
            Group: group
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

  async exportCodingResultsByVariable(workspaceId: number, includeModalValue = false, includeDoubleCoded = false, includeComments = false, outputCommentsInsteadOfCodes = false, includeReplayUrl = false, authToken = '', req?: Request): Promise<Buffer> {
    this.logger.log(`Exporting coding results by variable for workspace ${workspaceId} (CODING_INCOMPLETE only)${includeModalValue ? ' with modal value' : ''}${includeDoubleCoded ? ' with double coding indicator' : ''}${includeComments ? ' with comments' : ''}${outputCommentsInsteadOfCodes ? ' with comments instead of codes' : ''}${includeReplayUrl ? ' with replay URLs' : ''}`);

    const MAX_WORKSHEETS = parseInt(process.env.EXPORT_MAX_WORKSHEETS || '100', 10);
    const MAX_RESPONSES_PER_WORKSHEET = parseInt(process.env.EXPORT_MAX_RESPONSES_PER_WORKSHEET || '10000', 10);
    const BATCH_SIZE = parseInt(process.env.EXPORT_BATCH_SIZE || '50', 10);

    // Column header constants
    const MODAL_VALUE_HEADER = 'Häufigster Wert';
    const DEVIATION_COUNT_HEADER = 'Anzahl der Abweichungen';
    const DOUBLE_CODED_HEADER = 'Doppelkodierung';
    const COMMENTS_HEADER = 'Kommentare';

    try {
      const incompleteVariables = await this.getCodingIncompleteVariables(workspaceId);

      if (incompleteVariables.length === 0) {
        throw new Error('No CODING_INCOMPLETE variables found for this workspace');
      }

      this.logger.log(`Found ${incompleteVariables.length} CODING_INCOMPLETE variables for workspace ${workspaceId}`);

      // Create a filter set for quick lookup: "unitName|variableId"
      const incompleteVariableSet = new Set<string>();
      incompleteVariables.forEach(variable => {
        incompleteVariableSet.add(`${variable.unitName}|${variable.variableId}`);
      });

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

      const workbook = new ExcelJS.Workbook();
      let processedCombinations = 0;

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
              take: MAX_RESPONSES_PER_WORKSHEET * 10 // Allow for multiple coders per response
            });

            if (codingJobUnits.length === 0) continue;

            const worksheetName = this.generateUniqueWorksheetName(workbook, `${unitName}_${variableId}`);
            const worksheet = workbook.addWorksheet(worksheetName);

            // Group coding results by test person and coder
            const testPersonMap = new Map<string, Map<string, number | null>>();
            const testPersonComments = new Map<string, Map<string, string | null>>();
            const coderSet = new Set<string>();
            const testPersonData = new Map<string, { login: string; code: string; group: string; booklet: string }>();

            for (const unit of codingJobUnits) {
              // Skip if no code was assigned
              if (unit.code === null || unit.code === undefined) {
                continue;
              }

              const person = unit.response?.unit?.booklet?.person;
              const testPersonKey = `${person?.login || ''}_${person?.code || ''}`;

              // Get coder name (take first coder if multiple assigned to job)
              const coderName = unit.coding_job?.codingJobCoders?.[0]?.user?.username || 'Unknown';
              coderSet.add(coderName);

              // Store test person data including booklet for replay URLs
              if (!testPersonData.has(testPersonKey)) {
                testPersonData.set(testPersonKey, {
                  login: person?.login || '',
                  code: person?.code || '',
                  group: person?.group || '',
                  booklet: unit.response?.unit?.booklet?.bookletinfo?.name || ''
                });
              }

              // Store coding result
              if (!testPersonMap.has(testPersonKey)) {
                testPersonMap.set(testPersonKey, new Map());
              }
              testPersonMap.get(testPersonKey)!.set(coderName, unit.code);

              // Store comments if includeComments is enabled
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

            // Create headers: Test Person Login, Test Person Code, Group, then each coder
            const coderList = Array.from(coderSet).sort();
            const baseHeaders = ['Test Person Login', 'Test Person Code', 'Group'];

            // Add Replay URL column if requested
            if (includeReplayUrl) {
              baseHeaders.push('Replay URL');
            }

            baseHeaders.push(...coderList);

            // Add modal value columns if requested
            if (includeModalValue) {
              baseHeaders.push(MODAL_VALUE_HEADER, DEVIATION_COUNT_HEADER);
            }

            // Add double coding indicator column if requested
            if (includeDoubleCoded) {
              baseHeaders.push(DOUBLE_CODED_HEADER);
            }

            // Add comments column if requested
            if (includeComments) {
              baseHeaders.push(COMMENTS_HEADER);
            }

            worksheet.columns = baseHeaders.map(header => ({ header, key: header, width: header === 'Replay URL' ? 60 : 15 }));

            // Add rows for each test person
            for (const [testPersonKey, codings] of testPersonMap) {
              const personData = testPersonData.get(testPersonKey)!;

              const row: Record<string, string | number | null> = {
                'Test Person Login': personData.login,
                'Test Person Code': personData.code,
                Group: personData.group
              };

              // Add replay URL if requested
              if (includeReplayUrl && req) {
                const replayUrl = this.generateReplayUrl(
                  req,
                  personData.login,
                  personData.code,
                  personData.group,
                  personData.booklet,
                  unitName,
                  variableId,
                  authToken
                );
                row['Replay URL'] = replayUrl;
              }

              // Add coding values for each coder
              const codeValues: (number | null)[] = [];
              for (const coder of coderList) {
                const code = codings.get(coder) ?? null;

                if (outputCommentsInsteadOfCodes) {
                  // Output comments instead of codes
                  const comments = testPersonComments.get(testPersonKey);
                  const comment = comments?.get(coder);
                  row[coder] = comment || '';
                } else {
                  // Display empty cell for negative codes (coding issues)
                  row[coder] = (code !== null && code >= 0) ? code : '';
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

      if (processedCombinations === 0) {
        throw new Error('No worksheets could be created within the memory limits. Try reducing the dataset size or increasing the limits.');
      }

      const buffer = await workbook.xlsx.writeBuffer();
      return Buffer.from(buffer);
    } catch (error) {
      this.logger.error(`Error exporting coding results by variable: ${error.message}`, error.stack);
      throw new Error(`Could not export coding results by variable: ${error.message}. This may be due to memory constraints with large datasets.`);
    }
  }

  async exportCodingResultsDetailed(workspaceId: number, outputCommentsInsteadOfCodes = false, includeReplayUrl = false, authToken = '', req?: Request): Promise<Buffer> {
    this.logger.log(`Exporting detailed coding results for workspace ${workspaceId}${outputCommentsInsteadOfCodes ? ' with comments instead of codes' : ''}${includeReplayUrl ? ' with replay URLs' : ''}`);

    try {
      // Get all coding job units with related data
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

      // Create CSV content
      const csvRows: string[] = [];

      // Add header row
      const headerColumns = ['"Person"', '"Kodierer"', '"Variable"', '"Kommentar"', '"Kodierzeitpunkt"', '"Code"'];
      if (includeReplayUrl) {
        headerColumns.push('"Replay URL"');
      }
      csvRows.push(headerColumns.join(';'));

      // Process each coding job unit
      for (const unit of codingJobUnits) {
        // Skip if no code was assigned
        if (unit.code === null || unit.code === undefined) {
          continue;
        }

        // Get person identifier (prefer code, fallback to login)
        const person = unit.response?.unit?.booklet?.person;
        const personId = person?.code || person?.login || '';

        // Get coder name (take first coder if multiple assigned to job)
        const coder = unit.coding_job?.codingJobCoders?.[0]?.user?.username || '';

        // Format timestamp (use updated_at for when coding was actually performed)
        const timestamp = unit.updated_at ?
          new Date(unit.updated_at).toLocaleString('de-DE', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
          }).replace(',', '') : '';

        // Escape quotes and wrap in quotes
        const escapeCsvField = (field: string): string => `"${field.replace(/"/g, '""')}"`;

        // Create CSV row
        const rowFields = [
          escapeCsvField(personId),
          escapeCsvField(coder),
          escapeCsvField(unit.variable_id),
          escapeCsvField(outputCommentsInsteadOfCodes ? (unit.notes || '') : unit.code.toString()),
          escapeCsvField(timestamp),
          escapeCsvField(unit.code.toString())
        ];

        // Add replay URL if requested
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

      // Convert to buffer
      const csvContent = csvRows.join('\n');
      return Buffer.from(csvContent, 'utf-8');
    } catch (error) {
      this.logger.error(`Error exporting detailed coding results: ${error.message}`, error.stack);
      throw new Error(`Could not export detailed coding results: ${error.message}`);
    }
  }

  private async getCodingIncompleteVariables(workspaceId: number): Promise<{ unitName: string; variableId: string; responseCount: number }[]> {
    const queryBuilder = this.responseRepository.createQueryBuilder('response')
      .select('unit.name', 'unitName')
      .addSelect('response.variableid', 'variableId')
      .addSelect('COUNT(response.id)', 'responseCount')
      .leftJoin('response.unit', 'unit')
      .leftJoin('unit.booklet', 'booklet')
      .leftJoin('booklet.person', 'person')
      .where('response.status_v1 = :status', { status: statusStringToNumber('CODING_INCOMPLETE') })
      .andWhere('person.workspace_id = :workspace_id', { workspace_id: workspaceId });

    queryBuilder
      .groupBy('unit.name')
      .addGroupBy('response.variableid');

    const rawResults = await queryBuilder.getRawMany();

    const unitVariableMap = await this.workspaceFilesService.getUnitVariableMap(workspaceId);

    const validVariableSets = new Map<string, Set<string>>();
    unitVariableMap.forEach((variables: Set<string>, unitName: string) => {
      validVariableSets.set(unitName.toUpperCase(), variables);
    });

    const filteredResult = rawResults.filter(row => {
      const unitNamesValidVars = validVariableSets.get(row.unitName?.toUpperCase());
      return unitNamesValidVars?.has(row.variableId);
    });

    const result = filteredResult.map(row => ({
      unitName: row.unitName,
      variableId: row.variableId,
      responseCount: parseInt(row.responseCount, 10)
    }));

    this.logger.log(`Found ${rawResults.length} CODING_INCOMPLETE variable groups, filtered to ${filteredResult.length} valid variables`);

    return result;
  }

  async exportCodingTimesReport(workspaceId: number): Promise<Buffer> {
    this.logger.log(`Exporting coding times report for workspace ${workspaceId}`);

    try {
      // Get all coding job units with codes (completed coding) and related data
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

      // Debug: Log sample data
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

        if (!variableUnitCoders.has(variableUnitKey)) {
          variableUnitCoders.set(variableUnitKey, new Set());
        }

        for (const jobCoder of unit.coding_job?.codingJobCoders || []) {
          const coderName = jobCoder.user?.username || 'Unknown';
          variableUnitCoders.get(variableUnitKey)!.add(coderName);
        }
      }

      const coderList = Array.from(coderTimestamps.keys()).sort();

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Kodierzeiten-Bericht');

      worksheet.columns = [
        { header: 'Unit', key: 'unit', width: 20 },
        { header: 'Variable', key: 'variable', width: 20 },
        ...coderList.map(coder => ({ header: coder, key: coder, width: 15 })),
        { header: 'Gesamt', key: 'gesamt', width: 15 }
      ];

      // Process each variable-unit combination
      const sortedVariableUnitKeys = Array.from(variableUnitCoders.keys()).sort();

      for (const variableUnitKey of sortedVariableUnitKeys) {
        const [unitName, variableId] = variableUnitKey.split('|');
        const assignedCoders = variableUnitCoders.get(variableUnitKey)!;

        const rowData: { [key: string]: string | number | null } = {
          unit: unitName,
          variable: variableId,
          gesamt: null // Will be calculated from assigned coders
        };

        let totalTimeSum = 0;
        let totalValidCodings = 0;

        for (const coderName of coderList) {
          if (assignedCoders.has(coderName)) {
            const avgTime = coderAverages.get(coderName);
            rowData[coderName] = avgTime !== null ? Math.round(avgTime! * 100) / 100 : null;
            if (avgTime !== null) {
              totalTimeSum += avgTime;
              totalValidCodings += 1;
            }
          } else {
            rowData[coderName] = null;
          }
        }

        rowData.gesamt = totalValidCodings > 0 ? Math.round((totalTimeSum / totalValidCodings) * 100) / 100 : null;

        worksheet.addRow(rowData);
      }

      // Style header row
      worksheet.getRow(1).font = { bold: true };
      worksheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' }
      };

      // Add some basic styling
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
      return null; // Need at least 2 timestamps to calculate time spans
    }

    // Sort timestamps chronologically
    const sortedTimestamps = [...timestamps].sort((a, b) => a.getTime() - b.getTime());

    const timeSpans: number[] = [];
    const MAX_GAP_MS = 10 * 60 * 1000; // 10 minutes in milliseconds

    for (let i = 1; i < sortedTimestamps.length; i++) {
      const timeSpan = sortedTimestamps[i].getTime() - sortedTimestamps[i - 1].getTime();

      // Only include time spans that are 10 minutes or less
      if (timeSpan <= MAX_GAP_MS) {
        timeSpans.push(timeSpan);
      }
    }

    if (timeSpans.length === 0) {
      return null;
    }

    // Calculate average time span in seconds
    const totalTimeMs = timeSpans.reduce((sum, span) => sum + span, 0);
    const averageTimeMs = totalTimeMs / timeSpans.length;

    return averageTimeMs / 1000; // Convert to seconds
  }
}
