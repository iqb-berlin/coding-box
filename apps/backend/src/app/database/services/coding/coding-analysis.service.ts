import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { statusStringToNumber } from '../../utils/response-status-converter';
import Persons from '../../entities/persons.entity';
import { Unit } from '../../entities/unit.entity';
import { Booklet } from '../../entities/booklet.entity';
import { ResponseEntity } from '../../entities/response.entity';
import {
  ResponseAnalysisDto,
  EmptyResponseDto,
  DuplicateValueGroupDto
} from '../../../../../../../api-dto/coding/response-analysis.dto';
import { CodingJobService } from './coding-job.service';
import { CodingValidationService } from './coding-validation.service';

@Injectable()
export class CodingAnalysisService {
  private readonly logger = new Logger(CodingAnalysisService.name);

  constructor(
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    @InjectRepository(Persons)
    private personsRepository: Repository<Persons>,
    @InjectRepository(Booklet)
    private bookletRepository: Repository<Booklet>,
    @InjectRepository(Unit)
    private unitRepository: Repository<Unit>,
    private codingJobService: CodingJobService,
    private codingValidationService: CodingValidationService
  ) { }

  /**
     * Analyzes responses for a workspace to identify:
     * 1. Empty responses (null or empty string values)
     * 2. Duplicate values (same normalized value across different testperson/variable combinations)
     *
     * Uses the response matching settings (ignore case, ignore whitespace) for normalization.
     */
  async getResponseAnalysis(workspaceId: number): Promise<ResponseAnalysisDto> {
    try {
      this.logger.log(
        `Starting response analysis for workspace ${workspaceId}`
      );

      // Get response matching flags from settings
      const matchingFlags = await this.codingJobService.getResponseMatchingMode(
        workspaceId
      );
      this.logger.log(
        `Response matching flags: ${JSON.stringify(matchingFlags)}`
      );

      // Get all persons in the workspace that should be considered
      const persons = await this.personsRepository.find({
        where: { workspace_id: workspaceId, consider: true }
      });

      if (persons.length === 0) {
        this.logger.warn(`No persons found for workspace ${workspaceId}`);
        return this.createEmptyAnalysisResult(matchingFlags);
      }

      const personIds = persons.map(person => person.id);
      const personMap = new Map(persons.map(person => [person.id, person]));

      // Get all booklets for these persons
      const booklets = await this.bookletRepository.find({
        where: { personid: In(personIds) },
        relations: ['bookletinfo']
      });

      if (booklets.length === 0) {
        this.logger.warn(
          `No booklets found for persons in workspace ${workspaceId}`
        );
        return this.createEmptyAnalysisResult(matchingFlags);
      }

      const bookletMap = new Map(
        booklets.map(booklet => [booklet.id, booklet])
      );

      // Get all units for these booklets
      const batchSize = 1000;
      let allUnits: Unit[] = [];
      const bookletIds = booklets.map(booklet => booklet.id);

      for (let i = 0; i < bookletIds.length; i += batchSize) {
        const bookletIdsBatch = bookletIds.slice(i, i + batchSize);
        const unitsBatch = await this.unitRepository.find({
          where: { bookletid: In(bookletIdsBatch) }
        });
        allUnits = [...allUnits, ...unitsBatch];
      }

      if (allUnits.length === 0) {
        this.logger.warn(
          `No units found for booklets in workspace ${workspaceId}`
        );
        return this.createEmptyAnalysisResult(matchingFlags);
      }

      const unitIds = allUnits.map(unit => unit.id);
      const unitMap = new Map(allUnits.map(unit => [unit.id, unit]));

      const codingIncompleteStatus = statusStringToNumber('CODING_INCOMPLETE');
      const intendedIncompleteStatus = statusStringToNumber('INTENDED_INCOMPLETE');
      let allResponses: ResponseEntity[] = [];
      for (let i = 0; i < unitIds.length; i += batchSize) {
        const unitIdsBatch = unitIds.slice(i, i + batchSize);
        const responsesBatch = await this.responseRepository.find({
          where: {
            unitid: In(unitIdsBatch),
            status_v1: In([codingIncompleteStatus, intendedIncompleteStatus])
          }
        });
        allResponses = [...allResponses, ...responsesBatch];
      }

      if (allResponses.length === 0) {
        this.logger.warn(
          `No manual coding responses (CODING_INCOMPLETE) found for units in workspace ${workspaceId}`
        );
        return this.createEmptyAnalysisResult(matchingFlags);
      }

      this.logger.log(
        `Found ${allResponses.length} responses requiring manual coding in workspace ${workspaceId}`
      );

      // Check if aggregation is already applied (marked by code_v2 = -111)
      const isAggregationApplied = await this.responseRepository
        .createQueryBuilder('response')
        .leftJoin('response.unit', 'unit')
        .leftJoin('unit.booklet', 'booklet')
        .leftJoin('booklet.person', 'person')
        .where('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('response.code_v2 = :aggregatedCode', { aggregatedCode: -111 })
        .getCount() > 0;

      // Analyze empty responses
      const emptyResponses: EmptyResponseDto[] = [];
      for (const response of allResponses) {
        const isEmptyValue =
          response.value === null ||
          response.value === '' ||
          response.value === '[]' ||
          response.value === undefined;

        // Skip if already coded in v2 (status_v2 is set)
        if (isEmptyValue && response.status_v2 === null) {
          const unit = unitMap.get(response.unitid);
          if (!unit) continue;

          const booklet = bookletMap.get(unit.bookletid);
          if (!booklet) continue;

          const person = personMap.get(booklet.personid);
          if (!person) continue;

          emptyResponses.push({
            unitName: unit.name,
            unitAlias: unit.alias || null,
            variableId: response.variableid,
            personLogin: person.login,
            personCode: person.code || '',
            bookletName: booklet.bookletinfo?.name || 'Unknown',
            responseId: response.id
          });
        }
      }

      // Sort empty responses
      emptyResponses.sort((a, b) => {
        if (a.unitName !== b.unitName) return a.unitName.localeCompare(b.unitName);
        if (a.variableId !== b.variableId) return a.variableId.localeCompare(b.variableId);
        return a.personLogin.localeCompare(b.personLogin);
      });

      // Analyze duplicate values (group by unit+variable, then by normalized value)
      const duplicateValueGroups: DuplicateValueGroupDto[] = [];

      // Group responses by unit+variable
      const responsesByUnitVariable = new Map<string, ResponseEntity[]>();
      for (const response of allResponses) {
        // Skip empty responses for duplicate analysis
        if (
          response.value === null ||
          response.value === '' ||
          response.value === '[]' ||
          response.value === undefined
        ) {
          continue;
        }

        const unit = unitMap.get(response.unitid);
        const key = unit ?
          `${unit.name}_${response.variableid}` :
          `${response.unitid}_${response.variableid}`;
        if (!responsesByUnitVariable.has(key)) {
          responsesByUnitVariable.set(key, []);
        }
        responsesByUnitVariable.get(key)!.push(response);
      }
      // For each unit+variable group, find duplicate values
      for (const [, responses] of responsesByUnitVariable.entries()) {
        if (responses.length < 2) continue;

        // Group by normalized value
        const valueGroups = new Map<string, ResponseEntity[]>();
        for (const response of responses) {
          const normalizedValue = this.codingJobService.normalizeValue(
            response.value,
            matchingFlags
          );
          if (!valueGroups.has(normalizedValue)) {
            valueGroups.set(normalizedValue, []);
          }
          valueGroups.get(normalizedValue)!.push(response);
        }

        // Find groups with more than one response (duplicates)
        for (const [normalizedValue, groupResponses] of valueGroups.entries()) {
          if (groupResponses.length < 2) continue;

          const firstResponse = groupResponses[0];
          const unit = unitMap.get(firstResponse.unitid);
          if (!unit) continue;

          const occurrences = groupResponses.map(response => {
            const responseUnit = unitMap.get(response.unitid);
            const booklet = responseUnit ?
              bookletMap.get(responseUnit.bookletid) :
              null;
            const person = booklet ? personMap.get(booklet.personid) : null;

            return {
              personLogin: person?.login || 'Unknown',
              personCode: person?.code || '',
              bookletName: booklet?.bookletinfo?.name || 'Unknown',
              responseId: response.id,
              value: response.value || ''
            };
          });

          duplicateValueGroups.push({
            unitName: unit.name,
            unitAlias: unit.alias || null,
            variableId: firstResponse.variableid,
            normalizedValue,
            originalValue: firstResponse.value || '',
            occurrences
          });
        }
      }

      // Sort duplicate groups
      duplicateValueGroups.sort((a, b) => {
        if (a.unitName !== b.unitName) return a.unitName.localeCompare(b.unitName);
        return a.variableId.localeCompare(b.variableId);
      });

      const totalDuplicateResponses = duplicateValueGroups.reduce(
        (sum, group) => sum + group.occurrences.length,
        0
      );

      this.logger.log(
        `Response analysis complete: ${emptyResponses.length} empty responses, ${duplicateValueGroups.length} duplicate value groups (${totalDuplicateResponses} total responses)`
      );

      const result: ResponseAnalysisDto = {
        emptyResponses: {
          total: emptyResponses.length,
          items: emptyResponses
        },
        duplicateValues: {
          total: duplicateValueGroups.length,
          totalResponses: totalDuplicateResponses,
          groups: duplicateValueGroups,
          isAggregationApplied

        },
        matchingFlags,
        analysisTimestamp: new Date().toISOString()
      };

      return result;
    } catch (error) {
      this.logger.error(
        `Error analyzing responses for workspace ${workspaceId}: ${error.message}`,
        error.stack
      );
      throw new Error(`Failed to analyze responses: ${error.message}`);
    }
  }

  /**
   * Apply aggregation to duplicate responses based on threshold
   * For each duplicate group meeting the threshold, one response is kept as the "master"
   * and others are marked by setting their status_v2 to CODING_COMPLETE with a special code
   */
  async applyDuplicateAggregation(
    workspaceId: number,
    threshold: number,
    aggregateMode: boolean
  ): Promise<{
      success: boolean;
      aggregatedGroups: number;
      aggregatedResponses: number;
      uniqueCodingCases: number;
      message: string;
    }> {
    this.logger.log(
      `Applying duplicate aggregation for workspace ${workspaceId} with threshold ${threshold}, mode: ${aggregateMode}`
    );

    if (!aggregateMode) {
      // Revert aggregation: Reset all responses with code_v2 = -99 to NULL
      this.logger.log(`Reverting duplicate aggregation for workspace ${workspaceId}`);

      // Better approach for safe update across relations:
      // 1. Find IDs of aggregated responses in workspace
      // 2. Update by IDs

      const aggregatedResponses = await this.responseRepository
        .createQueryBuilder('response')
        .select('response.id')
        .leftJoin('response.unit', 'unit')
        .leftJoin('unit.booklet', 'booklet')
        .leftJoin('booklet.person', 'person')
        .where('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('response.code_v2 = :aggregatedCode', { aggregatedCode: -111 })
        .getMany();

      if (aggregatedResponses.length === 0) {
        return {
          success: true,
          aggregatedGroups: 0,
          aggregatedResponses: 0,
          uniqueCodingCases: 0,
          message: 'Aggregation deactivated. No aggregated responses found to revert.'
        };
      }

      const responseIds = aggregatedResponses.map(r => r.id);

      // Perform update in chunks if needed, but for now single update
      await this.responseRepository.update(
        { id: In(responseIds) },
        {
          code_v2: null,
          score_v2: null,
          status_v2: null
        }
      );

      // Invalidate cache
      await this.codingValidationService.invalidateIncompleteVariablesCache(workspaceId);

      return {
        success: true,
        aggregatedGroups: 0, // Not relevant for revert
        aggregatedResponses: responseIds.length,
        uniqueCodingCases: 0, // Client will reload stats
        message: `Aggregation deactivated. Reverted ${responseIds.length} aggregated responses.`
      };
    }

    if (threshold < 2) {
      return {
        success: false,
        aggregatedGroups: 0,
        aggregatedResponses: 0,
        uniqueCodingCases: 0,
        message: 'Threshold must be at least 2'
      };
    }

    try {
      // Get the current response analysis
      const analysis = await this.getResponseAnalysis(workspaceId);

      // Filter groups that meet the threshold
      const groupsToAggregate = analysis.duplicateValues.groups.filter(
        group => group.occurrences.length >= threshold
      );

      if (groupsToAggregate.length === 0) {
        return {
          success: true,
          aggregatedGroups: 0,
          aggregatedResponses: 0,
          uniqueCodingCases: analysis.duplicateValues.totalResponses,
          message: `No duplicate groups meet the threshold of ${threshold}`
        };
      }

      this.logger.log(
        `Found ${groupsToAggregate.length} duplicate groups meeting threshold ${threshold}`
      );

      // Start transaction
      const queryRunner = this.responseRepository.manager.connection.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction('READ COMMITTED');

      try {
        let totalAggregatedResponses = 0;

        // For each group, keep the first response as master and mark others as aggregated
        for (const group of groupsToAggregate) {
          // Sort occurrences by responseId to ensure consistent master selection
          const sortedOccurrences = [...group.occurrences].sort(
            (a, b) => a.responseId - b.responseId
          );

          // First response is the master, rest are aggregated
          const masterResponseId = sortedOccurrences[0].responseId;
          const responsesToAggregate = sortedOccurrences.slice(1);

          this.logger.log(
            `Group ${group.unitName}/${group.variableId}/${group.normalizedValue}: ` +
            `Master: ${masterResponseId}, Aggregating: ${responsesToAggregate.length} responses`
          );

          // Update aggregated responses
          // Use code_v2 = -99 to indicate this is an aggregated duplicate
          // Use status_v2 = CODING_COMPLETE to mark it as processed
          const updatePromises = responsesToAggregate.map(occurrence => queryRunner.manager.update(
            ResponseEntity,
            occurrence.responseId,
            {
              code_v2: -111, // Special code for aggregated duplicates
              score_v2: 0,
              status_v2: statusStringToNumber('CODING_COMPLETE')
            }
          )
          );

          await Promise.all(updatePromises);
          totalAggregatedResponses += responsesToAggregate.length;
        }

        await queryRunner.commitTransaction();

        // Save threshold as workspace setting
        await this.codingJobService.setAggregationThreshold(workspaceId, threshold);

        // Calculate unique coding cases after aggregation
        const uniqueCodingCases = analysis.duplicateValues.totalResponses - totalAggregatedResponses;

        this.logger.log(
          `Successfully aggregated ${totalAggregatedResponses} responses in ${groupsToAggregate.length} groups`
        );

        // Invalidate the cache for incomplete variables so UI reflects the aggregation immediately
        await this.codingValidationService.invalidateIncompleteVariablesCache(workspaceId);

        return {
          success: true,
          aggregatedGroups: groupsToAggregate.length,
          aggregatedResponses: totalAggregatedResponses,
          uniqueCodingCases,
          message: `Successfully aggregated ${totalAggregatedResponses} responses in ${groupsToAggregate.length} groups`
        };
      } catch (error) {
        await queryRunner.rollbackTransaction();
        this.logger.error(
          `Error aggregating duplicate responses: ${error.message}`,
          error.stack
        );
        throw new Error(
          `Failed to aggregate duplicate responses: ${error.message}`
        );
      } finally {
        await queryRunner.release();
      }
    } catch (error) {
      this.logger.error(
        `Error in applyDuplicateAggregation: ${error.message}`,
        error.stack
      );
      return {
        success: false,
        aggregatedGroups: 0,
        aggregatedResponses: 0,
        uniqueCodingCases: 0,
        message: `Error: ${error.message}`
      };
    }
  }

  createEmptyAnalysisResult(
    matchingFlags: string[]
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
        isAggregationApplied: !matchingFlags.includes('NO_AGGREGATION')
      },
      matchingFlags,
      analysisTimestamp: new Date().toISOString()
    };

    return result;
  }
}
