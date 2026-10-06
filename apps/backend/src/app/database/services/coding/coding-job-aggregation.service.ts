import { Injectable, Logger, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { CodingJob } from '../../entities/coding-job.entity';
import { ResponseEntity } from '../../entities/response.entity';
import { Setting } from '../../entities/setting.entity';
import { DERIVED_VARIABLE_READER, DerivedVariableReader } from '../workspace/derived-variable-reader.token';
import {
  buildAggregationGroups, deduplicateManualCodingResponses, getManualCodingDeduplicationKey, ManualCodingDeduplicationResponse
} from './aggregation-metrics.util';
import { ResponseMatchingFlag, SlimResponse, CodingJobAggregationSettings } from './coding-job.types';

@Injectable()
export class CodingJobAggregationService {
  private readonly logger = new Logger(CodingJobAggregationService.name);

  constructor(
    @InjectRepository(Setting)
    private readonly settingRepository: Repository<Setting>,
    @Inject(DERIVED_VARIABLE_READER) private readonly derivedVariableReader: DerivedVariableReader
  ) {}

  async getCurrentAggregationSettingsSnapshot(
    workspaceId: number,
    manager?: EntityManager
  ): Promise<CodingJobAggregationSettings> {
    const [aggregationThreshold, responseMatchingFlags] = await Promise.all([
      this.getAggregationThreshold(workspaceId, manager),
      this.getResponseMatchingMode(workspaceId, manager)
    ]);
    const aggregationEnabled =
      aggregationThreshold !== null &&
      !responseMatchingFlags.includes(ResponseMatchingFlag.NO_AGGREGATION);

    return {
      aggregationEnabled,
      aggregationThreshold,
      responseMatchingFlags,
      aggregationSettingsVersion: 1,
      fromJobSnapshot: false
    };
  }

  async getAggregationSettingsForCodingJob(
    codingJob: CodingJob,
    manager?: EntityManager
  ): Promise<CodingJobAggregationSettings> {
    if (
      codingJob.aggregation_settings_version !== null &&
      codingJob.aggregation_settings_version !== undefined
    ) {
      const responseMatchingFlags = this.normalizeResponseMatchingFlags(
        codingJob.response_matching_flags as
          | ResponseMatchingFlag[]
          | undefined
          | null
      );
      const aggregationThreshold = codingJob.aggregation_enabled ?
        codingJob.aggregation_threshold :
        null;

      return {
        aggregationEnabled:
          codingJob.aggregation_enabled &&
          aggregationThreshold !== null &&
          !responseMatchingFlags.includes(ResponseMatchingFlag.NO_AGGREGATION),
        aggregationThreshold,
        responseMatchingFlags: codingJob.aggregation_enabled ?
          responseMatchingFlags :
          [ResponseMatchingFlag.NO_AGGREGATION],
        aggregationSettingsVersion: codingJob.aggregation_settings_version,
        fromJobSnapshot: true
      };
    }

    return this.getCurrentAggregationSettingsSnapshot(
      codingJob.workspace_id,
      manager
    );
  }

  async getDerivedVariableMapForAggregation(
    workspaceId: number,
    manager?: EntityManager
  ): Promise<Map<string, Set<string>>> {
    const derivedVariableMap =
      await this.derivedVariableReader.getDerivedVariableMap(
        workspaceId,
        manager
      );
    const derivedVariableSets = new Map<string, Set<string>>();
    derivedVariableMap.forEach((vars, unitNameKey) => {
      derivedVariableSets.set(unitNameKey.toUpperCase(), vars);
    });
    return derivedVariableSets;
  }

  async getResponseMatchingMode(
    workspaceId: number,
    manager?: EntityManager
  ): Promise<ResponseMatchingFlag[]> {
    const settingKey = `workspace-${workspaceId}-response-matching-mode`;
    const repository = manager ?
      manager.getRepository(Setting) :
      this.settingRepository;
    const [setting, aggregationThreshold] = await Promise.all([
      repository.findOne({ where: { key: settingKey } }),
      this.getAggregationThreshold(workspaceId, manager)
    ]);

    let flags: ResponseMatchingFlag[] = [];
    if (setting) {
      try {
        const parsed = JSON.parse(setting.content);
        flags = this.normalizeResponseMatchingFlags(parsed.flags);
      } catch {
        flags = [];
      }
    }

    if (aggregationThreshold === null) {
      return [ResponseMatchingFlag.NO_AGGREGATION];
    }

    return flags;
  }

  async setResponseMatchingMode(
    workspaceId: number,
    flags: ResponseMatchingFlag[],
    manager?: EntityManager
  ): Promise<ResponseMatchingFlag[]> {
    const normalizedFlags = this.normalizeResponseMatchingFlags(flags);
    const settingRepository = manager?.getRepository(Setting) ??
      this.settingRepository;
    await settingRepository.save({
      key: `workspace-${workspaceId}-response-matching-mode`,
      content: JSON.stringify({ flags: normalizedFlags })
    });

    this.logger.log(
      `Set response matching mode for workspace ${workspaceId}: ${normalizedFlags.join(', ')}`
    );
    return normalizedFlags;
  }

  normalizeResponseMatchingFlags(
    flags: ResponseMatchingFlag[] | undefined | null
  ): ResponseMatchingFlag[] {
    const allowedFlags = new Set(Object.values(ResponseMatchingFlag));
    const normalizedFlags = Array.from(new Set(flags ?? [])).filter(
      (flag): flag is ResponseMatchingFlag => allowedFlags.has(flag)
    );

    if (normalizedFlags.includes(ResponseMatchingFlag.NO_AGGREGATION)) {
      return [ResponseMatchingFlag.NO_AGGREGATION];
    }

    return normalizedFlags;
  }

  normalizeValue(value: string | null, flags: ResponseMatchingFlag[]): string {
    if (value === null || value === undefined) {
      return '';
    }

    let normalized = value;

    if (flags.includes(ResponseMatchingFlag.IGNORE_CASE)) {
      normalized = normalized.toLowerCase();
    }

    if (flags.includes(ResponseMatchingFlag.IGNORE_WHITESPACE)) {
      normalized = normalized.replace(/\s+/g, '');
    }

    return normalized;
  }

  aggregateResponsesByValue(
    responses: SlimResponse[],
    flags: ResponseMatchingFlag[]
  ): {
      normalizedValue: string;
      responses: SlimResponse[];
      totalResponses: number;
    }[] {
    if (flags.includes(ResponseMatchingFlag.NO_AGGREGATION)) {
      return responses.map(r => ({
        normalizedValue: r.value || '',
        responses: [r],
        totalResponses: 1
      }));
    }

    const groups = new Map<string, SlimResponse[]>();

    for (const response of responses) {
      const normalizedValue = this.normalizeValue(response.value, flags);
      const existing = groups.get(normalizedValue) || [];
      existing.push(response);
      groups.set(normalizedValue, existing);
    }

    return Array.from(groups.entries()).map(
      ([normalizedValue, groupResponses]) => ({
        normalizedValue,
        responses: groupResponses,
        totalResponses: groupResponses.length
      })
    );
  }

  aggregateResponsesByVariableAndValue(
    responses: SlimResponse[],
    flags: ResponseMatchingFlag[],
    threshold: number | null,
    isDerivedResponse: (response: SlimResponse) => boolean
  ): {
      normalizedValue: string;
      responses: SlimResponse[];
      totalResponses: number;
    }[] {
    const derivedVariableMap = new Map<string, Set<string>>();
    responses.forEach(response => {
      if (!isDerivedResponse(response)) {
        return;
      }

      const unitKey = response.unitName.toUpperCase();
      const derivedVariables =
        derivedVariableMap.get(unitKey) || new Set<string>();
      derivedVariables.add(response.variableid);
      derivedVariableMap.set(unitKey, derivedVariables);
    });

    return buildAggregationGroups(
      this.withManualCodingDeduplicationFields(responses),
      flags,
      threshold,
      derivedVariableMap
    ).map(group => ({
      normalizedValue: group.key,
      responses: group.responses,
      totalResponses: group.responses.length
    }));
  }

  withManualCodingDeduplicationFields(
    responses: SlimResponse[]
  ): Array<SlimResponse & ManualCodingDeduplicationResponse> {
    return responses.map(response => ({
      ...response,
      responseId: response.id,
      variableId: response.variableid
    }));
  }

  deduplicateSlimResponsesForManualCoding(
    responses: SlimResponse[],
    assignedResponseIds: Set<number>
  ): {
      responses: SlimResponse[];
      assignedResponseIds: Set<number>;
    } {
    const responsesWithCaseFields =
      this.withManualCodingDeduplicationFields(responses);
    const assignedDeduplicationKeys = new Set(
      responsesWithCaseFields
        .filter(response => assignedResponseIds.has(response.responseId))
        .map(response => getManualCodingDeduplicationKey(response))
    );
    const dedupedResponses =
      deduplicateManualCodingResponses(responsesWithCaseFields);
    const assignedDedupedResponseIds = new Set(
      dedupedResponses
        .filter(response => (
          assignedResponseIds.has(response.responseId) ||
          assignedDeduplicationKeys.has(getManualCodingDeduplicationKey(response))
        ))
        .map(response => response.responseId)
    );

    return {
      responses: dedupedResponses,
      assignedResponseIds: assignedDedupedResponseIds
    };
  }

  async filterSlimResponsesForAggregation(
    workspaceId: number,
    responses: SlimResponse[],
    aggregationThreshold: number,
    matchingFlags: ResponseMatchingFlag[]
  ): Promise<SlimResponse[]> {
    const derivedVariableMap =
      await this.getDerivedVariableMapForAggregation(workspaceId);
    const dedupedResponses = this.deduplicateSlimResponsesForManualCoding(
      responses,
      new Set()
    ).responses;
    const groups = buildAggregationGroups(
      this.withManualCodingDeduplicationFields(dedupedResponses),
      matchingFlags,
      aggregationThreshold,
      derivedVariableMap
    );
    const filteredResponses: SlimResponse[] = [];

    for (const group of groups) {
      if (group.responses.length >= aggregationThreshold) {
        group.responses.sort((a, b) => a.id - b.id);
        filteredResponses.push(group.responses[0]);
      } else {
        filteredResponses.push(...group.responses);
      }
    }

    return filteredResponses;
  }

  /**
   * Get the duplicate aggregation threshold for a workspace
   * Returns 2 as default (aggregation enabled by default)
   */
  async getAggregationThreshold(
    workspaceId: number,
    manager?: EntityManager
  ): Promise<number | null> {
    const settingKey = `workspace-${workspaceId}-duplicate-aggregation-threshold`;
    const repository = manager ?
      manager.getRepository(Setting) :
      this.settingRepository;
    const setting = await repository.findOne({
      where: { key: settingKey }
    });

    if (!setting) {
      // Default: threshold = 2 (aggregation enabled)
      return 2;
    }

    // Allow explicit disable by setting to 'disabled' or '0'
    if (setting.content === 'disabled' || setting.content === '0') {
      return null;
    }

    const threshold = parseInt(setting.content, 10);
    if (Number.isNaN(threshold)) {
      return 2;
    }

    return Math.min(100, Math.max(2, threshold));
  }

  /**
   * Set the duplicate aggregation threshold for a workspace
   */
  async setAggregationThreshold(
    workspaceId: number,
    threshold: number | null,
    manager?: EntityManager
  ): Promise<void> {
    const settingKey = `workspace-${workspaceId}-duplicate-aggregation-threshold`;
    const settingRepository = manager?.getRepository(Setting) ??
      this.settingRepository;

    if (threshold === null) {
      // Explicitly disable aggregation
      await settingRepository.save({
        key: settingKey,
        content: 'disabled'
      });
    } else {
      await settingRepository.save({
        key: settingKey,
        content: threshold.toString()
      });
    }

    this.logger.log(
      `Set aggregation threshold for workspace ${workspaceId}: ${threshold}`
    );
  }

  /**
   * Filter responses to include only one representative per duplicate group
   * Groups responses by unit+variable+normalized_value and keeps only the first
   */
  async filterResponsesForAggregation(
    responses: ResponseEntity[],
    threshold: number,
    workspaceId: number
  ): Promise<ResponseEntity[]> {
    const matchingFlags = await this.getResponseMatchingMode(workspaceId);

    // Group responses by unit+variable+normalized_value
    const groupMap = new Map<string, ResponseEntity[]>();

    for (const response of responses) {
      const unit = response.unit;
      if (!unit) continue;

      if (!response.value || response.value === '') continue;

      const normalizedValue = this.normalizeValue(
        response.value,
        matchingFlags
      );
      const key = `${unit.name}_${response.variableid}_${normalizedValue}`;

      if (!groupMap.has(key)) {
        groupMap.set(key, []);
      }
      groupMap.get(key)!.push(response);
    }

    // For each group, keep only first response if group size >= threshold
    const filteredResponses: ResponseEntity[] = [];

    for (const [key, group] of groupMap.entries()) {
      if (group.length >= threshold) {
        group.sort((a, b) => a.id - b.id);
        filteredResponses.push(group[0]);

        this.logger.debug(
          `Group ${key}: ${group.length} duplicates, keeping master ${group[0].id}`
        );
      } else {
        filteredResponses.push(...group);
      }
    }

    return filteredResponses;
  }
}
