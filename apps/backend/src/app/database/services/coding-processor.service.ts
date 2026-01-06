import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  CodingScheme,
  VariableCodingData
} from '@iqbspecs/coding-scheme';
import * as Autocoder from '@iqb/responses';
import * as cheerio from 'cheerio';
import {
  statusNumberToString,
  statusStringToNumber
} from '../utils/response-status-converter';
import { Unit } from '../entities/unit.entity';
import { ResponseEntity } from '../entities/response.entity'; // CodingStatistics needs to be imported or redefined
import { CodingStatistics } from './shared-types';
import { CodingFileCache } from './coding-file-cache.service';
import { CodingJobManager } from './coding-job-manager.service';
import FileUpload from '../entities/file_upload.entity';

export interface CodedResponse {
  id: number;
  code_v1?: number;
  status_v1?: string;
  score_v1?: number;
  code_v3?: number;
  status_v3?: string;
  score_v3?: number;
}

@Injectable()
export class CodingProcessor {
  private readonly logger = new Logger(CodingProcessor.name);

  constructor(
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    private codingFileCache: CodingFileCache,
    private codingJobManager: CodingJobManager
  ) {}

  async processTestPersonsBatch() {
    // Intentionally left blank to decide where to put the orchestration.
  }

  // Moving core methods

  async updateResponsesInDatabase(
    allCodedResponses: CodedResponse[],
    queryRunner: import('typeorm').QueryRunner,
    jobId?: string,
    progressCallback?: (progress: number) => void,
    metrics?: { [key: string]: number }
  ): Promise<boolean> {
    if (allCodedResponses.length === 0) {
      // await queryRunner.release(); // Caller handles release if they provided it?
      // Original code released it. I should probably stick to original behavior or expect caller to manage it.
      // Original: await queryRunner.release(); return true;
      // It seems the method consumes the queryRunner.
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
          `Starte Aktualisierung für Batch #${index + 1} (Größe: ${
            batch.length
          }).`
        );

        if (jobId && (await this.codingJobManager.isJobCancelled(jobId))) {
          this.logger.log(
            `Job ${jobId} was cancelled or paused before updating batch #${
              index + 1
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
            `Batch #${index + 1} (Größe: ${
              batch.length
            }) erfolgreich aktualisiert.`
          );

          if (progressCallback) {
            const batchProgress = 95 + 5 * ((index + 1) / batches.length);
            progressCallback(Math.round(Math.min(batchProgress, 99)));
          }
        } catch (error) {
          this.logger.error(
            `Fehler beim Aktualisieren von Batch #${index + 1} (Größe: ${
              batch.length
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

  async processAndCodeResponses(
    units: Unit[],
    unitToResponsesMap: Map<number | string, ResponseEntity[]>,
    unitToCodingSchemeRefMap: Map<number, string>,
    fileIdToCodingSchemeMap: Map<string, CodingScheme>,
    allResponses: ResponseEntity[],
    statistics: CodingStatistics,
    autoCoderRun: number = 1,
    jobId?: string,
    queryRunner?: import('typeorm').QueryRunner,
    progressCallback?: (progress: number) => void
  ): Promise<{
      allCodedResponses: CodedResponse[];
      statistics: CodingStatistics;
    }> {
    const allCodedResponses = [];
    allCodedResponses.length = allResponses.length;
    let responseIndex = 0;
    const batchSize = 50;
    const emptyScheme = new CodingScheme({});

    for (let i = 0; i < units.length; i += batchSize) {
      const unitBatch = units.slice(i, i + batchSize);

      for (const unit of unitBatch) {
        const responses = unitToResponsesMap.get(unit.id) || [];
        if (responses.length === 0) continue;

        statistics.totalResponses += responses.length;
        const codingSchemeRef = unitToCodingSchemeRefMap.get(unit.id);
        const scheme = codingSchemeRef ?
          fileIdToCodingSchemeMap.get(codingSchemeRef) || emptyScheme :
          emptyScheme;

        const variableAliasToIdMap = new Map<string, string>();
        if (Array.isArray(scheme.variableCodings)) {
          scheme.variableCodings.forEach((vc: VariableCodingData) => {
            const key = (vc.alias ?? vc.id) as string | undefined;
            const value = vc.id as string | undefined;
            if (key && value) {
              variableAliasToIdMap.set(key, value);
            }
          });
        }

        for (const response of responses) {
          let inputStatus = response.status;
          if (autoCoderRun === 2) {
            inputStatus =
              response.status_v2 || response.status_v1 || response.status;
          }

          const variableAlias = String(response.variableid);
          const resolvedVariableId =
            variableAliasToIdMap.get(variableAlias) ?? variableAlias;

          // Resolve variable coding for both alias and ID
          const variableCoding = Array.isArray(scheme.variableCodings) ?
            scheme.variableCodings.find((vc: VariableCodingData) => {
              const key = (vc.alias ?? vc.id) as string | undefined;
              return key === variableAlias || key === resolvedVariableId;
            }) :
            undefined;

          const codedResult = Autocoder.CodingFactory.code(
            {
              id: response.variableid,
              value: response.value,
              status: statusNumberToString(inputStatus) || 'UNSET'
            },
            variableCoding
          );
          const codedStatus = codedResult?.status;
          if (!statistics.statusCounts[codedStatus]) {
            statistics.statusCounts[codedStatus] = 0;
          }
          statistics.statusCounts[codedStatus] += 1;

          const codedResponse: CodedResponse = {
            id: response.id
          };

          if (autoCoderRun === 1) {
            codedResponse.code_v1 = codedResult?.code;
            codedResponse.status_v1 = codedStatus;
            codedResponse.score_v1 = codedResult?.score;
          } else if (autoCoderRun === 2) {
            codedResponse.code_v3 = codedResult?.code;
            codedResponse.status_v3 = codedStatus;
            codedResponse.score_v3 = codedResult?.score;
          }

          allCodedResponses[responseIndex] = codedResponse;
          responseIndex += 1;
        }
      }

      if (jobId && (await this.codingJobManager.isJobCancelled(jobId))) {
        this.logger.log(
          `Job ${jobId} was cancelled or paused during response processing`
        );
        if (queryRunner) {
          await queryRunner.release();
        }
        return { allCodedResponses, statistics };
      }
    }

    allCodedResponses.length = responseIndex;

    if (progressCallback) {
      progressCallback(95);
    }

    return { allCodedResponses, statistics };
  }

  async getCodingSchemeFiles(
    codingSchemeRefs: Set<string>,
    jobId?: string,
    queryRunner?: import('typeorm').QueryRunner
  ): Promise<Map<string, CodingScheme>> {
    const fileIdToCodingSchemeMap = await this.codingFileCache.getCodingSchemesWithCache([
      ...codingSchemeRefs
    ]);
    if (jobId && (await this.codingJobManager.isJobCancelled(jobId))) {
      this.logger.log(
        `Job ${jobId} was cancelled or paused after getting coding scheme files`
      );
      if (queryRunner) {
        await queryRunner.release();
      }
      return fileIdToCodingSchemeMap;
    }

    return fileIdToCodingSchemeMap;
  }

  async extractCodingSchemeReferences(
    units: Unit[],
    fileIdToTestFileMap: Map<string, FileUpload>,
    jobId?: string,
    queryRunner?: import('typeorm').QueryRunner
  ): Promise<{
      codingSchemeRefs: Set<string>;
      unitToCodingSchemeRefMap: Map<number, string>;
    }> {
    const codingSchemeRefs = new Set<string>();
    const unitToCodingSchemeRefMap = new Map<number, string>();
    const batchSize = 50;

    for (let i = 0; i < units.length; i += batchSize) {
      const unitBatch = units.slice(i, i + batchSize);

      for (const unit of unitBatch) {
        const testFile = fileIdToTestFileMap.get(unit.alias.toUpperCase());
        if (!testFile) continue;

        try {
          const $ = cheerio.load(testFile.data);
          const codingSchemeRefText = $('codingSchemeRef').text();
          if (codingSchemeRefText) {
            const codingSchemeRefUpper = codingSchemeRefText.toUpperCase();
            codingSchemeRefs.add(codingSchemeRefUpper);
            unitToCodingSchemeRefMap.set(unit.id, codingSchemeRefUpper);
            this.logger.debug(
              `Extracted coding scheme mapping: unitId=${
                unit.id
              }, unitAlias=${unit.alias.toUpperCase()}, codingSchemeRef=${codingSchemeRefUpper}`
            );
          }
        } catch (error) {
          this.logger.error(
            `--- Fehler beim Verarbeiten der Datei ${testFile.filename}: ${error.message}`
          );
        }
      }
      if (jobId && (await this.codingJobManager.isJobCancelled(jobId))) {
        this.logger.log(
          `Job ${jobId} was cancelled or paused during scheme extraction`
        );
        if (queryRunner) {
          await queryRunner.release();
        }
        return { codingSchemeRefs, unitToCodingSchemeRefMap };
      }
    }

    return { codingSchemeRefs, unitToCodingSchemeRefMap };
  }
}
