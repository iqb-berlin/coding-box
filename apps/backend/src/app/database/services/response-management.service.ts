import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, QueryRunner } from 'typeorm';
import { ResponseEntity } from '../entities/response.entity';
import { JournalService } from './journal.service';
import { CodedResponse } from './shared-types';
import { statusStringToNumber } from '../utils/response-status-converter';

@Injectable()
export class ResponseManagementService {
  private readonly logger = new Logger(ResponseManagementService.name);

  constructor(
    @InjectRepository(ResponseEntity)
    private readonly responseRepository: Repository<ResponseEntity>,
    private readonly connection: DataSource,
    private readonly journalService: JournalService
  ) { }

  async updateResponsesInDatabase(
    allCodedResponses: CodedResponse[],
    queryRunner: QueryRunner,
    jobId?: string,
    isJobCancelled?: (jobId: string) => Promise<boolean>,
    progressCallback?: (progress: number) => void,
    metrics?: { [key: string]: number }
  ): Promise<boolean> {
    if (allCodedResponses.length === 0) {
      await queryRunner.release();
      return true;
    }
    const updateStart = Date.now();
    try {
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
              const updateData: Partial<
              Pick<
              ResponseEntity,
              | 'code_v1'
              | 'status_v1'
              | 'score_v1'
              | 'code_v3'
              | 'status_v3'
              | 'score_v3'
              >
              > = {};

              if (response.code_v1 !== undefined) {
                updateData.code_v1 = response.code_v1;
              }
              if (response.status_v1 !== undefined) {
                updateData.status_v1 = statusStringToNumber(response.status_v1);
              }
              if (response.score_v1 !== undefined) {
                updateData.score_v1 = response.score_v1;
              }

              if (response.code_v3 !== undefined) {
                updateData.code_v3 = response.code_v3;
              }
              if (response.status_v3 !== undefined) {
                const statusNumber = statusStringToNumber(response.status_v3);
                updateData.status_v3 = statusNumber;
                this.logger.debug(
                  `Response ${response.id}: status_v3='${response.status_v3}' -> statusNumber=${statusNumber}`
                );
              }
              if (response.score_v3 !== undefined) {
                updateData.score_v3 = response.score_v3;
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

      await queryRunner.commitTransaction();
      this.logger.log(
        `${allCodedResponses.length} Responses wurden erfolgreich aktualisiert.`
      );

      if (metrics) {
        metrics.update = Date.now() - updateStart;
      }

      await queryRunner.release();
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

    return this.connection.transaction(async manager => {
      let resolvedCount = 0;

      for (const [key, selectedResponseId] of Object.entries(resolutionMap)) {
        if (!selectedResponseId) {
          continue;
        }

        const parts = key.split('|');
        if (parts.length !== 4) {
          this.logger.warn(`Invalid duplicate resolution key: ${key}`);
          continue;
        }

        const unitId = Number(parts[0]);
        const variableId = decodeURIComponent(parts[1] || '');
        const subform = decodeURIComponent(parts[2] || '');
        const testTakerLogin = decodeURIComponent(parts[3] || '');

        if (!unitId || Number.isNaN(unitId) || !variableId || !testTakerLogin) {
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
          .andWhere('unit.id = :unitId', { unitId })
          .andWhere('response.variableid = :variableId', { variableId })
          .andWhere("COALESCE(response.subform, '') = :subform", {
            subform: subform || ''
          })
          .select(['response.id'])
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

      await manager
        .createQueryBuilder()
        .delete()
        .from(ResponseEntity)
        .where('id = :responseId', { responseId })
        .execute();

      report.deletedResponse = responseId;

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
    });
  }
}
