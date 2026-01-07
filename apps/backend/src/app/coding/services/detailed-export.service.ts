import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Request } from 'express';
import { CodingJobUnit } from '../entities/coding-job-unit.entity';
import { CodingListService } from './coding-list.service';
import { ExportFormattingService } from './export-formatting.service';
import { ExportUrlService } from './export-url.service';

@Injectable()
export class DetailedExportService {
  private readonly logger = new Logger(DetailedExportService.name);

  constructor(
    @InjectRepository(CodingJobUnit)
    private codingJobUnitRepository: Repository<CodingJobUnit>,
    private codingListService: CodingListService,
    private exportFormattingService: ExportFormattingService,
    private exportUrlService: ExportUrlService
  ) {}

  async exportCodingResultsDetailed(
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
    this.logger.log(`Exporting detailed coding results for workspace ${workspaceId}${outputCommentsInsteadOfCodes ? ' with comments instead of codes' : ''}${includeReplayUrl ? ' with replay URLs' : ''}${anonymizeCoders ? ' with anonymized coders' : ''}${usePseudoCoders ? ' using pseudo coders' : ''}${excludeAutoCoded ? ' (manual coding only)' : ''}`);

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
          coderNameMapping = this.exportFormattingService.buildCoderNameMapping(Array.from(allCoders), false);
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

        let commentValue: string;
        if (outputCommentsInsteadOfCodes) {
          commentValue = unit.notes || '';
        } else if (unit.coding_issue_option) {
          commentValue = this.exportFormattingService.getCodingIssueText(unit.coding_issue_option);
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
          const replayUrl = await this.exportUrlService.generateReplayUrlWithPageLookup(
            req,
            person?.login || '',
            person?.code || '',
            group,
            bookletName,
            unitName,
            unit.variable_id,
            workspaceId,
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
}
