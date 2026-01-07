import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as ExcelJS from 'exceljs';
import { Request } from 'express';
import { CodingJob } from '../entities/coding-job.entity';
import { CodingJobVariable } from '../entities/coding-job-variable.entity';
import { CodingListService } from './coding-list.service';
import { WorkspacesFacadeService } from '../../workspaces/services/workspaces-facade.service';
import { ExportFormattingService } from './export-formatting.service';
import { ExportUrlService } from './export-url.service';

@Injectable()
export class CoderExportService {
  private readonly logger = new Logger(CoderExportService.name);

  constructor(
    @InjectRepository(CodingJob)
    private codingJobRepository: Repository<CodingJob>,
    @InjectRepository(CodingJobVariable)
    private codingJobVariableRepository: Repository<CodingJobVariable>,
    private codingListService: CodingListService,
    private workspacesFacadeService: WorkspacesFacadeService,
    private exportFormattingService: ExportFormattingService,
    private exportUrlService: ExportUrlService
  ) {}

  async exportCodingResultsByCoder(
    workspaceId: number,
    outputCommentsInsteadOfCodes = false,
    includeReplayUrl = false,
    anonymizeCoders = false,
    usePseudoCoders = false,
    authToken = '',
    req?: Request,
    excludeAutoCoded = false,
    checkCancellation?: () => Promise<void>
  ): Promise<Buffer> {
    this.logger.log(`Exporting coding results by coder for workspace ${workspaceId}${outputCommentsInsteadOfCodes ? ' with comments instead of codes' : ''}${includeReplayUrl ? ' with replay URLs' : ''}${anonymizeCoders ? ' with anonymized coders' : ''}${usePseudoCoders ? ' using pseudo coders' : ''}${excludeAutoCoded ? ' (manual coding only)' : ''}`);

    this.exportUrlService.clearPageMapsCache();

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
        this.exportFormattingService.buildCoderNameMapping(Array.from(allCoderNames), usePseudoCoders) :
        null;

      for (const [coderKey, jobs] of coderJobs) {
        const [coderName] = coderKey.split('_');
        const displayName = anonymizeCoders && coderNameMapping ? coderNameMapping.get(coderName) || coderName : coderName;
        const worksheetName = this.exportFormattingService.generateUniqueWorksheetName(workbook, displayName);
        const worksheet = workbook.addWorksheet(worksheetName);

        const variableSet = new Set<string>();
        const testPersonMap = new Map<string, Map<string, { code: number | null; score: number | null }>>();
        const testPersonComments = new Map<string, Map<string, string | null>>();
        const testPersonList: string[] = [];
        const personGroups = new Map<string, string>();
        const personBooklets = new Map<string, string>();
        const variableUnitNames = new Map<string, string>();

        for (const job of jobs) {
          const unitIds = job.codingJobUnits.map(ju => ju.response?.unit?.id).filter((id): id is number => id !== undefined);
          const jobVariables = variablesByJobId.get(job.id) || [];
          const variableIds = jobVariables.map(jv => jv.variable_id);

          if (unitIds.length === 0 || variableIds.length === 0) continue;

          const responses = await this.workspacesFacadeService.findResponsesByUnitsAndVariables(unitIds, variableIds);

          for (const response of responses) {
            const person = response.unit?.booklet?.person;
            const testPersonKey = `${person?.login}_${person?.code}`;
            const variableId = response.variableid;
            const unitName = response.unit?.name;
            const compositeKey = unitName ? `${unitName}_${variableId}` : variableId;
            const latestCoding = this.exportFormattingService.getLatestCode(response);

            if (!personGroups.has(testPersonKey)) {
              personGroups.set(testPersonKey, person?.group || '');
            }
            if (!personBooklets.has(testPersonKey)) {
              personBooklets.set(testPersonKey, response.unit?.booklet?.bookletinfo?.name || '');
            }

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

            if (manualCodingVariableSet) {
              const variableKey = `${unitName}|${response.variableid}`;
              if (!manualCodingVariableSet.has(variableKey)) {
                continue;
              }
            }

            variableSet.add(compositeKey);
          }

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

          if (includeReplayUrl && req) {
            let replayUrl = '';
            for (const variable of variables) {
              if (personData.has(variable)) {
                const parts = variable.split('_');
                const varId = parts[parts.length - 1];
                const unitName = variableUnitNames.get(variable) || '';
                replayUrl = await this.exportUrlService.generateReplayUrlWithPageLookup(req, login, code, group, bookletName, unitName, varId, workspaceId, authToken);
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
}
