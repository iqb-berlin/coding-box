import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { getErrorMessage, getErrorStack, toError } from '../../../utils/error.util';
import { buildCoderNameMapping } from '../../../utils/coding-utils';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';
import { applyResolvedExclusionsToQuery, WorkspaceExclusionService } from '../workspace/workspace-exclusion.service';
import { toManualCodingVariablePairKey } from '../../utils/manual-coding-candidate.util';
import { CodingTimesRawRow } from './coding-export.types';
import {
  createStreamingWorkbookTarget, getStreamingWorkbookBuffer, yieldToEventLoop, isExportCancellationError, calculateAverageCodingTime
} from './coding-export.util';
import { CodingExportQueryService } from './coding-export-query.service';

@Injectable()
export class CodingTimingReportExportService {
  private readonly logger = new Logger(CodingTimingReportExportService.name);

  constructor(
    @InjectRepository(CodingJobUnit)
    private codingJobUnitRepository: Repository<CodingJobUnit>,
    private workspaceExclusionService: WorkspaceExclusionService,
    private readonly query: CodingExportQueryService
  ) {}

  async exportCodingTimesReport(
    workspaceId: number,
    anonymizeCoders = false,
    usePseudoCoders = false,
    excludeAutoCoded = false,
    checkCancellation?: () => Promise<void>,
    jobDefinitionIds?: number[],
    coderTrainingIds?: number[],
    coderIds?: number[],
    outputFilePath?: string
  ): Promise<Buffer> {
    this.logger.log(`Exporting coding times report for workspace ${workspaceId}${anonymizeCoders ? ' with anonymized coders' : ''}${usePseudoCoders ? ' using pseudo coders' : ''}${excludeAutoCoded ? ' (manual coding only)' : ''}`);
    const {
      jobDefinitionIds: normalizedJobDefinitionIds,
      coderTrainingIds: normalizedCoderTrainingIds,
      coderIds: normalizedCoderIds
    } = this.query.normalizeJobFilters(
      jobDefinitionIds,
      coderTrainingIds,
      coderIds
    );
    const hasScopedJobFilters = this.query.hasScopedJobFilters(
      normalizedJobDefinitionIds,
      normalizedCoderTrainingIds,
      normalizedCoderIds
    );

    // Check for cancellation before starting
    if (checkCancellation) await checkCancellation();

    let manualCodingVariableSet: Set<string> | null = null;
    if (excludeAutoCoded) {
      manualCodingVariableSet = await this.query.getManualCodingVariableSet(
        workspaceId,
        normalizedJobDefinitionIds,
        normalizedCoderTrainingIds,
        normalizedCoderIds
      );
    }

    try {
      const variableUnitCoders = new Map<string, Set<string>>();
      const variableUnitCoderTimestamps = new Map<string, Map<string, Date[]>>();
      const variableUnitLabels = new Map<string, { unitName: string; variableId: string }>();
      const allCoderNames = new Set<string>();
      const codingTimesBatchSize = 2000;
      let totalRowsRead = 0;
      let lastUpdatedAt: Date | string | null = null;
      let lastId: number | string | null = null;
      let sampleRow: CodingTimesRawRow | null = null;

      const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);

      let hasMoreCodingTimesRows = true;
      while (hasMoreCodingTimesRows) {
        await checkCancellation?.();

        const codingTimesQuery = this.codingJobUnitRepository.createQueryBuilder('cju')
          .select('cju.id', 'id')
          .addSelect('cju.variable_id', 'variableId')
          .addSelect('cju.updated_at', 'updatedAt')
          .addSelect('cju.unit_name', 'unitName')
          .addSelect('cju.booklet_name', 'bookletName')
          .addSelect('cjc.id', 'coderAssignmentId')
          .addSelect('user.username', 'coderName')
          .innerJoin('cju.coding_job', 'cj')
          .leftJoin('cj.codingJobCoders', 'cjc')
          .leftJoin('cjc.user', 'user')
          .where('cj.workspace_id = :workspaceId', { workspaceId })
          .andWhere('cju.code IS NOT NULL')
          .andWhere('cju.updated_at IS NOT NULL');

        applyResolvedExclusionsToQuery(codingTimesQuery, exclusions, {
          unitNameExpression: 'cju.unit_name',
          bookletNameExpression: 'cju.booklet_name'
        });

        this.query.applyJobFilters(
          codingTimesQuery,
          normalizedJobDefinitionIds,
          normalizedCoderTrainingIds,
          normalizedCoderIds,
          'cju'
        );
        if (normalizedCoderTrainingIds.length === 0) {
          codingTimesQuery.andWhere('cj.training_id IS NULL');
        }
        if (lastUpdatedAt !== null && lastId !== null) {
          codingTimesQuery.andWhere(
            '(cju.updated_at > :lastUpdatedAt OR (cju.updated_at = :lastUpdatedAt AND cju.id > :lastId))',
            { lastUpdatedAt, lastId }
          );
        }

        const rows = await codingTimesQuery
          .orderBy('cju.updated_at', 'ASC')
          .addOrderBy('cju.id', 'ASC')
          .limit(codingTimesBatchSize)
          .getRawMany<CodingTimesRawRow>();

        await checkCancellation?.();

        if (rows.length === 0) {
          hasMoreCodingTimesRows = false;
          continue;
        }

        totalRowsRead += rows.length;
        sampleRow ??= rows[0];

        for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
          if (rowIndex > 0 && rowIndex % 500 === 0) {
            await checkCancellation?.();
            await yieldToEventLoop();
          }

          const row = rows[rowIndex];
          if (!row.unitName || !row.variableId || !row.updatedAt || row.coderAssignmentId === null) {
            continue;
          }

          const variableUnitKey = toManualCodingVariablePairKey(row.unitName, row.variableId);
          if (manualCodingVariableSet && !manualCodingVariableSet.has(variableUnitKey)) {
            continue;
          }

          if (!variableUnitCoders.has(variableUnitKey)) {
            variableUnitCoders.set(variableUnitKey, new Set());
            variableUnitLabels.set(variableUnitKey, { unitName: row.unitName, variableId: row.variableId });
          }

          if (!variableUnitCoderTimestamps.has(variableUnitKey)) {
            variableUnitCoderTimestamps.set(variableUnitKey, new Map<string, Date[]>());
          }

          const coderName = row.coderName || 'Unknown';
          allCoderNames.add(coderName);
          variableUnitCoders.get(variableUnitKey)!.add(coderName);

          const coderTimestampsByVariableUnit = variableUnitCoderTimestamps.get(variableUnitKey)!;
          if (!coderTimestampsByVariableUnit.has(coderName)) {
            coderTimestampsByVariableUnit.set(coderName, []);
          }
          coderTimestampsByVariableUnit.get(coderName)!.push(new Date(row.updatedAt));
        }

        const lastRow = rows[rows.length - 1];
        lastUpdatedAt = lastRow.updatedAt;
        lastId = lastRow.id;

        if (rows.length < codingTimesBatchSize) {
          hasMoreCodingTimesRows = false;
          continue;
        }

        await yieldToEventLoop();
      }

      this.logger.log(`Found ${totalRowsRead} coded coding-times rows for workspace ${workspaceId} after database-side exclusion filtering`);
      if (sampleRow) {
        this.logger.log('Sample coded coding-times row:', {
          id: sampleRow.id,
          variable_id: sampleRow.variableId,
          updated_at: sampleRow.updatedAt,
          unit_name: sampleRow.unitName,
          booklet_name: sampleRow.bookletName,
          first_coder: sampleRow.coderName
        });
      } else {
        this.logger.warn(`No coded coding-times rows found for workspace ${workspaceId}`);
      }

      if (totalRowsRead === 0 && hasScopedJobFilters) {
        throw new Error(this.query.getNoCodingResultsMessage(true));
      }

      let coderNameMapping: Map<string, string> | null = null;
      if (anonymizeCoders) {
        coderNameMapping = buildCoderNameMapping(Array.from(allCoderNames), usePseudoCoders);
      }

      const coderList = Array.from(new Set(
        Array.from(variableUnitCoders.values()).flatMap(coders => Array.from(coders.values()))
      )).sort();

      if (variableUnitCoders.size === 0 && hasScopedJobFilters) {
        throw new Error(this.query.getNoCodingResultsMessage(true));
      }

      const displayCoderList = coderNameMapping ?
        coderList.map(coder => coderNameMapping.get(coder) || coder) :
        coderList;

      const { workbook, chunks } = createStreamingWorkbookTarget(outputFilePath);
      const worksheet = workbook.addWorksheet('Kodierzeiten-Bericht');

      worksheet.columns = [
        { header: 'Unit', key: 'unit', width: 20 },
        { header: 'Variable', key: 'variable', width: 20 },
        ...displayCoderList.map((displayCoder, index) => ({ header: displayCoder, key: `coder_${index}`, width: 15 })),
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

      const sortedVariableUnitKeys = Array.from(variableUnitCoders.keys()).sort();

      for (let rowIndex = 0; rowIndex < sortedVariableUnitKeys.length; rowIndex += 1) {
        if (rowIndex > 0 && rowIndex % 250 === 0) {
          await checkCancellation?.();
          await yieldToEventLoop();
        }

        const variableUnitKey = sortedVariableUnitKeys[rowIndex];
        const { unitName, variableId } = variableUnitLabels.get(variableUnitKey) || {
          unitName: variableUnitKey,
          variableId: ''
        };
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
            const coderTimestamps = variableUnitCoderTimestamps
              .get(variableUnitKey)
              ?.get(coderName) || [];
            const avgTime = calculateAverageCodingTime(coderTimestamps);
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

        worksheet.addRow(rowData).commit();
      }

      this.logger.log(`Generated coding times pivot table with ${sortedVariableUnitKeys.length} variable-unit combinations and ${coderList.length} coders`);

      await checkCancellation?.();
      await worksheet.commit();
      await checkCancellation?.();
      await workbook.commit();
      await checkCancellation?.();
      return getStreamingWorkbookBuffer(chunks, outputFilePath);
    } catch (error) {
      if (isExportCancellationError(toError(error))) {
        throw error;
      }
      this.logger.error(`Error exporting coding times report: ${getErrorMessage(error)}`, getErrorStack(error));
      throw new Error(`Could not export coding times report: ${getErrorMessage(error)}`);
    }
  }

  async exportCodingTimesReportToFile(
    filePath: string,
    workspaceId: number,
    anonymizeCoders = false,
    usePseudoCoders = false,
    excludeAutoCoded = false,
    checkCancellation?: () => Promise<void>,
    jobDefinitionIds?: number[],
    coderTrainingIds?: number[],
    coderIds?: number[]
  ): Promise<void> {
    await this.exportCodingTimesReport(
      workspaceId,
      anonymizeCoders,
      usePseudoCoders,
      excludeAutoCoded,
      checkCancellation,
      jobDefinitionIds,
      coderTrainingIds,
      coderIds,
      filePath
    );
  }
}
