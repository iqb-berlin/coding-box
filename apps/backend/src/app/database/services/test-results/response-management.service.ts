import { DataSource, QueryRunner } from 'typeorm';
import {
  forwardRef, Inject, Injectable, Logger, Optional
} from '@nestjs/common';
import { ResponseEntity } from '../../entities/response.entity';
import { JournalService, CodedResponse } from '../shared';
import { statusStringToNumber } from '../../utils/response-status-converter';
// eslint-disable-next-line import/no-cycle
import { WorkspaceTestResultsService } from './workspace-test-results.service';
import { CodingFreshnessService } from '../coding/coding-freshness.service';
import {
  lockWorkspaceTestResultsMutationInTransaction,
  withWorkspaceTestResultsMutationLock
} from '../shared/workspace-test-results-lock.util';
import { CodingFreshnessVersion } from '../../../../../../../api-dto/coding/coding-freshness.dto';

type AutocoderCleanup = {
  unitIds: number[];
  autoCoderRun: number;
  markCurrentVersion?: Extract<CodingFreshnessVersion, 'v1' | 'v3'>;
};

@Injectable()
export class ResponseManagementService {
  private readonly logger = new Logger(ResponseManagementService.name);

  constructor(
    private readonly connection: DataSource,
    private readonly journalService: JournalService,
    @Inject(forwardRef(() => WorkspaceTestResultsService))
    private readonly workspaceTestResultsService: WorkspaceTestResultsService,
    @Optional()
    private readonly codingFreshnessService?: CodingFreshnessService
  ) { }

  async updateResponsesInDatabase(
    workspaceId: number,
    allCodedResponses: CodedResponse[],
    queryRunner: QueryRunner,
    jobId?: string,
    isJobCancelled?: (jobId: string) => Promise<boolean>,
    progressCallback?: (progress: number) => void,
    metrics?: { [key: string]: number },
    autocoderCleanup?: AutocoderCleanup
  ): Promise<boolean> {
    const updateStart = Date.now();
    try {
      if (allCodedResponses.length === 0 && !autocoderCleanup) {
        await queryRunner.release();

        if (workspaceId) {
          await this.workspaceTestResultsService.invalidateWorkspaceStatsCache(workspaceId);
        }

        return true;
      }

      await lockWorkspaceTestResultsMutationInTransaction(
        queryRunner.manager,
        workspaceId
      );

      if (autocoderCleanup) {
        await this.cleanupStaleAutocoderGeneratedResponses(
          queryRunner,
          autocoderCleanup,
          allCodedResponses
        );
      }

      if (allCodedResponses.length === 0) {
        await this.markAutocoderVersionCurrent(
          workspaceId,
          autocoderCleanup,
          queryRunner
        );
        await queryRunner.commitTransaction();
        await queryRunner.release();
        if (workspaceId) {
          await this.workspaceTestResultsService.invalidateWorkspaceStatsCache(workspaceId);
        }
        return true;
      }

      const updateBatchSize = 500;
      const batches: CodedResponse[][] = [];
      for (let i = 0; i < allCodedResponses.length; i += updateBatchSize) {
        batches.push(allCodedResponses.slice(i, i + updateBatchSize));
      }

      this.logger.log(
        `Starte die Aktualisierung von ${allCodedResponses.length} Responses in ${batches.length} Batches (sequential).`
      );

      for (let index = 0; index < batches.length; index++) {
        const batch = batches[index];
        this.logger.log(
          `Starte Aktualisierung für Batch #${index + 1} (Größe: ${batch.length
          }).`
        );

        if (jobId && isJobCancelled && (await isJobCancelled(jobId))) {
          this.logger.log(
            `Job ${jobId} was cancelled or paused before updating batch #${index + 1
            }`
          );
          await queryRunner.rollbackTransaction();
          await queryRunner.release();
          return false;
        }

        try {
          if (batch.length > 0) {
            const updatePromises = batch.map(response => {
              const updateData: Partial<ResponseEntity> = {};

              if (response.code_v1 !== undefined) {
                updateData.code_v1 = response.code_v1;
              }
              if (response.status_v1 !== undefined) {
                updateData.status_v1 = statusStringToNumber(response.status_v1);
              }
              if (response.score_v1 !== undefined) {
                updateData.score_v1 = response.score_v1;
              }

              if (response.code_v2 !== undefined) {
                updateData.code_v2 = response.code_v2;
              }
              if (response.status_v2 !== undefined) {
                updateData.status_v2 =
                  response.status_v2 === null ?
                    null :
                    statusStringToNumber(response.status_v2);
              }
              if (response.score_v2 !== undefined) {
                updateData.score_v2 = response.score_v2;
              }

              if (response.code_v3 !== undefined) {
                updateData.code_v3 = response.code_v3;
              }
              if (response.status_v3 !== undefined) {
                const statusNumber =
                  response.status_v3 === null ?
                    null :
                    statusStringToNumber(response.status_v3);
                updateData.status_v3 = statusNumber;
                this.logger.debug(
                  `Response ${response.id}: status_v3='${response.status_v3}' -> statusNumber=${statusNumber}`
                );
              }
              if (response.score_v3 !== undefined) {
                updateData.score_v3 = response.score_v3;
              }

              if (response.isNew) {
                const newEntity: Partial<ResponseEntity> = {
                  unitid: response.unitid,
                  variableid: response.variableid,
                  value: response.value,
                  status: response.status,
                  subform: response.subform || null,
                  is_autocoder_generated: response.isAutocoderGenerated === true
                };

                if (response.code_v1 !== undefined) newEntity.code_v1 = response.code_v1;
                if (response.status_v1 !== undefined) newEntity.status_v1 = statusStringToNumber(response.status_v1);
                if (response.score_v1 !== undefined) newEntity.score_v1 = response.score_v1;

                if (response.code_v2 !== undefined) newEntity.code_v2 = response.code_v2;
                if (response.status_v2 !== undefined) {
                  newEntity.status_v2 = response.status_v2 === null ? null : statusStringToNumber(response.status_v2);
                }
                if (response.score_v2 !== undefined) newEntity.score_v2 = response.score_v2;

                if (response.code_v3 !== undefined) newEntity.code_v3 = response.code_v3;
                if (response.status_v3 !== undefined) {
                  newEntity.status_v3 = response.status_v3 === null ? null : statusStringToNumber(response.status_v3);
                }
                if (response.score_v3 !== undefined) newEntity.score_v3 = response.score_v3;

                if (response.isAutocoderGenerated) {
                  return this.upsertAutocoderGeneratedResponse(
                    queryRunner,
                    response,
                    newEntity,
                    updateData
                  );
                }

                return queryRunner.manager.insert(ResponseEntity, newEntity);
              }

              if (Object.keys(updateData).length > 0) {
                return queryRunner.manager.update(
                  ResponseEntity,
                  response.id,
                  updateData
                );
              }
              return Promise.resolve();
            });

            await Promise.all(updatePromises);
          }

          this.logger.log(
            `Batch #${index + 1} (Größe: ${batch.length
            }) erfolgreich aktualisiert.`
          );

          if (progressCallback) {
            const batchProgress = 95 + 5 * ((index + 1) / batches.length);
            progressCallback(Math.round(Math.min(batchProgress, 99)));
          }
        } catch (error) {
          this.logger.error(
            `Fehler beim Aktualisieren von Batch #${index + 1} (Größe: ${batch.length
            }):`,
            error.message
          );
          await queryRunner.rollbackTransaction();
          await queryRunner.release();
          return false;
        }
      }

      await this.markAutocoderVersionCurrent(
        workspaceId,
        autocoderCleanup,
        queryRunner
      );
      await queryRunner.commitTransaction();
      this.logger.log(
        `${allCodedResponses.length} Responses wurden erfolgreich aktualisiert.`
      );

      if (metrics) {
        metrics.update = Date.now() - updateStart;
      }

      await queryRunner.release();

      if (workspaceId) {
        await this.workspaceTestResultsService.invalidateWorkspaceStatsCache(workspaceId);
      }

      return true;
    } catch (error) {
      this.logger.error(
        'Fehler beim Aktualisieren der Responses:',
        error.message
      );
      try {
        await queryRunner.rollbackTransaction();
      } catch (rollbackError) {
        this.logger.error(
          'Fehler beim Rollback der Transaktion:',
          rollbackError.message
        );
      }
      await queryRunner.release();
      return false;
    }
  }

  private async markAutocoderVersionCurrent(
    workspaceId: number,
    autocoderCleanup: AutocoderCleanup | undefined,
    queryRunner: QueryRunner
  ): Promise<void> {
    if (!autocoderCleanup?.markCurrentVersion) {
      return;
    }

    await this.codingFreshnessService?.markVersionCurrent(
      workspaceId,
      autocoderCleanup.unitIds,
      autocoderCleanup.markCurrentVersion,
      queryRunner.manager
    );
  }

  private async upsertAutocoderGeneratedResponse(
    queryRunner: QueryRunner,
    response: CodedResponse,
    newEntity: Partial<ResponseEntity>,
    updateData: Partial<ResponseEntity>
  ): Promise<void> {
    const generatedUpdateData: Partial<ResponseEntity> = {
      ...updateData,
      value: response.value,
      status: response.status,
      is_autocoder_generated: true
    };

    const updateResult = await queryRunner.manager
      .createQueryBuilder()
      .update(ResponseEntity)
      .set(generatedUpdateData)
      .where('unitid = :unitid', { unitid: response.unitid })
      .andWhere('variableid = :variableid', { variableid: response.variableid })
      .andWhere("COALESCE(subform, '') = :subform", {
        subform: response.subform || ''
      })
      .andWhere('is_autocoder_generated = :generated', { generated: true })
      .execute();

    if ((updateResult.affected || 0) === 0) {
      await queryRunner.manager.insert(ResponseEntity, {
        ...newEntity,
        is_autocoder_generated: true
      });
    }
  }

  private async cleanupStaleAutocoderGeneratedResponses(
    queryRunner: QueryRunner,
    cleanup: { unitIds: number[]; autoCoderRun: number },
    allCodedResponses: CodedResponse[]
  ): Promise<void> {
    const unitIds = Array.from(new Set(cleanup.unitIds)).filter(Number.isFinite);
    if (unitIds.length === 0) {
      return;
    }

    const emittedGeneratedKeys = new Set(
      allCodedResponses
        .filter(response => response.isAutocoderGenerated)
        .map(response => this.autocoderGeneratedKey(
          response.unitid,
          response.variableid,
          response.subform
        ))
    );

    const existingGenerated = await queryRunner.manager
      .getRepository(ResponseEntity)
      .createQueryBuilder('response')
      .select([
        'response.id',
        'response.unitid',
        'response.variableid',
        'response.subform'
      ])
      .where('response.unitid IN (:...unitIds)', { unitIds })
      .andWhere('response.is_autocoder_generated = :generated', {
        generated: true
      })
      .getMany();

    const staleIds = existingGenerated
      .filter(response => !emittedGeneratedKeys.has(
        this.autocoderGeneratedKey(
          response.unitid,
          response.variableid,
          response.subform
        )
      ))
      .map(response => response.id);

    if (staleIds.length === 0) {
      return;
    }

    const clearData: Partial<ResponseEntity> = cleanup.autoCoderRun === 1 ?
      {
        code_v1: null,
        status_v1: null,
        score_v1: null,
        code_v2: null,
        status_v2: null,
        score_v2: null,
        code_v3: null,
        status_v3: null,
        score_v3: null
      } :
      {
        code_v3: null,
        status_v3: null,
        score_v3: null
      };

    await queryRunner.manager
      .createQueryBuilder()
      .update(ResponseEntity)
      .set(clearData)
      .where('id IN (:...staleIds)', { staleIds })
      .execute();

    await queryRunner.manager.query(
      `
        DELETE FROM response
        WHERE id = ANY($1)
          AND is_autocoder_generated = TRUE
          AND code_v1 IS NULL
          AND status_v1 IS NULL
          AND score_v1 IS NULL
          AND code_v2 IS NULL
          AND status_v2 IS NULL
          AND score_v2 IS NULL
          AND code_v3 IS NULL
          AND status_v3 IS NULL
          AND score_v3 IS NULL
      `,
      [staleIds]
    );
  }

  private autocoderGeneratedKey(
    unitid?: number,
    variableid?: string,
    subform?: string | null
  ): string {
    return `${unitid ?? ''}|${variableid ?? ''}|${subform || ''}`;
  }

  async resolveDuplicateResponses(
    workspaceId: number,
    resolutionMap: Record<string, number>,
    userId: string
  ): Promise<{ resolvedCount: number; success: boolean }> {
    if (!workspaceId || workspaceId <= 0) {
      throw new Error('Invalid workspaceId provided');
    }

    if (
      !resolutionMap ||
      typeof resolutionMap !== 'object' ||
      Object.keys(resolutionMap).length === 0
    ) {
      return { resolvedCount: 0, success: true };
    }

    return withWorkspaceTestResultsMutationLock(this.connection, workspaceId, async () => {
      const affectedUnitIds: number[] = [];
      return this.connection.transaction(async manager => {
        let resolvedCount = 0;

        for (const [key, selectedResponseId] of Object.entries(resolutionMap)) {
          if (!selectedResponseId) {
            continue;
          }

          const parts = key.split('|');
          if (parts.length !== 6) {
            this.logger.warn(`Invalid duplicate resolution key: ${key}`);
            continue;
          }

          const unitName = decodeURIComponent(parts[0] || '');
          const variableId = decodeURIComponent(parts[1] || '');
          const subform = decodeURIComponent(parts[2] || '');
          const testTakerLogin = decodeURIComponent(parts[3] || '');
          const testTakerCode = decodeURIComponent(parts[4] || '');
          const testTakerGroup = decodeURIComponent(parts[5] || '');

          if (!unitName || !variableId || !testTakerLogin) {
            this.logger.warn(`Invalid duplicate resolution key parts: ${key}`);
            continue;
          }

          const responses = await manager
            .createQueryBuilder(ResponseEntity, 'response')
            .innerJoin('response.unit', 'unit')
            .innerJoin('unit.booklet', 'booklet')
            .innerJoin('booklet.person', 'person')
            .where('person.workspace_id = :workspaceId', { workspaceId })
            .andWhere('person.consider = :consider', { consider: true })
            .andWhere('person.login = :testTakerLogin', { testTakerLogin })
            .andWhere('COALESCE(person.code, \'\') = :testTakerCode', {
              testTakerCode: testTakerCode || ''
            })
            .andWhere('COALESCE(person.group, \'\') = :testTakerGroup', {
              testTakerGroup: testTakerGroup || ''
            })
            .andWhere('unit.name = :unitName', { unitName })
            .andWhere('response.variableid = :variableId', { variableId })
            .andWhere("COALESCE(response.subform, '') = :subform", {
              subform: subform || ''
            })
            .select(['response.id', 'response.unitid'])
            .getMany();

          const ids = (responses || []).map(r => r.id);
          if (ids.length <= 1) {
            continue;
          }

          if (!ids.includes(selectedResponseId)) {
            this.logger.warn(
              `Selected responseId ${selectedResponseId} not part of duplicate group ${key}`
            );
            continue;
          }

          const deleteIds = ids.filter(id => id !== selectedResponseId);
          if (deleteIds.length === 0) {
            continue;
          }

          const unitId = responses[0]?.unitid;
          if (unitId) {
            affectedUnitIds.push(unitId);
          }

          await this.codingFreshnessService?.markCodingJobsStaleForResponseIds?.(
            workspaceId,
            deleteIds,
            'RESULT_DELETED',
            'review_required',
            manager
          );

          const deleteResult = await manager
            .createQueryBuilder()
            .delete()
            .from(ResponseEntity)
            .where('id IN (:...deleteIds)', { deleteIds })
            .execute();

          resolvedCount += deleteResult.affected || 0;

          await this.journalService.createEntry(
            userId,
            workspaceId,
            'delete',
            'response',
            selectedResponseId,
            {
              duplicateGroupKey: key,
              keptResponseId: selectedResponseId,
              deletedResponseIds: deleteIds
            }
          );
        }

        return {
          resolvedCount,
          success: true
        };
      }).then(async result => {
        if (result.success) {
          await this.codingFreshnessService?.markUnitsStaleAfterResultChange(
            workspaceId,
            affectedUnitIds,
            'RESULT_DELETED'
          );
          await Promise.all([
            this.workspaceTestResultsService.invalidateWorkspaceStatsCache(workspaceId),
            this.workspaceTestResultsService.invalidateCodingStatisticsCache(workspaceId)
          ]);
        }
        return result;
      });
    });
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
    return withWorkspaceTestResultsMutationLock(this.connection, workspaceId, async () => {
      let affectedUnitId: number | null = null;
      return this.connection.transaction(async manager => {
        const report = {
          deletedResponse: null,
          warnings: []
        };

        const response = await manager
          .createQueryBuilder(ResponseEntity, 'response')
          .leftJoinAndSelect('response.unit', 'unit')
          .leftJoinAndSelect('unit.booklet', 'booklet')
          .leftJoinAndSelect('booklet.person', 'person')
          .where('response.id = :responseId', { responseId })
          .andWhere('person.workspace_id = :workspaceId', { workspaceId })
          .getOne();

        if (!response) {
          const warningMessage = `Keine Antwort mit ID ${responseId} im Workspace ${workspaceId} gefunden`;
          this.logger.warn(warningMessage);
          report.warnings.push(warningMessage);
          return { success: false, report };
        }

        await this.codingFreshnessService?.markCodingJobsStaleForResponseIds?.(
          workspaceId,
          [responseId],
          'RESULT_DELETED',
          'review_required',
          manager
        );

        await manager
          .createQueryBuilder()
          .delete()
          .from(ResponseEntity)
          .where('id = :responseId', { responseId })
          .execute();

        report.deletedResponse = responseId;
        affectedUnitId = response.unit.id;

        try {
          await this.journalService.createEntry(
            userId,
            workspaceId,
            'delete',
            'response',
            responseId,
            {
              responseId,
              unitId: response.unit.id,
              unitName: response.unit.name,
              variableId: response.variableid,
              value: response.value,
              bookletId: response.unit.booklet?.id,
              personId: response.unit.booklet?.person?.id
            }
          );
        } catch (e) {
          this.logger.error(
            `Failed to create journal entry for response deletion: ${e.message}`
          );
        }

        return { success: true, report };
      }).then(async result => {
        if (result.success) {
          await this.codingFreshnessService?.markUnitsStaleAfterResultChange(
            workspaceId,
            affectedUnitId ? [affectedUnitId] : [],
            'RESULT_DELETED'
          );
          await Promise.all([
            this.workspaceTestResultsService.invalidateWorkspaceStatsCache(workspaceId),
            this.workspaceTestResultsService.invalidateCodingStatisticsCache(workspaceId)
          ]);
        }
        return result;
      });
    });
  }
}
