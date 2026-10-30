import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Request } from 'express';
import { getCurrentManualCoding, buildCoderNameMapping, mapCodeForExport } from '../../../utils/coding-utils';
import { generateUniqueWorksheetName } from '../../../utils/excel-utils';
import { ResponseEntity } from '../../entities/response.entity';
import { CodingJob } from '../../entities/coding-job.entity';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';
import { applyResolvedExclusionsToQuery, WorkspaceExclusionService } from '../workspace/workspace-exclusion.service';
import { toManualCodingVariablePairKey } from '../../utils/manual-coding-candidate.util';
import { CoderJobRawRow, CoderExportJob } from './coding-export.types';
import { createStreamingWorkbookTarget, getStreamingWorkbookBuffer } from './coding-export.util';
import { CodingExportQueryService } from './coding-export-query.service';
import { CodingExportFormattingService } from './coding-export-formatting.service';
import { CodingExportReplayService } from './coding-export-replay.service';

@Injectable()
export class CodingCoderExportService {
  private readonly logger = new Logger(CodingCoderExportService.name);

  constructor(
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    @InjectRepository(CodingJob)
    private codingJobRepository: Repository<CodingJob>,
    @InjectRepository(CodingJobUnit)
    private codingJobUnitRepository: Repository<CodingJobUnit>,
    private workspaceExclusionService: WorkspaceExclusionService,
    private readonly query: CodingExportQueryService,
    private readonly formatting: CodingExportFormattingService,
    private readonly replay: CodingExportReplayService
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
    checkCancellation?: () => Promise<void>,
    jobDefinitionIds?: number[],
    coderTrainingIds?: number[],
    coderIds?: number[],
    serverUrl?: string,
    outputFilePath?: string
  ): Promise<Buffer> {
    this.logger.log(`Exporting coding results by coder for workspace ${workspaceId}${outputCommentsInsteadOfCodes ? ' with comments instead of codes' : ''}${includeReplayUrl ? ' with replay URLs' : ''}${anonymizeCoders ? ' with anonymized coders' : ''}${usePseudoCoders ? ' using pseudo coders' : ''}${excludeAutoCoded ? ' (manual coding only)' : ''}`);

    this.replay.clearPageMapsCache();
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
    if (checkCancellation) await checkCancellation();

    const codingJobsQuery = this.codingJobRepository.createQueryBuilder('cj')
      .leftJoin('cj.codingJobCoders', 'cjc')
      .leftJoin('cjc.user', 'user')
      .select('cj.id', 'jobId')
      .addSelect('cj.training_id', 'trainingId')
      .addSelect('user.id', 'userId')
      .addSelect('user.username', 'username')
      .where('cj.workspace_id = :workspaceId', { workspaceId });

    this.query.applyJobFilters(
      codingJobsQuery,
      normalizedJobDefinitionIds,
      normalizedCoderTrainingIds,
      normalizedCoderIds
    );
    if (normalizedCoderTrainingIds.length === 0) {
      codingJobsQuery.andWhere('cj.training_id IS NULL');
    }

    const codingJobRows = await codingJobsQuery.getRawMany<CoderJobRawRow>();
    await checkCancellation?.();

    if (codingJobRows.length === 0) {
      throw new Error(this.query.getNoCodingResultsMessage(hasScopedJobFilters));
    }

    const jobsById = new Map<number, CoderExportJob>();
    const coderJobsMap = new Map<string, CoderExportJob[]>();
    const allCoderNames = new Set<string>();
    const managerCoderKeySuffix = '|||manager';

    for (const row of codingJobRows) {
      const jobId = this.formatting.toIntegerOrNull(row.jobId);
      if (!jobId) {
        continue;
      }
      const trainingId = this.formatting.toIntegerOrNull(row.trainingId);
      const job = jobsById.get(jobId) ?? {
        id: jobId,
        training_id: trainingId
      };
      jobsById.set(jobId, job);

      const userId = this.formatting.toIntegerOrNull(row.userId);
      if (!userId || !row.username) {
        continue;
      }
      if (normalizedCoderIds.length > 0 && !normalizedCoderIds.includes(userId)) {
        continue;
      }
      allCoderNames.add(row.username);
      const coderKey = `${row.username}_${userId}`;
      if (!coderJobsMap.has(coderKey)) {
        coderJobsMap.set(coderKey, []);
      }
      coderJobsMap.get(coderKey)!.push(job);
    }

    if (normalizedCoderTrainingIds.length > 0) {
      const managerUsernames = await this.query.getTrainingManagerUsernames(workspaceId, normalizedCoderTrainingIds);
      const trainingJobs = Array.from(jobsById.values()).filter(
        job => job.training_id && normalizedCoderTrainingIds.includes(job.training_id)
      );

      managerUsernames.forEach(managerUsername => {
        allCoderNames.add(managerUsername);
        const managerCoderKey = `${managerUsername}${managerCoderKeySuffix}`;
        if (!coderJobsMap.has(managerCoderKey)) {
          coderJobsMap.set(managerCoderKey, trainingJobs);
        }
      });
    }

    const coderNameMapping = anonymizeCoders ?
      buildCoderNameMapping(Array.from(allCoderNames), usePseudoCoders) :
      null;
    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    const isExcluded = await this.query.getExclusionChecker(workspaceId);
    let manualCodingVariableSet: Set<string> | null = null;
    if (excludeAutoCoded) {
      manualCodingVariableSet = await this.query.getManualCodingVariableSet(
        workspaceId,
        normalizedJobDefinitionIds,
        normalizedCoderTrainingIds,
        normalizedCoderIds
      );
    }

    const { workbook, chunks } = createStreamingWorkbookTarget(outputFilePath);

    for (const [coderKey, jobs] of coderJobsMap) {
      if (checkCancellation) await checkCancellation();
      const isManagerSheet = coderKey.endsWith(managerCoderKeySuffix);
      const coderName = isManagerSheet ?
        coderKey.slice(0, -managerCoderKeySuffix.length) :
        coderKey.replace(/_\d+$/, '');
      const displayName = anonymizeCoders && coderNameMapping ? coderNameMapping.get(coderName) || coderName : coderName;
      const worksheetName = generateUniqueWorksheetName(workbook, displayName);
      const worksheet = workbook.addWorksheet(worksheetName);

      const jobIds = jobs.map(j => j.id);
      const variablePairsQuery = this.codingJobUnitRepository.createQueryBuilder('cju')
        .select('cju.unit_name', 'unitName')
        .addSelect('cju.variable_id', 'variableId')
        .addSelect('cju.booklet_name', 'bookletName')
        .where('cju.coding_job_id IN (:...jobIds)', { jobIds })
        .andWhere('cju.unit_name IS NOT NULL')
        .andWhere('cju.variable_id IS NOT NULL')
        .distinct(true);
      applyResolvedExclusionsToQuery(variablePairsQuery, exclusions, {
        unitNameExpression: 'cju.unit_name',
        bookletNameExpression: 'cju.booklet_name'
      });
      const visibleVariablePairs = (await variablePairsQuery.getRawMany())
        .filter(item => (
          (!manualCodingVariableSet || manualCodingVariableSet.has(toManualCodingVariablePairKey(item.unitName, item.variableId))) &&
          !isExcluded(item.bookletName || '', item.unitName)
        ));
      const uniqueVariablePairs = Array.from(
        new Map(visibleVariablePairs.map(item => [`${item.unitName}|${item.variableId}`, item])).values()
      );

      const variableColumns = uniqueVariablePairs
        .map(item => ({
          unitName: item.unitName,
          variableId: item.variableId,
          key: JSON.stringify([item.unitName, item.variableId]),
          header: `${item.unitName} | ${item.variableId}`
        }))
        .sort((a, b) => {
          const unitCmp = a.unitName.localeCompare(b.unitName);
          if (unitCmp !== 0) return unitCmp;
          return a.variableId.localeCompare(b.variableId);
        });

      if (variableColumns.length === 0) {
        await worksheet.commit();
        continue;
      }

      const baseHeaders = ['Test Person Login', 'Test Person Code', 'Test Person Group'];
      if (includeReplayUrl) baseHeaders.push('Replay URL');
      const headers = [...baseHeaders, ...variableColumns.map(col => col.header)];

      worksheet.columns = headers.map(h => ({ header: h, key: h, width: h === 'Replay URL' ? 60 : 15 }));
      const headerRow = worksheet.getRow(1);
      headerRow.font = { bold: true };
      headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };

      const personResults = await this.responseRepository.createQueryBuilder('resp')
        .innerJoin('resp.unit', 'unit')
        .innerJoin('unit.booklet', 'booklet')
        .innerJoin('booklet.person', 'person')
        .innerJoin('coding_job_unit', 'cju', 'cju.response_id = resp.id')
        .select('person.id', 'id')
        .addSelect('MAX(person.login)', 'login')
        .addSelect('MAX(person.code)', 'code')
        .addSelect('MAX(person.group)', 'group')
        .where('cju.coding_job_id IN (:...jobIds)', { jobIds })
        .groupBy('person.id')
        .orderBy('MAX(person.login)', 'ASC');
      applyResolvedExclusionsToQuery(personResults, exclusions, {
        unitNameExpression: 'cju.unit_name',
        bookletNameExpression: 'cju.booklet_name'
      });
      const personResultsRows = await personResults.getRawMany();

      const batchSize = 100;
      for (let j = 0; j < personResultsRows.length; j += batchSize) {
        const batch = personResultsRows.slice(j, j + batchSize);
        const batchIds = batch.map(p => p.id);

        const personDataMap = new Map<number, Record<string, unknown>>();

        if (isManagerSheet) {
          const trainingIdsForJobs = Array.from(
            new Set(
              jobs
                .map(job => job.training_id)
                .filter((trainingId): trainingId is number => !!trainingId)
            )
          );

          if (trainingIdsForJobs.length > 0) {
            const managerCases = await this.responseRepository.createQueryBuilder('resp')
              .innerJoin('resp.unit', 'unit')
              .innerJoin('unit.booklet', 'booklet')
              .leftJoin('booklet.bookletinfo', 'bookletinfo')
              .innerJoin('booklet.person', 'person')
              .innerJoin('coder_training_discussion_result', 'ctdr', 'ctdr.response_id = resp.id')
              .select('resp.variableid', 'variableId')
              .addSelect('unit.name', 'unitName')
              .addSelect('person.id', 'pId')
              .addSelect('bookletinfo.name', 'bookletName')
              .addSelect('ctdr.training_id', 'trainingId')
              .addSelect('ctdr.response_id', 'responseId')
              .where('person.id IN (:...ids)', { ids: batchIds })
              .andWhere('ctdr.workspace_id = :workspaceId', { workspaceId })
              .andWhere('ctdr.training_id IN (:...trainingIds)', { trainingIds: trainingIdsForJobs });
            applyResolvedExclusionsToQuery(managerCases, exclusions, {
              unitNameExpression: 'unit.name',
              bookletNameExpression: 'bookletinfo.name'
            });
            const managerCaseRows = await managerCases.getRawMany();

            const managerDiscussionMap = await this.query.getTrainingDiscussionResultsMap(
              workspaceId,
              trainingIdsForJobs,
              Array.from(new Set(
                managerCaseRows
                  .map(item => parseInt(item.responseId, 10))
                  .filter(responseId => !Number.isNaN(responseId))
              ))
            );

            for (const managerCase of managerCaseRows) {
              const trainingId = parseInt(managerCase.trainingId, 10);
              const responseId = parseInt(managerCase.responseId, 10);
              if (Number.isNaN(trainingId) || Number.isNaN(responseId)) continue;

              const discussion = managerDiscussionMap.get(`${trainingId}|${responseId}`);
              if (!discussion?.managerUsername || discussion.managerUsername !== coderName) continue;

              const pid = parseInt(managerCase.pId, 10);
              if (!personDataMap.has(pid)) {
                personDataMap.set(pid, {});
              }

              if (!managerCase.unitName || !managerCase.variableId) {
                continue;
              }

              if (manualCodingVariableSet && !manualCodingVariableSet.has(toManualCodingVariablePairKey(managerCase.unitName, managerCase.variableId))) {
                continue;
              }

              const pData = personDataMap.get(pid)!;
              const variableKey = JSON.stringify([managerCase.unitName, managerCase.variableId]);
              const mappedCode = mapCodeForExport(discussion.code);
              pData[variableKey] = outputCommentsInsteadOfCodes ? discussion.notes || '' : mappedCode ?? '';
              pData[`_metadata_${variableKey}`] = {
                unitName: managerCase.unitName,
                variableId: managerCase.variableId,
                bookletName: managerCase.bookletName
              };
            }
          }
        } else {
          const responses = await this.responseRepository.createQueryBuilder('resp')
            .innerJoin('resp.unit', 'unit')
            .innerJoin('unit.booklet', 'booklet')
            .leftJoin('booklet.bookletinfo', 'bookletinfo')
            .innerJoin('booklet.person', 'person')
            .innerJoin('coding_job_unit', 'cju', 'cju.response_id = resp.id')
            .innerJoin('cju.coding_job', 'cj')
            .select('resp.variableid', 'variableId')
            .addSelect('unit.name', 'unitName')
            .addSelect('cju.code', 'cju_code')
            .addSelect('resp.code_v1', 'code_v1')
            .addSelect('resp.code_v2', 'code_v2')
            .addSelect('resp.code_v3', 'code_v3')
            .addSelect('resp.autocoder_invalidated_version', 'autocoder_invalidated_version')
            .addSelect('cju.notes', 'notes')
            .addSelect('person.id', 'pId')
            .addSelect('bookletinfo.name', 'bookletName')
            .addSelect('cj.missings_profile_id', 'missingsProfileId')
            .where('person.id IN (:...ids)', { ids: batchIds })
            .andWhere('cju.coding_job_id IN (:...jobIds)', { jobIds });
          applyResolvedExclusionsToQuery(responses, exclusions, {
            unitNameExpression: 'unit.name',
            bookletNameExpression: 'bookletinfo.name'
          });
          const responseRows = await responses.getRawMany();

          for (const resp of responseRows) {
            const pid = parseInt(resp.pId, 10);
            if (!personDataMap.has(pid)) {
              personDataMap.set(pid, {});
            }
            const pData = personDataMap.get(pid)!;
            const rawCode = getCurrentManualCoding(resp, {
              code: resp.cju_code
            }).code;
            const mapped = await this.formatting.mapCodeAndScoreForExport(
              workspaceId,
              rawCode !== null && rawCode !== undefined ? parseInt(rawCode, 10) : null,
              null,
              this.formatting.toIntegerOrNull(resp.missingsProfileId)
            );

            if (!resp.unitName || !resp.variableId) {
              continue;
            }

            if (manualCodingVariableSet && !manualCodingVariableSet.has(toManualCodingVariablePairKey(resp.unitName, resp.variableId))) {
              continue;
            }

            const variableKey = JSON.stringify([resp.unitName, resp.variableId]);
            pData[variableKey] = outputCommentsInsteadOfCodes ? resp.notes || '' : mapped.code ?? '';
            pData[`_metadata_${variableKey}`] = {
              unitName: resp.unitName,
              variableId: resp.variableId,
              bookletName: resp.bookletName
            };
          }
        }

        for (const p of batch) {
          const pid = parseInt(p.id, 10);
          const pData = personDataMap.get(pid) || {};
          const row: Record<string, unknown> = {
            'Test Person Login': p.login,
            'Test Person Code': p.code,
            'Test Person Group': p.group || ''
          };
          if (!variableColumns.some(variableColumn => pData[variableColumn.key] !== undefined)) {
            continue;
          }

          if (includeReplayUrl && (req || serverUrl)) {
            const firstVar = variableColumns.find(v => pData[`_metadata_${v.key}`]);
            if (firstVar) {
              const meta = pData[`_metadata_${firstVar.key}`] as { bookletName: string, unitName: string, variableId: string };
              row['Replay URL'] = await this.replay.generateReplayUrlWithPageLookup(
                req,
                p.login,
                p.code,
                p.group || '',
                meta.bookletName || '',
                meta.unitName,
                meta.variableId,
                workspaceId,
                authToken,
                serverUrl
              );
            }
          }

          for (const variableColumn of variableColumns) {
            row[variableColumn.header] = pData[variableColumn.key] ?? '';
          }
          worksheet.addRow(row).commit();
        }
      }
      await worksheet.commit();
    }

    await workbook.commit();
    return getStreamingWorkbookBuffer(chunks, outputFilePath);
  }

  async exportCodingResultsByCoderToFile(
    filePath: string,
    workspaceId: number,
    outputCommentsInsteadOfCodes = false,
    includeReplayUrl = false,
    anonymizeCoders = false,
    usePseudoCoders = false,
    authToken = '',
    req?: Request,
    excludeAutoCoded = false,
    checkCancellation?: () => Promise<void>,
    jobDefinitionIds?: number[],
    coderTrainingIds?: number[],
    coderIds?: number[],
    serverUrl?: string
  ): Promise<void> {
    await this.exportCodingResultsByCoder(
      workspaceId,
      outputCommentsInsteadOfCodes,
      includeReplayUrl,
      anonymizeCoders,
      usePseudoCoders,
      authToken,
      req,
      excludeAutoCoded,
      checkCancellation,
      jobDefinitionIds,
      coderTrainingIds,
      coderIds,
      serverUrl,
      filePath
    );
  }
}
