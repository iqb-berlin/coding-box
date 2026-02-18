import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Brackets } from 'typeorm';
import { ResponseEntity } from '../../database/entities/response.entity';
import {
  ResponseMatchingFlag,
  CodingJobService
} from '../../database/services/coding/coding-job.service';
import {
  ResponseAnalysisDto,
  EmptyResponseDto,
  DuplicateValueGroupDto
} from '../../../../../../api-dto/coding/response-analysis.dto';
import { CacheService } from '../../cache/cache.service';
import { statusStringToNumber } from '../../database/utils/response-status-converter';
import { CodingAnalysisJobData } from '../job-queue.service';

@Processor('response-analysis')
export class CodingAnalysisProcessor {
  private readonly logger = new Logger(CodingAnalysisProcessor.name);

  constructor(
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    private codingJobService: CodingJobService,
    private cacheService: CacheService
  ) { }

  @Process()
  async handleResponseAnalysis(job: Job<CodingAnalysisJobData>) {
    const {
      workspaceId, matchingFlags, threshold, cacheKey
    } = job.data;
    this.logger.log(`Processing response analysis for workspace ${workspaceId}...`);

    try {
      const analysis = await this.computeResponseAnalysis(workspaceId, matchingFlags as ResponseMatchingFlag[], threshold, job);
      await this.cacheService.set(cacheKey, analysis);

      this.logger.log(`Response analysis for workspace ${workspaceId} completed and cached.`);
      return analysis;
    } catch (error) {
      this.logger.error(`Response analysis failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  private async computeResponseAnalysis(
    workspaceId: number,
    matchingFlags: ResponseMatchingFlag[],
    threshold: number,
    job?: Job<CodingAnalysisJobData>
  ): Promise<ResponseAnalysisDto> {
    const codingIncompleteStatus = statusStringToNumber('CODING_INCOMPLETE');
    const intendedIncompleteStatus = statusStringToNumber('INTENDED_INCOMPLETE');

    // 1. Identify relevant Unit+Variable combinations
    this.logger.log(`Identifying relevant variables for analysis in workspace ${workspaceId}...`);
    const relevantVariables = await this.responseRepository
      .createQueryBuilder('response')
      .select('response.unitid', 'unitId')
      .addSelect('response.variableid', 'variableId')
      .distinct(true)
      .innerJoin('response.unit', 'unit')
      .innerJoin('unit.booklet', 'booklet')
      .innerJoin('booklet.person', 'person')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      .andWhere('response.status_v1 IN (:...statuses)', { statuses: [codingIncompleteStatus, intendedIncompleteStatus] })
      .getRawMany();

    if (relevantVariables.length === 0) {
      this.logger.warn(`No relevant variables found for analysis in workspace ${workspaceId}`);
      return this.createEmptyAnalysisResult(matchingFlags);
    }

    this.logger.log(`Found ${relevantVariables.length} variable groups to analyze. Processing in chunks...`);

    const emptyResponses: EmptyResponseDto[] = [];
    const duplicateValueGroups: DuplicateValueGroupDto[] = [];
    let totalProcessed = 0;

    // Check if aggregation is already applied (marked by code_v2 = -111)
    const isAggregationApplied = await this.responseRepository
      .createQueryBuilder('response')
      .innerJoin('response.unit', 'unit')
      .innerJoin('unit.booklet', 'booklet')
      .innerJoin('booklet.person', 'person')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('response.code_v2 = :aggregatedCode', { aggregatedCode: -111 })
      .getCount() > 0;

    // 2. Process in chunks
    const chunkSize = 50; // Number of variable groups per query
    for (let i = 0; i < relevantVariables.length; i += chunkSize) {
      const chunk = relevantVariables.slice(i, i + chunkSize);

      const qb = this.responseRepository.createQueryBuilder('response')
        .leftJoinAndSelect('response.unit', 'unit')
        .leftJoinAndSelect('unit.booklet', 'booklet')
        .leftJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
        .leftJoinAndSelect('booklet.person', 'person')
        .where('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('person.consider = :consider', { consider: true })
        .andWhere('response.status_v1 IN (:...statuses)', { statuses: [codingIncompleteStatus, intendedIncompleteStatus] })
        // Exclude already-aggregated responses (non-master duplicates) so they don't reappear after aggregation
        .andWhere('(response.code_v2 != :aggregatedCode OR response.code_v2 IS NULL)', { aggregatedCode: -111 });

      qb.andWhere(new Brackets(qbInside => {
        chunk.forEach((item, index) => {
          const params = { [`uid${index}`]: item.unitId, [`vid${index}`]: item.variableId };
          if (index === 0) {
            qbInside.where(`response.unitid = :uid${index} AND response.variableid = :vid${index}`, params);
          } else {
            qbInside.orWhere(`response.unitid = :uid${index} AND response.variableid = :vid${index}`, params);
          }
        });
      }));

      const responsesBatch = await qb.getMany();
      totalProcessed += responsesBatch.length;

      this.analyzeBatch(
        responsesBatch,
        matchingFlags,
        emptyResponses,
        duplicateValueGroups
      );

      // Explicitly free memory if possible (though GC handles function scope)
      if ((i + chunkSize) % 500 === 0 || (i + chunkSize) >= relevantVariables.length) {
        const processed = Math.min(i + chunkSize, relevantVariables.length);
        const progress = Math.round((processed / relevantVariables.length) * 100);
        if (job) {
          await job.progress(progress);
        }
        this.logger.log(`Processed ${processed}/${relevantVariables.length} variable groups...`);
        if (global.gc) { global.gc(); }
      }
    }

    const mergedGroupsMap = new Map<string, DuplicateValueGroupDto>();
    for (const group of duplicateValueGroups) {
      const key = `${group.unitName}_${group.variableId}_${group.normalizedValue}`;
      if (mergedGroupsMap.has(key)) {
        // Merge occurrences into the existing group
        mergedGroupsMap.get(key)!.occurrences.push(...group.occurrences);
      } else {
        mergedGroupsMap.set(key, { ...group, occurrences: [...group.occurrences] });
      }
    }

    // Apply threshold filter on merged groups and build the final list
    const mergedGroups = Array.from(mergedGroupsMap.values())
      .filter(group => group.occurrences.length >= threshold);

    // Sort results
    emptyResponses.sort((a, b) => {
      if (a.unitName !== b.unitName) return a.unitName.localeCompare(b.unitName);
      if (a.variableId !== b.variableId) return a.variableId.localeCompare(b.variableId);
      return a.personLogin.localeCompare(b.personLogin);
    });

    mergedGroups.sort((a, b) => {
      if (a.unitName !== b.unitName) return a.unitName.localeCompare(b.unitName);
      return a.variableId.localeCompare(b.variableId);
    });

    const totalDuplicateResponses = mergedGroups.reduce(
      (sum, group) => sum + group.occurrences.length,
      0
    );

    this.logger.log(`Analysis complete. Processed ${totalProcessed} responses. Found ${mergedGroups.length} duplicate groups.`);

    return {
      emptyResponses: {
        total: emptyResponses.length,
        items: emptyResponses
      },
      duplicateValues: {
        total: mergedGroups.length,
        totalResponses: totalDuplicateResponses,
        groups: mergedGroups,
        isAggregationApplied
      },
      matchingFlags: matchingFlags as unknown as string[],
      analysisTimestamp: new Date().toISOString()
    };
  }

  private analyzeBatch(
    responses: ResponseEntity[],
    matchingFlags: ResponseMatchingFlag[],
    emptyResponses: EmptyResponseDto[],
    duplicateValueGroups: DuplicateValueGroupDto[]
  ) {
    // We group by Unit+Variable within this batch
    // Since our query chunked by Unit+Variable, we can treat this batch as a collection of complete groups

    // Group responses by unit+variable
    const responsesByUnitVariable = new Map<string, ResponseEntity[]>();

    for (const response of responses) {
      // Empty Check - IMPROVED LOGIC
      const value = response.value;
      const isEmptyValue =
        value === null ||
        value === undefined ||
        (typeof value === 'string' && value.trim() === '') ||
        value === '[]';

      if (isEmptyValue) {
        if (response.status_v2 === null) {
          emptyResponses.push({
            unitName: response.unit?.name || '',
            unitAlias: response.unit?.alias || null,
            variableId: response.variableid,
            personLogin: response.unit?.booklet?.person?.login || '',
            personCode: response.unit?.booklet?.person?.code || '',
            personGroup: response.unit?.booklet?.person?.group || '',
            bookletName: response.unit?.booklet?.bookletinfo?.name || 'Unknown',
            responseId: response.id,
            value: response.value
          });
        }
        continue; // Skip empty for duplicates
      }

      const key = `${response.unit?.name || response.unitid}_${response.variableid}`;
      if (!responsesByUnitVariable.has(key)) {
        responsesByUnitVariable.set(key, []);
      }
      responsesByUnitVariable.get(key)!.push(response);
    }

    for (const [, groupResponses] of responsesByUnitVariable.entries()) {
      const valueGroups = new Map<string, ResponseEntity[]>();
      for (const response of groupResponses) {
        const normalizedValue = this.codingJobService.normalizeValue(
          response.value,
          matchingFlags
        );
        if (!valueGroups.has(normalizedValue)) {
          valueGroups.set(normalizedValue, []);
        }
        valueGroups.get(normalizedValue)!.push(response);
      }

      for (const [normalizedValue, valGroup] of valueGroups.entries()) {
        const first = valGroup[0];
        duplicateValueGroups.push({
          unitName: first.unit?.name || '',
          unitAlias: first.unit?.alias || null,
          variableId: first.variableid,
          normalizedValue,
          originalValue: first.value || '',
          occurrences: valGroup.map(r => ({
            personLogin: r.unit?.booklet?.person?.login || 'Unknown',
            personCode: r.unit?.booklet?.person?.code || '',
            bookletName: r.unit?.booklet?.bookletinfo?.name || 'Unknown',
            responseId: r.id,
            value: r.value || ''
          }))
        });
      }
    }
  }

  private createEmptyAnalysisResult(
    matchingFlags: ResponseMatchingFlag[]
  ): ResponseAnalysisDto {
    const result: ResponseAnalysisDto = {
      emptyResponses: {
        total: 0,
        items: []
      },
      duplicateValues: {
        total: 0,
        totalResponses: 0,
        groups: [],
        isAggregationApplied: !matchingFlags.includes(
          ResponseMatchingFlag.NO_AGGREGATION
        )
      },
      matchingFlags: matchingFlags as unknown as string[],
      analysisTimestamp: new Date().toISOString()
    };

    return result;
  }
}
