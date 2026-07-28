import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, SelectQueryBuilder } from 'typeorm';
import { ResponseEntity } from '../../entities/response.entity';
import { STATISTICS_IGNORED_STATUSES } from '../../utils/response-status-converter';
import {
  applyResolvedExclusionsToQuery,
  ResolvedWorkspaceExclusions,
  WorkspaceExclusionService
} from '../workspace/workspace-exclusion.service';
import {
  PsychometricRawResponseRow,
  PsychometricResponseReaderInput,
  PsychometricResponseSnapshot
} from './psychometric-export.types';

const NORMALIZED_PSYCHOMETRIC_UNIT_SQL =
  'TRIM(REGEXP_REPLACE(' +
  "REGEXP_REPLACE(UPPER(TRIM(unit.name)), '^.*[\\\\/]', ''), " +
  "'\\.(VOMD|VOCS|XML)$', ''))";
const PSYCHOMETRIC_LOGICAL_KEY_SQL =
  `CONCAT(${NORMALIZED_PSYCHOMETRIC_UNIT_SQL}, CHR(31), ` +
  'UPPER(TRIM(response.variableid)))';
const PSYCHOMETRIC_CANONICAL_MAPPING_SQL =
  '(SELECT * FROM jsonb_each_text(' +
  'CAST(:psychometricCanonicalItemMapping AS jsonb)))';

@Injectable()
export class PsychometricResponseReader {
  private readonly logger = new Logger(PsychometricResponseReader.name);
  private readonly responseBatchSize = 5000;

  constructor(
    private readonly workspaceExclusionService: WorkspaceExclusionService,
    @InjectDataSource()
    private readonly connection: DataSource
  ) {}

  async withSnapshot<T>(
    input: PsychometricResponseReaderInput,
    callback: (snapshot: PsychometricResponseSnapshot) => Promise<T>,
    checkCancellation?: () => Promise<void>
  ): Promise<T> {
    const exclusions =
      await this.workspaceExclusionService.resolveExclusionsForQueries(
        input.workspaceId
      );
    const queryRunner = this.connection.createQueryRunner();

    try {
      await queryRunner.connect();
      await queryRunner.startTransaction('REPEATABLE READ');
      await queryRunner.query('SET TRANSACTION READ ONLY');
      const duplicatePersonIds = await this.getDuplicatePersonIds(
        input,
        queryRunner.manager,
        exclusions,
        checkCancellation
      );
      const totalRows = await this.countResponseRows(
        input,
        queryRunner.manager,
        exclusions
      );
      const snapshot: PsychometricResponseSnapshot = {
        duplicatePersonIds,
        totalRows,
        forEachBatch: (batchCallback, cancellationCallback) => this.forEachResponseBatch(
          input,
          queryRunner.manager,
          exclusions,
          batchCallback,
          cancellationCallback
        )
      };
      const result = await callback(snapshot);
      await queryRunner.commitTransaction();
      return result;
    } catch (error) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }
      throw error;
    } finally {
      if (!queryRunner.isReleased) {
        await queryRunner.release();
      }
    }
  }

  private async getDuplicatePersonIds(
    input: PsychometricResponseReaderInput,
    manager: EntityManager,
    exclusions: ResolvedWorkspaceExclusions,
    checkCancellation?: () => Promise<void>
  ): Promise<Set<number>> {
    await checkCancellation?.();
    const query = this.createResponseQuery(input, manager, exclusions);
    const canonicalItemMapping = Object.fromEntries(
      Array.from(
        input.mapping.byLogicalKey,
        ([logicalKey, item]) => [logicalKey, item.key]
      )
    );
    const rows = await query
      .innerJoin(
        PSYCHOMETRIC_CANONICAL_MAPPING_SQL,
        'psychometric_mapping',
        `psychometric_mapping.key = ${PSYCHOMETRIC_LOGICAL_KEY_SQL}`,
        {
          psychometricCanonicalItemMapping:
            JSON.stringify(canonicalItemMapping)
        }
      )
      .select('person.id', 'personId')
      .addSelect('psychometric_mapping.value', 'itemKey')
      .groupBy('person.id')
      .addGroupBy('psychometric_mapping.value')
      .having('COUNT(*) > 1')
      .getRawMany<{
      personId: number | string;
      itemKey: string;
    }>();
    await checkCancellation?.();
    return new Set(rows.map(row => Number(row.personId)));
  }

  private async countResponseRows(
    input: PsychometricResponseReaderInput,
    manager: EntityManager,
    exclusions: ResolvedWorkspaceExclusions
  ): Promise<number> {
    const query = this.createResponseQuery(input, manager, exclusions);
    return query.getCount();
  }

  private async forEachResponseBatch(
    input: PsychometricResponseReaderInput,
    manager: EntityManager,
    exclusions: ResolvedWorkspaceExclusions,
    callback: (
      rows: PsychometricRawResponseRow[],
      processedRows: number
    ) => Promise<void>,
    checkCancellation?: () => Promise<void>
  ): Promise<void> {
    let lastResponseId = 0;
    let processedRows = 0;
    let hasMoreRows = true;

    while (hasMoreRows) {
      await checkCancellation?.();
      const query = this.createResponseQuery(input, manager, exclusions);
      const versionColumns = {
        v1: {
          code: 'response.code_v1',
          score: 'response.score_v1'
        },
        v2: {
          code: 'response.code_v2',
          score: 'response.score_v2'
        },
        v3: {
          code: 'response.code_v3',
          score: 'response.score_v3'
        }
      }[input.version];
      const rows = await query
        .select('response.id', 'responseId')
        .addSelect('person.id', 'personId')
        .addSelect('unit.name', 'unitName')
        .addSelect('response.variableid', 'variableId')
        .addSelect('response.value', 'value')
        .addSelect(versionColumns.code, 'code')
        .addSelect(versionColumns.score, 'score')
        .andWhere('response.id > :lastResponseId', { lastResponseId })
        .orderBy('response.id', 'ASC')
        .limit(this.responseBatchSize)
        .getRawMany<PsychometricRawResponseRow>();
      if (rows.length === 0) {
        hasMoreRows = false;
        continue;
      }

      processedRows += rows.length;
      await callback(rows, processedRows);
      lastResponseId = Number(rows[rows.length - 1].responseId);
      if (rows.length < this.responseBatchSize) {
        break;
      }
    }

    this.logger.debug(
      `Read ${processedRows} response rows for psychometric ${input.version} export`
    );
  }

  private createResponseQuery(
    input: PsychometricResponseReaderInput,
    manager: EntityManager,
    exclusions: ResolvedWorkspaceExclusions
  ): SelectQueryBuilder<ResponseEntity> {
    const query = manager
      .getRepository(ResponseEntity)
      .createQueryBuilder('response')
      .innerJoin('response.unit', 'unit')
      .innerJoin('unit.booklet', 'booklet')
      .innerJoin('booklet.person', 'person')
      .innerJoin('booklet.bookletinfo', 'bookletinfo')
      .where('person.workspace_id = :workspaceId', {
        workspaceId: input.workspaceId
      })
      .andWhere('person.consider = :consider', { consider: true })
      .andWhere(`response.status_${input.version} IS NOT NULL`)
      .andWhere(
        `response.status_${input.version} NOT IN (:...psychometricIgnoredStatuses)`,
        { psychometricIgnoredStatuses: STATISTICS_IGNORED_STATUSES }
      );
    this.applyVariablePairFilter(
      query,
      Array.from(input.mapping.byLogicalKey.keys())
    );
    applyResolvedExclusionsToQuery(query, exclusions);
    return query;
  }

  private applyVariablePairFilter(
    query: SelectQueryBuilder<ResponseEntity>,
    variablePairKeys: string[]
  ): void {
    if (variablePairKeys.length === 0) {
      query.andWhere('1 = 0');
      return;
    }
    query.andWhere(
      `${PSYCHOMETRIC_LOGICAL_KEY_SQL} IN ` +
        '(:...psychometricVariablePairKeys)',
      { psychometricVariablePairKeys: variablePairKeys }
    );
  }
}
