import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import * as ExcelJS from 'exceljs';
import { buildCoderNameMapping } from '../../../utils/coding-utils';
import { CodingListService } from './coding-list.service';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';

@Injectable()
export class CodingTimesExportService {
  private readonly logger = new Logger(CodingTimesExportService.name);

  constructor(
    @InjectRepository(CodingJobUnit)
    private codingJobUnitRepository: Repository<CodingJobUnit>,
    private codingListService: CodingListService
  ) { }

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
        coderNameMapping = buildCoderNameMapping(Array.from(allCoders), usePseudoCoders);
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

  calculateAverageCodingTime(timestamps: Date[]): number | null {
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
