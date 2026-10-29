import {
  Inject,
  Injectable, Logger,
  Optional
} from '@nestjs/common';
import {
  DataSource,
  EntityManager,
  EntityTarget,
  ObjectLiteral
} from 'typeorm';
import {
  TestResultsDeletePreviewDto,
  TestResultsDeleteRequestDto,
  TestResultsDeleteResultDto,
  TestResultsResponseCleanupRequestDto
} from '../../../../../../../api-dto/test-results/test-results-deletion.dto';
import { Booklet } from '../../entities/booklet.entity';
import { BookletInfo } from '../../entities/bookletInfo.entity';
import { BookletLog } from '../../entities/bookletLog.entity';
import { ChunkEntity } from '../../entities/chunk.entity';
import { CoderTrainingDiscussionResult } from '../../entities/coder-training-discussion-result.entity';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';
import Persons from '../../entities/persons.entity';
import { ResponseEntity } from '../../entities/response.entity';
import { Session } from '../../entities/session.entity';
import { Unit } from '../../entities/unit.entity';
import { UnitLastState } from '../../entities/unitLastState.entity';
import { UnitLog } from '../../entities/unitLog.entity';
import { UnitNote } from '../../entities/unitNote.entity';
import { UnitTag } from '../../entities/unitTag.entity';
import { CodingFreshnessService } from '../coding/coding-freshness.service';
import { CodingValidationService } from '../coding/coding-validation.service';
import { JournalService } from '../shared';
import { withWorkspaceTestResultsMutationLock } from '../shared/workspace-test-results-lock.util';
import { ResponseManagementService } from './response-management.service';
import { TestResultsCacheService } from './test-results-cache.service';
import { TestResultsDeletionQueryService } from './test-results-deletion-query.service';
import {
  chunkArray, dedupeDeleteDependencySnapshot, mergeDeleteDependencySnapshot, uniqueIds
} from './test-results-deletion.util';
import { DeleteDependencySnapshot, LogDeleteSnapshot, TestResultsDeleteTargetKind } from './workspace-test-results.types';

@Injectable()
export class TestResultsMutationService {
  private readonly logger = new Logger('WorkspaceTestResultsService');

  constructor(
    private readonly connection: DataSource,
    private readonly journalService: JournalService,
    @Inject(CodingValidationService)
    private readonly codingValidationService: CodingValidationService,
    private readonly responseManagementService: ResponseManagementService,
    private readonly cache: TestResultsCacheService,
    private readonly deletionQuery: TestResultsDeletionQueryService,
    @Optional()
    @Inject(CodingFreshnessService)
    private readonly codingFreshnessService?: CodingFreshnessService
  ) {}

  async resolveDuplicateResponses(
    workspaceId: number,
    resolutionMap: Record<string, number>,
    userId: string
  ): Promise<{ resolvedCount: number; success: boolean }> {
    return this.responseManagementService.resolveDuplicateResponses(
      workspaceId,
      resolutionMap,
      userId
    );
  }

  async deleteTestPersons(
    workspaceId: number,
    testPersonIds: string,
    userId: string
  ): Promise<{
    success: boolean;
    report: {
      deletedPersons: number[];
      warnings: string[];
    };
  }> {
    return withWorkspaceTestResultsMutationLock(
      this.connection,
      workspaceId,
      async () => {
        const result = await this.connection.transaction(async manager => {
          const ids = testPersonIds.split(',').map(id => id.trim());
          const report = {
            deletedPersons: [] as number[],
            warnings: [] as string[]
          };

          const existingPersons = await manager
            .createQueryBuilder(Persons, 'persons')
            .select([
              'persons.id',
              'persons.login',
              'persons.code',
              'persons.group',
              'persons.workspace_id',
              'persons.uploaded_at',
              'persons.source'
            ])
            .where('persons.id IN (:...ids)', { ids })
            .andWhere('persons.workspace_id = :workspaceId', { workspaceId })
            .getMany();

          if (!existingPersons.length) {
            const warningMessage = `Keine Personen gefunden für die angegebenen IDs: ${testPersonIds}`;
            this.logger.warn(warningMessage);
            report.warnings.push(warningMessage);
            return { success: false, report };
          }

          const existingIds = existingPersons.map(person => person.id);

          await manager
            .createQueryBuilder()
            .delete()
            .from(Persons)
            .where('id IN (:...ids)', { ids: existingIds })
            .andWhere('workspace_id = :workspaceId', { workspaceId })
            .execute();

          report.deletedPersons = existingIds;

          for (const person of existingPersons) {
            await this.journalService.recordEvent({
              workspaceId,
              actorUserId: userId,
              eventType: 'TEST_PERSON_DELETED',
              entityType: 'test-person',
              entityId: person.id,
              result: 'success',
              summary: 'Test person deleted',
              details: {
                personId: person.id,
                message: 'Test person deleted'
              }
            }, manager);
          }

          return { success: true, report };
        });

        if (result.success) {
          await this.cache.invalidateCachesAfterTestResultDeletion(workspaceId);
        }
        return result;
      }
    );
  }

  async previewDeleteTestResults(
    workspaceId: number,
    request: TestResultsDeleteRequestDto
  ): Promise<TestResultsDeletePreviewDto> {
    return (await this.deletionQuery.resolveDeleteTargets(workspaceId, request)).preview;
  }

  async previewDeleteTestLogs(
    workspaceId: number,
    request: TestResultsDeleteRequestDto
  ): Promise<TestResultsDeletePreviewDto> {
    const targets = await this.deletionQuery.resolveDeleteTargets(workspaceId, request);
    return this.deletionQuery.buildLogDeletePreview(targets);
  }

  async deleteTestResultsByRequest(
    workspaceId: number,
    request: TestResultsDeleteRequestDto,
    userId: string,
    onProgress?: (progress: number, message?: string) => Promise<void>
  ): Promise<TestResultsDeleteResultDto> {
    return withWorkspaceTestResultsMutationLock(
      this.connection,
      workspaceId,
      async () => this.deleteTestResultsByRequestLocked(
        workspaceId,
        request,
        userId,
        onProgress
      )
    );
  }

  private async deleteTestResultsByRequestLocked(
    workspaceId: number,
    request: TestResultsDeleteRequestDto,
    userId: string,
    onProgress?: (progress: number, message?: string) => Promise<void>
  ): Promise<TestResultsDeleteResultDto> {
    const targets = await this.deletionQuery.resolveDeleteTargets(workspaceId, request);
    const totalTargets = targets.ids.length;

    if (totalTargets === 0) {
      return {
        ...targets.preview,
        deletedTargetCount: 0
      };
    }

    await onProgress?.(
      5,
      `Lösche ${totalTargets} Datensätze aus dem Ergebnisbrowser...`
    );

    const chunks = chunkArray(targets.ids, 250);
    const dependencySnapshot: DeleteDependencySnapshot = {
      bookletIds: [],
      unitIds: [],
      responseIds: [],
      bookletInfoIds: []
    };
    let deletedTargetCount = 0;

    try {
      for (const [index, ids] of chunks.entries()) {
        const chunkSnapshot = await this.deletionQuery.collectDeleteDependencySnapshot(
          targets.kind,
          ids
        );
        mergeDeleteDependencySnapshot(
          dependencySnapshot,
          chunkSnapshot
        );

        const deleteResult = await this.connection.transaction(async manager => {
          await this.codingFreshnessService?.markCodingJobsStaleForResponseIds?.(
            workspaceId,
            chunkSnapshot.responseIds,
            'RESULT_DELETED',
            'stale_source',
            manager
          );

          await this.deleteKnownDeleteDependents(
            manager,
            targets.kind,
            chunkSnapshot
          );

          const targetEntity = { persons: Persons, booklets: Booklet, units: Unit }[targets.kind];
          if (!targetEntity) {
            throw new Error('Unknown test result deletion target');
          }
          const result = await manager.createQueryBuilder().delete().from(targetEntity)
            .where('id IN (:...ids)', { ids })
            .execute();
          await this.journalService.recordEvent({
            workspaceId,
            actorUserId: userId,
            actorType: userId ? 'user' : 'job',
            eventType: 'TEST_RESULTS_DELETED',
            entityType: 'test-results',
            result: 'success',
            summary: 'Test results deletion batch committed',
            details: {
              scope: request.scope,
              deletedTargetKind: targets.kind,
              deletedTargetCount: result.affected ?? ids.length,
              batchNumber: index + 1,
              batchCount: chunks.length
            }
          }, manager);
          return result;
        });

        deletedTargetCount += deleteResult.affected ?? ids.length;

        const progress = Math.min(
          90,
          10 + Math.round((deletedTargetCount / totalTargets) * 80)
        );
        await onProgress?.(
          progress,
          `Löschung läuft: ${deletedTargetCount}/${totalTargets} Datensätze verarbeitet (${index + 1}/${chunks.length} Stapel).`
        );
      }

      const finalSnapshot =
        dedupeDeleteDependencySnapshot(
          dependencySnapshot
        );

      await onProgress?.(92, 'Verwaiste Testheft-Metadaten werden bereinigt...');
      await this.deleteOrphanedBookletInfos(finalSnapshot.bookletInfoIds);

      await onProgress?.(95, 'Löschung wird abschließend geprüft...');
      await this.assertDeleteCompleted(
        targets.kind,
        targets.ids,
        finalSnapshot
      );

      await onProgress?.(97, 'Caches und Statistiken werden aktualisiert...');
      await this.cache.invalidateCachesAfterTestResultDeletion(workspaceId);

      return {
        ...targets.preview,
        deletedTargetCount
      };
    } catch (error) {
      if (deletedTargetCount > 0) {
        await this.cache.invalidateCachesAfterPartialDeletion(workspaceId);
      }
      throw error;
    }
  }

  async deleteTestLogsByRequest(
    workspaceId: number,
    request: TestResultsDeleteRequestDto,
    userId: string,
    onProgress?: (progress: number, message?: string) => Promise<void>
  ): Promise<TestResultsDeleteResultDto> {
    return withWorkspaceTestResultsMutationLock(
      this.connection,
      workspaceId,
      async () => this.deleteTestLogsByRequestLocked(
        workspaceId,
        request,
        userId,
        onProgress
      )
    );
  }

  async previewDeleteTestResultResponses(
    workspaceId: number,
    request: TestResultsResponseCleanupRequestDto
  ): Promise<TestResultsDeletePreviewDto> {
    return (await this.deletionQuery.resolveResponseCleanupTargets(workspaceId, request))
      .preview;
  }

  async deleteTestResultResponsesByRequest(
    workspaceId: number,
    request: TestResultsResponseCleanupRequestDto,
    userId: string,
    onProgress?: (progress: number, message?: string) => Promise<void>
  ): Promise<TestResultsDeleteResultDto> {
    return withWorkspaceTestResultsMutationLock(
      this.connection,
      workspaceId,
      async () => this.deleteTestResultResponsesByRequestLocked(
        workspaceId,
        request,
        userId,
        onProgress
      )
    );
  }

  private async deleteTestResultResponsesByRequestLocked(
    workspaceId: number,
    request: TestResultsResponseCleanupRequestDto,
    userId: string,
    onProgress?: (progress: number, message?: string) => Promise<void>
  ): Promise<TestResultsDeleteResultDto> {
    const targets = await this.deletionQuery.resolveResponseCleanupTargets(
      workspaceId,
      request
    );
    const totalResponses = targets.responseIds.length;

    if (totalResponses === 0) {
      return {
        ...targets.preview,
        deletedTargetCount: 0
      };
    }

    await onProgress?.(
      5,
      `Lösche ${totalResponses} Antwort(en) aus dem Ergebnisbrowser...`
    );

    const chunks = chunkArray(
      targets.responseIds,
      1000
    );
    let deletedTargetCount = 0;

    try {
      for (const [index, responseIds] of chunks.entries()) {
        const deleteResult = await this.connection.transaction(async manager => {
          await this.codingFreshnessService?.markCodingJobsStaleForResponseIds?.(
            workspaceId,
            responseIds,
            'RESULT_DELETED',
            'stale_source',
            manager
          );

          await this.deleteRowsByIds(
            manager,
            CodingJobUnit,
            'response_id',
            responseIds
          );
          await this.deleteRowsByIds(
            manager,
            CoderTrainingDiscussionResult,
            'response_id',
            responseIds
          );
          const result = await manager
            .createQueryBuilder()
            .delete()
            .from(ResponseEntity)
            .where('id IN (:...responseIds)', { responseIds })
            .execute();
          await this.journalService.recordEvent({
            workspaceId,
            actorUserId: userId,
            actorType: userId ? 'user' : 'job',
            eventType: 'TEST_RESULT_RESPONSES_DELETED',
            entityType: 'responses',
            result: 'success',
            summary: 'Test result response deletion batch committed',
            details: {
              deletedTargetCount: result.affected ?? responseIds.length,
              batchNumber: index + 1,
              batchCount: chunks.length
            }
          }, manager);
          return result;
        });

        deletedTargetCount += deleteResult.affected ?? responseIds.length;
        const progress = Math.min(
          90,
          10 + Math.round((deletedTargetCount / totalResponses) * 80)
        );
        await onProgress?.(
          progress,
          `Antwort-Löschung läuft: ${deletedTargetCount}/${totalResponses} Antwort(en) verarbeitet (${index + 1}/${chunks.length} Stapel).`
        );
      }

      await onProgress?.(92, 'Kodierstatus wird aktualisiert...');
      await this.codingFreshnessService?.markUnitsStaleAfterResultChange(
        workspaceId,
        targets.unitIds,
        'RESULT_DELETED'
      );

      await onProgress?.(95, 'Antwort-Löschung wird abschließend geprüft...');
      await this.assertResponseCleanupCompleted(targets.responseIds);

      await onProgress?.(97, 'Caches und Statistiken werden aktualisiert...');
      await this.cache.invalidateCachesAfterTestResultDeletion(workspaceId);

      return {
        ...targets.preview,
        deletedTargetCount
      };
    } catch (error) {
      if (deletedTargetCount > 0) {
        await this.cache.invalidateCachesAfterPartialDeletion(workspaceId);
      }
      throw error;
    }
  }

  private async assertResponseCleanupCompleted(
    responseIds: number[]
  ): Promise<void> {
    const remaining = await this.deletionQuery.countRowsByIds(
      ResponseEntity,
      'id',
      responseIds
    );
    if (remaining > 0) {
      throw new Error(
        `Die Antwort-Löschung wurde nicht vollständig bestätigt. Verblieben: ${remaining} Antwort(en).`
      );
    }
  }

  private async deleteTestLogsByRequestLocked(
    workspaceId: number,
    request: TestResultsDeleteRequestDto,
    userId: string,
    onProgress?: (progress: number, message?: string) => Promise<void>
  ): Promise<TestResultsDeleteResultDto> {
    const targets = await this.deletionQuery.resolveDeleteTargets(workspaceId, request);
    const preview = await this.deletionQuery.buildLogDeletePreview(targets);
    const totalLogRows =
      (preview.bookletLogs || 0) +
      (preview.unitLogs || 0) +
      (preview.sessions || 0);

    if (totalLogRows === 0) {
      return {
        ...preview,
        deletedTargetCount: 0,
        deletedBookletLogs: 0,
        deletedUnitLogs: 0,
        deletedSessions: 0
      };
    }

    await onProgress?.(
      5,
      `Lösche ${totalLogRows} Log- und Sitzungsdatensätze...`
    );

    const snapshot = await this.deletionQuery.collectLogDeleteSnapshot(
      targets.kind,
      targets.ids
    );

    const deletedCounts = await this.connection.transaction(async manager => {
      const deletedUnitLogs = await this.deleteRowsByIds(
        manager,
        UnitLog,
        'unitid',
        snapshot.unitIds
      );
      const deletedBookletLogs = await this.deleteRowsByIds(
        manager,
        BookletLog,
        'bookletid',
        snapshot.bookletIds
      );
      const deletedSessions = await this.deleteRowsByIds(
        manager,
        Session,
        'bookletid',
        snapshot.bookletIds
      );

      const counts = {
        deletedBookletLogs,
        deletedUnitLogs,
        deletedSessions
      };
      await this.journalService.recordEvent({
        workspaceId,
        actorUserId: userId,
        actorType: userId ? 'user' : 'job',
        eventType: 'TEST_LOGS_DELETED',
        entityType: 'test-logs',
        result: 'success',
        summary: 'Test logs deleted',
        details: {
          scope: request.scope,
          deletedTargetKind: targets.kind,
          deletedTargetCount: deletedBookletLogs + deletedUnitLogs + deletedSessions,
          ...counts
        }
      }, manager);
      return counts;
    });

    await onProgress?.(90, 'Log-Löschung wird abschließend geprüft...');
    await this.assertLogDeleteCompleted(snapshot);

    await onProgress?.(97, 'Caches und Statistiken werden aktualisiert...');
    await this.cache.invalidateWorkspaceStatsCache(workspaceId);

    const deletedTargetCount =
      deletedCounts.deletedBookletLogs +
      deletedCounts.deletedUnitLogs +
      deletedCounts.deletedSessions;

    return {
      ...preview,
      deletedTargetCount,
      ...deletedCounts
    };
  }

  private async assertLogDeleteCompleted(
    snapshot: LogDeleteSnapshot
  ): Promise<void> {
    const failures: string[] = [];
    const addFailure = async (
      label: string,
      countPromise: Promise<number>
    ): Promise<void> => {
      const count = await countPromise;
      if (count > 0) {
        failures.push(`${count} ${label}`);
      }
    };

    await addFailure(
      'Booklet-Logeintrag/-einträge',
      this.deletionQuery.countRowsByIds(BookletLog, 'bookletid', snapshot.bookletIds)
    );
    await addFailure(
      'Unit-Logeintrag/-einträge',
      this.deletionQuery.countRowsByIds(UnitLog, 'unitid', snapshot.unitIds)
    );
    await addFailure(
      'Sitzung(en)',
      this.deletionQuery.countRowsByIds(Session, 'bookletid', snapshot.bookletIds)
    );

    if (failures.length > 0) {
      throw new Error(
        `Die Log-Löschung wurde nicht vollständig bestätigt. Verblieben: ${failures.join(', ')}.`
      );
    }
  }

  private async deleteKnownDeleteDependents(
    manager: EntityManager,
    kind: TestResultsDeleteTargetKind,
    snapshot: DeleteDependencySnapshot
  ): Promise<void> {
    await this.deleteRowsByIds(
      manager,
      CodingJobUnit,
      'response_id',
      snapshot.responseIds
    );
    await this.deleteRowsByIds(
      manager,
      CoderTrainingDiscussionResult,
      'response_id',
      snapshot.responseIds
    );
    await this.deleteRowsByIds(
      manager,
      ResponseEntity,
      'unitid',
      snapshot.unitIds
    );
    await this.deleteRowsByIds(manager, UnitNote, '"unitId"', snapshot.unitIds);
    await this.deleteRowsByIds(manager, UnitTag, '"unitId"', snapshot.unitIds);
    await this.deleteRowsByIds(manager, UnitLog, 'unitid', snapshot.unitIds);
    await this.deleteRowsByIds(
      manager,
      UnitLastState,
      'unitid',
      snapshot.unitIds
    );
    await this.deleteRowsByIds(manager, ChunkEntity, 'unitid', snapshot.unitIds);

    if (kind !== 'units') {
      await this.deleteRowsByIds(manager, Unit, 'id', snapshot.unitIds);
      await this.deleteRowsByIds(
        manager,
        Session,
        'bookletid',
        snapshot.bookletIds
      );
      await this.deleteRowsByIds(
        manager,
        BookletLog,
        'bookletid',
        snapshot.bookletIds
      );

      if (kind === 'persons') {
        await this.deleteRowsByIds(manager, Booklet, 'id', snapshot.bookletIds);
      }
    }
  }

  private async deleteRowsByIds(
    manager: EntityManager,
    entity: EntityTarget<ObjectLiteral>,
    columnExpression: string,
    ids: number[]
  ): Promise<number> {
    let affected = 0;
    for (const chunk of chunkArray(
      uniqueIds(ids),
      1000
    )) {
      const result = await manager
        .createQueryBuilder()
        .delete()
        .from(entity)
        .where(`${columnExpression} IN (:...ids)`, { ids: chunk })
        .execute();
      affected += result.affected || 0;
    }
    return affected;
  }

  private async deleteOrphanedBookletInfos(infoIds: number[]): Promise<number> {
    let affected = 0;
    for (const chunk of chunkArray(
      uniqueIds(infoIds),
      1000
    )) {
      const result = await this.connection
        .createQueryBuilder()
        .delete()
        .from(BookletInfo)
        .where('id IN (:...ids)', { ids: chunk })
        .andWhere(
          'NOT EXISTS (SELECT 1 FROM booklet WHERE booklet.infoid = bookletinfo.id)'
        )
        .execute();
      affected += result.affected || 0;
    }
    return affected;
  }

  private async assertDeleteCompleted(
    kind: TestResultsDeleteTargetKind,
    targetIds: number[],
    snapshot: DeleteDependencySnapshot
  ): Promise<void> {
    const failures: string[] = [];
    const addFailure = async (
      label: string,
      countPromise: Promise<number>
    ): Promise<void> => {
      const count = await countPromise;
      if (count > 0) {
        failures.push(`${count} ${label}`);
      }
    };

    if (kind === 'persons') {
      await addFailure(
        'Testperson(en)',
        this.deletionQuery.countRowsByIds(Persons, 'id', targetIds)
      );
    }

    if (kind !== 'units') {
      await addFailure(
        'Testheft(e)',
        this.deletionQuery.countRowsByIds(Booklet, 'id', snapshot.bookletIds)
      );
      await addFailure(
        'Sitzung(en)',
        this.deletionQuery.countRowsByIds(Session, 'bookletid', snapshot.bookletIds)
      );
      await addFailure(
        'Testheft-Logeintrag/-einträge',
        this.deletionQuery.countRowsByIds(BookletLog, 'bookletid', snapshot.bookletIds)
      );
      await addFailure(
        'verwaiste Testheft-Metadaten',
        this.deletionQuery.countOrphanedBookletInfos(snapshot.bookletInfoIds)
      );
    }

    await addFailure(
      'Aufgabe(n)',
      this.deletionQuery.countRowsByIds(Unit, 'id', snapshot.unitIds)
    );
    await addFailure(
      'Antwort(en)',
      this.deletionQuery.countRowsByIds(ResponseEntity, 'unitid', snapshot.unitIds)
    );
    await addFailure(
      'Unit-Notiz(en)',
      this.deletionQuery.countRowsByIds(UnitNote, '"unitId"', snapshot.unitIds)
    );
    await addFailure(
      'Unit-Tag(s)',
      this.deletionQuery.countRowsByIds(UnitTag, '"unitId"', snapshot.unitIds)
    );
    await addFailure(
      'Unit-Logeintrag/-einträge',
      this.deletionQuery.countRowsByIds(UnitLog, 'unitid', snapshot.unitIds)
    );
    await addFailure(
      'Unit-Zustand/Zustände',
      this.deletionQuery.countRowsByIds(UnitLastState, 'unitid', snapshot.unitIds)
    );
    await addFailure(
      'Chunk(s)',
      this.deletionQuery.countRowsByIds(ChunkEntity, 'unitid', snapshot.unitIds)
    );
    await addFailure(
      'Kodierjob-Antwortreferenz(en)',
      this.deletionQuery.countRowsByIds(CodingJobUnit, 'response_id', snapshot.responseIds)
    );
    await addFailure(
      'Training-Diskussionsergebnis(se)',
      this.deletionQuery.countRowsByIds(
        CoderTrainingDiscussionResult,
        'response_id',
        snapshot.responseIds
      )
    );

    if (failures.length > 0) {
      throw new Error(
        `Die Löschung wurde nicht vollständig bestätigt. Verblieben: ${failures.join(', ')}.`
      );
    }
  }

  async deleteUnit(
    workspaceId: number,
    unitId: number,
    userId: string
  ): Promise<{
    success: boolean;
    report: {
      deletedUnit: number | null;
      warnings: string[];
    };
  }> {
    return withWorkspaceTestResultsMutationLock(
      this.connection,
      workspaceId,
      async () => {
        const result = await this.connection.transaction(async manager => {
          const report = {
            deletedUnit: null as number | null,
            warnings: [] as string[]
          };

          const unit = await manager
            .createQueryBuilder(Unit, 'unit')
            .leftJoinAndSelect('unit.booklet', 'booklet')
            .leftJoinAndSelect('booklet.person', 'person')
            .where('unit.id = :unitId', { unitId })
            .andWhere('person.workspace_id = :workspaceId', { workspaceId })
            .getOne();

          if (!unit) {
            const warningMessage = `Keine Unit mit ID ${unitId} im Workspace ${workspaceId} gefunden`;
            this.logger.warn(warningMessage);
            report.warnings.push(warningMessage);
            return { success: false, report };
          }

          await manager
            .createQueryBuilder()
            .delete()
            .from(Unit)
            .where('id = :unitId', { unitId })
            .execute();

          report.deletedUnit = unitId;

          await this.journalService.recordEvent({
            workspaceId,
            actorUserId: userId,
            eventType: 'UNIT_DELETED',
            entityType: 'unit',
            entityId: unitId,
            result: 'success',
            summary: 'Unit deleted',
            details: {
              unitId,
              unitName: unit.name,
              unitAlias: unit.alias,
              bookletId: unit.booklet?.id,
              personId: unit.booklet?.person?.id
            }
          }, manager);

          return { success: true, report };
        });

        if (result.success) {
          await this.cache.invalidateCachesAfterTestResultDeletion(workspaceId);
        }
        return result;
      }
    );
  }

  async deleteResponse(
    workspaceId: number,
    responseId: number,
    userId: string
  ): Promise<{
    success: boolean;
    report: {
      deletedResponse: number | null;
      warnings: string[];
    };
  }> {
    const result = await this.responseManagementService.deleteResponse(
      workspaceId,
      responseId,
      userId
    );
    if (result?.success) {
      await this.codingValidationService.invalidateIncompleteVariablesCache(
        workspaceId
      );
      await this.cache.invalidateCodingStatisticsCache(workspaceId);
    }
    return result;
  }

  async deleteBooklet(
    workspaceId: number,
    bookletId: number,
    userId: string
  ): Promise<{
    success: boolean;
    report: {
      deletedBooklet: number | null;
      warnings: string[];
    };
  }> {
    return withWorkspaceTestResultsMutationLock(
      this.connection,
      workspaceId,
      async () => {
        const result = await this.connection.transaction(async manager => {
          const report = {
            deletedBooklet: null as number | null,
            warnings: [] as string[]
          };

          const booklet = await manager
            .createQueryBuilder(Booklet, 'booklet')
            .leftJoinAndSelect('booklet.person', 'person')
            .leftJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
            .where('booklet.id = :bookletId', { bookletId })
            .andWhere('person.workspace_id = :workspaceId', { workspaceId })
            .getOne();

          if (!booklet) {
            const warningMessage = `Kein Booklet mit ID ${bookletId} im Workspace ${workspaceId} gefunden`;
            this.logger.warn(warningMessage);
            report.warnings.push(warningMessage);
            return { success: false, report };
          }

          await manager
            .createQueryBuilder()
            .delete()
            .from(Booklet)
            .where('id = :bookletId', { bookletId })
            .execute();

          report.deletedBooklet = bookletId;

          await this.journalService.recordEvent({
            workspaceId,
            actorUserId: userId,
            eventType: 'BOOKLET_DELETED',
            entityType: 'booklet',
            entityId: bookletId,
            result: 'success',
            summary: 'Booklet deleted',
            details: {
              bookletId,
              bookletName: booklet.bookletinfo?.name || 'Unknown',
              personId: booklet.personid
            }
          }, manager);

          return { success: true, report };
        });

        if (result.success) {
          await this.cache.invalidateCachesAfterTestResultDeletion(workspaceId);
        }
        return result;
      }
    );
  }
}
