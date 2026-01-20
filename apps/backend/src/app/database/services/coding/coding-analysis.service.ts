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
    private codingJobService: CodingJobService
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

      // Get all responses for these units that require manual coding (CODING_INCOMPLETE status)
      const codingIncompleteStatus = statusStringToNumber('CODING_INCOMPLETE');
      let allResponses: ResponseEntity[] = [];
      for (let i = 0; i < unitIds.length; i += batchSize) {
        const unitIdsBatch = unitIds.slice(i, i + batchSize);
        const responsesBatch = await this.responseRepository.find({
          where: {
            unitid: In(unitIdsBatch),
            status_v1: codingIncompleteStatus
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

      // Analyze empty responses
      const emptyResponses: EmptyResponseDto[] = [];
      for (const response of allResponses) {
        const isEmptyValue =
                    response.value === null ||
                    response.value === '' ||
                    response.value === undefined;
        if (isEmptyValue) {
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

      return {
        emptyResponses: {
          total: emptyResponses.length,
          items: emptyResponses
        },
        duplicateValues: {
          total: duplicateValueGroups.length,
          totalResponses: totalDuplicateResponses,
          groups: duplicateValueGroups
        },
        matchingFlags,
        analysisTimestamp: new Date().toISOString()
      };
    } catch (error) {
      this.logger.error(
        `Error analyzing responses for workspace ${workspaceId}: ${error.message}`,
        error.stack
      );
      throw new Error(`Failed to analyze responses: ${error.message}`);
    }
  }

  createEmptyAnalysisResult(
    matchingFlags: string[]
  ): ResponseAnalysisDto {
    return {
      emptyResponses: {
        total: 0,
        items: []
      },
      duplicateValues: {
        total: 0,
        totalResponses: 0,
        groups: []
      },
      matchingFlags,
      analysisTimestamp: new Date().toISOString()
    };
  }
}
