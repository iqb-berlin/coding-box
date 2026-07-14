import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Brackets,
  EntityManager,
  Repository,
  SelectQueryBuilder
} from 'typeorm';
import { ResponseEntity } from '../../entities/response.entity';
import { statusStringToNumber } from '../../utils/response-status-converter';
import {
  DERIVE_ERROR_STATUS,
  getDeriveErrorManualCodingPairKeys,
  ManualCodingVariableReference,
  MANUAL_CODING_DEFAULT_CANDIDATE_STATUSES
} from '../../utils/manual-coding-candidate.util';
import {
  applyResolvedExclusionsToQuery,
  ResolvedWorkspaceExclusions
} from '../workspace/workspace-exclusion-query.util';
import {
  AggregationMatchingFlag,
  AggregationSourceResponse,
  buildAggregationPeerKeys,
  buildAggregationPeerLookupKeys,
  getAggregationPeerKey,
  isAggregatableValue,
  serializeAggregationPeerKey
} from './aggregation-metrics.util';
import { getNonCodingIssueReviewJobSqlCondition } from './coding-job-type.util';

export interface CompletedAggregationPeer {
  responseId: number;
  variableId: string;
  value: string | null;
  statusV1: number | null;
  statusV2: number | null;
  codeV2: number | null;
  unitName: string;
  unitAlias: string | null;
  bookletName: string;
  personLogin: string;
  personCode: string;
  personGroup: string;
}

export interface FindCompletedAggregationPeersOptions {
  workspaceId: number;
  sourceResponses: readonly AggregationSourceResponse[];
  matchingFlags: readonly AggregationMatchingFlag[];
  derivedVariableMap: Map<string, Set<string>>;
  variables?: ManualCodingVariableReference[];
  manager?: EntityManager;
  loadQueryContext: () => Promise<{
    defaultMirCode: number;
    exclusions: ResolvedWorkspaceExclusions;
  }>;
}

@Injectable()
export class CodingAggregationPeerService {
  constructor(
    @InjectRepository(ResponseEntity)
    private readonly responseRepository: Repository<ResponseEntity>
  ) {}

  async findCompletedPeers(
    options: FindCompletedAggregationPeersOptions
  ): Promise<CompletedAggregationPeer[]> {
    const peerKeys = buildAggregationPeerKeys(
      [...options.sourceResponses],
      options.matchingFlags,
      options.derivedVariableMap
    );
    if (peerKeys.length === 0) {
      return [];
    }

    const { defaultMirCode, exclusions } = await options.loadQueryContext();
    const peerKeySet = new Set(
      peerKeys.map(peerKey => serializeAggregationPeerKey(peerKey))
    );
    const exactValueMatching =
      !options.matchingFlags.includes('IGNORE_CASE') &&
      !options.matchingFlags.includes('IGNORE_WHITESPACE');
    const responseRepository = options.manager ?
      options.manager.getRepository(ResponseEntity) :
      this.responseRepository;
    const createCompletedPeerQuery = (
      parameterSuffix: string
    ): SelectQueryBuilder<ResponseEntity> => {
      const query = responseRepository
        .createQueryBuilder('response')
        .innerJoin('response.unit', 'unit')
        .innerJoin('unit.booklet', 'booklet')
        .leftJoin('booklet.bookletinfo', 'bookletinfo')
        .innerJoin('booklet.person', 'person')
        .where('person.workspace_id = :workspaceId', {
          workspaceId: options.workspaceId
        })
        .andWhere('person.consider = :consider', { consider: true })
        .andWhere('response.status_v2 = :completedV2Status', {
          completedV2Status: statusStringToNumber('CODING_COMPLETE')
        })
        .andWhere(
          '(response.code_v2 IS NULL OR (response.code_v2 != :aggregatedCode AND response.code_v2 != :defaultMirCode))',
          { aggregatedCode: -111, defaultMirCode }
        )
        .andWhere(new Brackets(qb => {
          qb.where('response.code_v2 IS NULL')
            .orWhere(subQuery => {
              const exists = subQuery
                .subQuery()
                .select('1')
                .from('coding_job_unit', 'manual_cju')
                .innerJoin(
                  'coding_job',
                  'manual_cj',
                  'manual_cj.id = manual_cju.coding_job_id'
                )
                .where('manual_cju.response_id = response.id')
                .andWhere('manual_cj.training_id IS NULL')
                .andWhere(getNonCodingIssueReviewJobSqlCondition('manual_cj'))
                .getQuery();
              return `EXISTS (${exists})`;
            });
        }));
      this.applyManualCodingCandidateStatusFilter(
        query,
        options.variables || []
      );
      applyResolvedExclusionsToQuery(query, exclusions, {
        parameterPrefix: `completedAggregationPeers${parameterSuffix}`
      });
      return query;
    };

    const peerVariables = Array.from(new Map(
      peerKeys.map(peerKey => [
        JSON.stringify([peerKey.unitName, peerKey.variableId]),
        {
          unitName: peerKey.unitName,
          variableId: peerKey.variableId
        }
      ])
    ).values());

    const peerValueQuery = createCompletedPeerQuery('Values')
      .select('DISTINCT unit.name', 'unitName')
      .addSelect('response.variableid', 'variableId')
      .addSelect('response.value', 'value')
      .andWhere(
        `EXISTS (
          SELECT 1
          FROM jsonb_to_recordset(CAST(:aggregationPeerVariables AS jsonb))
            AS aggregation_peer_variable("unitName" text, "variableId" text)
          WHERE aggregation_peer_variable."unitName" = UPPER(unit.name)
            AND aggregation_peer_variable."variableId" = response.variableid
        )`,
        { aggregationPeerVariables: JSON.stringify(peerVariables) }
      );
    if (exactValueMatching) {
      peerValueQuery.andWhere(
        `EXISTS (
          SELECT 1
          FROM jsonb_to_recordset(CAST(:aggregationPeerValues AS jsonb))
            AS aggregation_peer_value("variableId" text, "normalizedValue" text)
          WHERE aggregation_peer_value."variableId" = response.variableid
            AND aggregation_peer_value."normalizedValue" = response.value
        )`,
        { aggregationPeerValues: JSON.stringify(peerKeys) }
      );
    }
    const peerLookupKeys = buildAggregationPeerLookupKeys(
      peerKeys,
      await peerValueQuery.getRawMany(),
      options.matchingFlags
    );
    if (peerLookupKeys.length === 0) {
      return [];
    }

    const query = createCompletedPeerQuery('Peers')
      .select('response.id', 'responseId')
      .addSelect('response.variableid', 'variableId')
      .addSelect('response.value', 'value')
      .addSelect('response.status_v1', 'statusV1')
      .addSelect('response.status_v2', 'statusV2')
      .addSelect('response.code_v2', 'codeV2')
      .addSelect('unit.name', 'unitName')
      .addSelect('unit.alias', 'unitAlias')
      .addSelect("COALESCE(bookletinfo.name, '')", 'bookletName')
      .addSelect("COALESCE(person.login, '')", 'personLogin')
      .addSelect("COALESCE(person.code, '')", 'personCode')
      .addSelect("COALESCE(person.group, '')", 'personGroup')
      .andWhere(
        `EXISTS (
          SELECT 1
          FROM jsonb_to_recordset(CAST(:aggregationPeerKeys AS jsonb))
            AS aggregation_peer("unitName" text, "variableId" text, "value" text)
          WHERE aggregation_peer."unitName" = unit.name
            AND aggregation_peer."variableId" = response.variableid
            AND aggregation_peer."value" = response.value
        )`,
        { aggregationPeerKeys: JSON.stringify(peerLookupKeys) }
      )
      .orderBy('response.id', 'ASC');
    const raw = await query.getRawMany();

    return raw.map(row => ({
      responseId: Number(row.responseId ?? row.id),
      variableId: row.variableId ?? row.variableid,
      value: row.value ?? null,
      statusV1: this.toNullableNumber(row.statusV1),
      statusV2: this.toNullableNumber(row.statusV2),
      codeV2: this.toNullableNumber(row.codeV2),
      unitName: row.unitName ?? '',
      unitAlias: row.unitAlias ?? null,
      bookletName: row.bookletName ?? '',
      personLogin: row.personLogin ?? '',
      personCode: row.personCode ?? '',
      personGroup: row.personGroup ?? ''
    })).filter(response => (
      isAggregatableValue(response.value) &&
      peerKeySet.has(serializeAggregationPeerKey(getAggregationPeerKey(
        response.unitName,
        response.variableId,
        response.value,
        options.matchingFlags
      )))
    ));
  }

  private applyManualCodingCandidateStatusFilter(
    queryBuilder: SelectQueryBuilder<ResponseEntity>,
    variables: ManualCodingVariableReference[]
  ): void {
    const deriveErrorManualCodingPairKeys =
      getDeriveErrorManualCodingPairKeys(variables);

    if (deriveErrorManualCodingPairKeys.length === 0) {
      queryBuilder.andWhere('response.status_v1 IN (:...statuses)', {
        statuses: MANUAL_CODING_DEFAULT_CANDIDATE_STATUSES
      });
      return;
    }

    queryBuilder.andWhere(new Brackets(qb => {
      qb.where('response.status_v1 IN (:...statuses)', {
        statuses: MANUAL_CODING_DEFAULT_CANDIDATE_STATUSES
      }).orWhere(
        `response.status_v1 = :deriveErrorStatus
        AND CONCAT(UPPER(unit.name), CHR(31), response.variableid) IN (:...deriveErrorManualCodingPairKeys)`,
        {
          deriveErrorStatus: DERIVE_ERROR_STATUS,
          deriveErrorManualCodingPairKeys
        }
      );
    }));
  }

  private toNullableNumber(value: unknown): number | null {
    return value === null || value === undefined ? null : Number(value);
  }
}
