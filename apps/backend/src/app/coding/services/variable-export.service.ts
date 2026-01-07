import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as ExcelJS from 'exceljs';
import { Request } from 'express';
import { CodingJobUnit } from '../entities/coding-job-unit.entity';
import { CodingListService } from './coding-list.service';
import { WorkspacesFacadeService } from '../../workspaces/services/workspaces-facade.service';
import { ExportFormattingService } from './export-formatting.service';
import { ExportUrlService } from './export-url.service';

@Injectable()
export class VariableExportService {
  private readonly logger = new Logger(VariableExportService.name);

  constructor(
    @InjectRepository(CodingJobUnit)
    private codingJobUnitRepository: Repository<CodingJobUnit>,
    private codingListService: CodingListService,
    private workspacesFacadeService: WorkspacesFacadeService,
    private exportFormattingService: ExportFormattingService,
    private exportUrlService: ExportUrlService
  ) {}

  async exportCodingResultsByVariable(
    workspaceId: number,
    includeModalValue = false,
    includeDoubleCoded = false,
    includeComments = false,
    outputCommentsInsteadOfCodes = false,
    includeReplayUrl = false,
    anonymizeCoders = false,
    usePseudoCoders = false,
    authToken = '',
    req?: Request,
    excludeAutoCoded = false,
    checkCancellation?: () => Promise<void>
  ): Promise<Buffer> {
    this.logger.log(`Exporting coding results by variable for workspace ${workspaceId}${excludeAutoCoded ? ' (CODING_INCOMPLETE only)' : ''}${includeModalValue ? ' with modal value' : ''}${includeDoubleCoded ? ' with double coding indicator' : ''}${includeComments ? ' with comments' : ''}${outputCommentsInsteadOfCodes ? ' with comments instead of codes' : ''}${includeReplayUrl ? ' with replay URLs' : ''}${anonymizeCoders ? ' with anonymized coders' : ''}${usePseudoCoders ? ' using pseudo coders' : ''}`);

    this.exportUrlService.clearPageMapsCache();
    const MAX_WORKSHEETS = parseInt(process.env.EXPORT_MAX_WORKSHEETS || '100', 10);
    const MAX_RESPONSES_PER_WORKSHEET = parseInt(process.env.EXPORT_MAX_RESPONSES_PER_WORKSHEET || '10000', 10);
    const BATCH_SIZE = parseInt(process.env.EXPORT_BATCH_SIZE || '50', 10);

    const MODAL_VALUE_HEADER = 'Häufigster Wert';
    const DEVIATION_COUNT_HEADER = 'Anzahl der Abweichungen';
    const DOUBLE_CODED_HEADER = 'Doppelkodierung';
    const COMMENTS_HEADER = 'Kommentare';

    if (checkCancellation) await checkCancellation();

    let incompleteVariables: Array<{ unitName: string; variableId: string }> = [];
    if (excludeAutoCoded) {
      incompleteVariables = await this.codingListService.getCodingListVariables(workspaceId);

      if (incompleteVariables.length === 0) {
        throw new Error('No CODING_INCOMPLETE variables found for this workspace');
      }
      this.logger.log(`Found ${incompleteVariables.length} CODING_INCOMPLETE variables for workspace ${workspaceId}`);
    }

    const incompleteVariableSet = new Set<string>();
    if (excludeAutoCoded) {
      incompleteVariables.forEach(variable => {
        incompleteVariableSet.add(`${variable.unitName}|${variable.variableId}`);
      });
    }

    const unitVariableResults = await this.workspacesFacadeService.findCodingIncompleteVariables(workspaceId);

    const filteredUnitVariableResults = unitVariableResults.filter(result => incompleteVariableSet.has(`${result.unitName}|${result.variableId}`)
    );

    this.logger.log(`Filtered to ${filteredUnitVariableResults.length} unit-variable combinations from ${unitVariableResults.length} total CODING_INCOMPLETE responses`);

    if (filteredUnitVariableResults.length === 0) {
      throw new Error('No CODING_INCOMPLETE variables with responses found for this workspace');
    }

    if (filteredUnitVariableResults.length > MAX_WORKSHEETS) {
      this.logger.warn(`Too many unit-variable combinations (${filteredUnitVariableResults.length}) for workspace ${workspaceId}. Limiting to ${MAX_WORKSHEETS} worksheets.`);
      filteredUnitVariableResults.splice(MAX_WORKSHEETS);
    }

    this.logger.log(`Processing ${filteredUnitVariableResults.length} unit-variable combinations in batches of ${BATCH_SIZE}`);

    let processedCombinations = 0;
    let resultBuffer: Buffer;

    try {
      const workbook = new ExcelJS.Workbook();

      for (let i = 0; i < filteredUnitVariableResults.length; i += BATCH_SIZE) {
        const batch = filteredUnitVariableResults.slice(i, i + BATCH_SIZE);
        this.logger.log(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(filteredUnitVariableResults.length / BATCH_SIZE)} (${batch.length} combinations)`);

        for (const { unitName, variableId } of batch) {
          try {
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
                'response.unit.booklet.person',
                'response.unit.booklet.bookletinfo'
              ],
              take: MAX_RESPONSES_PER_WORKSHEET * 10
            });

            if (codingJobUnits.length === 0) continue;

            const worksheetName = this.exportFormattingService.generateUniqueWorksheetName(workbook, `${unitName}_${variableId}`);
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
              coderNameMapping = this.exportFormattingService.buildCoderNameMapping(coderList, true);
            } else if (anonymizeCoders) {
              coderNameMapping = this.exportFormattingService.buildCoderNameMapping(coderList, false);
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
                row['Replay URL'] = await this.exportUrlService.generateReplayUrlWithPageLookup(
                  req,
                  personData.login,
                  personData.code,
                  personData.group,
                  personData.booklet,
                  unitName,
                  variableId,
                  workspaceId,
                  authToken
                );
              }

              const codeValues: (number | null)[] = [];
              for (let coderIndex = 0; coderIndex < coderList.length; coderIndex++) {
                const coder = coderList[coderIndex];
                const displayCoder = displayCoderList[coderIndex];
                const code = codings.get(coder) ?? null;

                if (outputCommentsInsteadOfCodes) {
                  const comments = testPersonComments.get(testPersonKey);
                  const comment = comments?.get(coder);
                  row[displayCoder] = comment || '';
                } else {
                  row[displayCoder] = (code !== null && code >= 0) ? code : '';
                }

                if (code !== null && code >= 0) {
                  codeValues.push(code);
                }
              }

              if (includeModalValue && codeValues.length > 0) {
                const modalResult = this.exportFormattingService.calculateModalValue(codeValues as number[]);
                row[MODAL_VALUE_HEADER] = modalResult.modalValue;
                row[DEVIATION_COUNT_HEADER] = modalResult.deviationCount;
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
          }
        }

        if ((global as unknown as { gc?: () => void }).gc) {
          (global as unknown as { gc?: () => void }).gc?.();
        }
      }

      this.logger.log(`Successfully processed ${processedCombinations} worksheets for workspace ${workspaceId}`);

      const buffer = await workbook.xlsx.writeBuffer();
      resultBuffer = Buffer.from(buffer);
    } catch (error) {
      this.logger.error(`Error exporting coding results by variable: ${error.message}`, error.stack);
      throw new Error(`Could not export coding results by variable: ${error.message}. This may be due to memory constraints with large datasets.`);
    }

    if (processedCombinations === 0) {
      throw new Error('No worksheets could be created within the memory limits. Try reducing the dataset size or increasing the limits.');
    }

    return resultBuffer;
  }
}
