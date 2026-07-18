import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, SelectQueryBuilder } from 'typeorm';
import { PsychometricVersion } from '../../../../../../../api-dto/coding/psychometric-discrimination.dto';
import { ResponseEntity } from '../../entities/response.entity';
import { STATISTICS_IGNORED_STATUSES } from '../../utils/response-status-converter';
import {
  applyResolvedExclusionsToQuery,
  ResolvedWorkspaceExclusions,
  WorkspaceExclusionService
} from '../workspace/workspace-exclusion.service';
import { getPsychometricLogicalKey } from './psychometric-key.util';
import {
  PsychometricRawResponseRow,
  PsychometricResponseReaderInput,
  PsychometricResponseSnapshot
} from './psychometric-export.types';

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
        input.workspaceId,
        input.version,
        queryRunner.manager,
        exclusions
      );
      const snapshot: PsychometricResponseSnapshot = {
        duplicatePersonIds,
        totalRows,
        forEachBatch: (batchCallback, cancellationCallback) => this.forEachResponseBatch(
          input.workspaceId,
          input.version,
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
    const query = this.createResponseQuery(
      input.workspaceId,
      input.version,
      manager,
      exclusions
    );
    const rows = await query
      .select('person.id', 'personId')
      .addSelect('UPPER(TRIM(unit.name))', 'unitName')
      .addSelect('UPPER(TRIM(response.variableid))', 'variableId')
      .groupBy('person.id')
      .addGroupBy('UPPER(TRIM(unit.name))')
      .addGroupBy('UPPER(TRIM(response.variableid))')
      .having('COUNT(*) > 1')
      .getRawMany<{
      personId: number | string;
      unitName: string;
      variableId: string;
    }>();
    await checkCancellation?.();
    return new Set(
      rows
        .filter(row => input.mapping.byLogicalKey.has(
          getPsychometricLogicalKey(row.unitName, row.variableId)
        )
        )
        .map(row => Number(row.personId))
    );
  }

  private async countResponseRows(
    workspaceId: number,
    version: PsychometricVersion,
    manager: EntityManager,
    exclusions: ResolvedWorkspaceExclusions
  ): Promise<number> {
    const query = this.createResponseQuery(
      workspaceId,
      version,
      manager,
      exclusions
    );
    return query.getCount();
  }

  private async forEachResponseBatch(
    workspaceId: number,
    version: PsychometricVersion,
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
      const query = this.createResponseQuery(
        workspaceId,
        version,
        manager,
        exclusions
      );
      const rows = await query
        .select('response.id', 'responseId')
        .addSelect('person.id', 'personId')
        .addSelect('unit.name', 'unitName')
        .addSelect('response.variableid', 'variableId')
        .addSelect('response.value', 'value')
        .addSelect('response.code_v1', 'codeV1')
        .addSelect('response.score_v1', 'scoreV1')
        .addSelect('response.code_v2', 'codeV2')
        .addSelect('response.score_v2', 'scoreV2')
        .addSelect('response.code_v3', 'codeV3')
        .addSelect('response.score_v3', 'scoreV3')
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
      `Read ${processedRows} response rows for psychometric ${version} export`
    );
  }

  private createResponseQuery(
    workspaceId: number,
    version: PsychometricVersion,
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
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      .andWhere(`response.status_${version} IS NOT NULL`)
      .andWhere(
        `response.status_${version} NOT IN (:...psychometricIgnoredStatuses)`,
        { psychometricIgnoredStatuses: STATISTICS_IGNORED_STATUSES }
      );
    applyResolvedExclusionsToQuery(query, exclusions);
    return query;
  }
}
