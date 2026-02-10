import {
  Injectable, Logger, Inject, forwardRef
} from '@nestjs/common';
import 'multer';
import * as csv from 'fast-csv';
import { Readable } from 'stream';
import * as fs from 'fs';
import { unlink } from 'fs/promises';
import { Job } from 'bull';
import {
  statusStringToNumber
} from '../../utils/response-status-converter';
import { FileIo } from '../../../admin/workspace/file-io.interface';
import { Log, Person, Response } from '../shared';
import { PersonService } from './person.service';
import {
  TestResultsUploadIssueDto,
  TestResultsUploadResultDto,
  TestResultsUploadStatsDto
} from '../../../../../../../api-dto/files/test-results-upload-result.dto';
import { TestResultsUploadJobDto } from '../../../../../../../api-dto/files/test-results-upload-job.dto';
import { JobQueueService, TestResultsUploadJobData } from '../../../job-queue/job-queue.service';

type PersonWithoutBooklets = Omit<Person, 'booklets'>;

@Injectable()
export class UploadResultsService {
  private readonly logger = new Logger(UploadResultsService.name);
  person: PersonWithoutBooklets[] = [];
  constructor(
    private readonly personService: PersonService,
    @Inject(forwardRef(() => JobQueueService))
    private readonly jobQueueService: JobQueueService
  ) {
  }

  private filterImportedPersons(
    persons: Person[],
    scope: 'person' | 'workspace' | 'group' | 'booklet' | 'unit' | 'response',
    filters?: { groupName?: string; bookletName?: string; unitNameOrAlias?: string; variableId?: string; subform?: string }
  ): Person[] {
    if (!Array.isArray(persons) || persons.length === 0) {
      return [];
    }

    const groupName = (filters?.groupName || '').trim();
    const bookletName = (filters?.bookletName || '').trim();
    const unitNameOrAlias = (filters?.unitNameOrAlias || '').trim();
    const variableId = (filters?.variableId || '').trim();
    const subform = (filters?.subform || '').trim();

    let filtered = persons;

    if (scope === 'group') {
      if (!groupName) {
        return [];
      }
      filtered = filtered.filter(p => (p.group || '') === groupName);
    }

    if (scope === 'booklet' || scope === 'unit' || scope === 'response') {
      if (scope === 'booklet' && !bookletName) return [];
      if (scope === 'unit' && !unitNameOrAlias) return [];
      if (scope === 'response' && (!variableId || subform === undefined)) return [];

      filtered = filtered.map(p => ({
        ...p,
        booklets: (p.booklets || [])
          .filter(b => {
            if (scope === 'booklet') {
              return (b.id || '') === bookletName;
            }
            return true;
          })
          .map(b => ({
            ...b,
            units: (b.units || [])
              .filter(u => {
                if (scope === 'unit') {
                  return (u.id || '') === unitNameOrAlias || (u.alias || '') === unitNameOrAlias;
                }
                return true;
              })
              .map(u => {
                if (scope !== 'response') {
                  return u;
                }
                return {
                  ...u,
                  subforms: (u.subforms || []).map(sf => {
                    if ((sf.id || '') !== subform) {
                      return { ...sf, responses: [] };
                    }
                    return {
                      ...sf,
                      responses: (sf.responses || []).filter(r => (r.id || '') === variableId)
                    };
                  })
                };
              })
          }))
      }));

      // Clean empty structures
      filtered = filtered
        .map(p => ({
          ...p,
          booklets: (p.booklets || [])
            .map(b => ({
              ...b,
              units: (b.units || []).filter(u => {
                if (scope !== 'response') return true;
                return (u.subforms || []).some(sf => (sf.responses || []).length > 0);
              })
            }))
            .filter(b => (b.units || []).length > 0)
        }))
        .filter(p => (p.booklets || []).length > 0);
    }

    return filtered;
  }

  async processUpload(
    job: Job<TestResultsUploadJobData>
  ): Promise<TestResultsUploadResultDto> {
    const {
      workspaceId,
      file,
      resultType,
      overwriteExisting,
      personMatchMode,
      overwriteMode,
      scope,
      scopeFilters
    } = job.data;

    this.logger.log(`Processing upload job ${job.id} for workspace ${workspaceId}, file: ${file.originalname}`);

    const before = await this.personService.getWorkspaceUploadStats(workspaceId);
    // Initialize aggregation structures locally for this job
    const expectedAgg = {
      persons: new Set<string>(),
      groups: new Set<string>(),
      booklets: new Set<string>(),
      units: new Set<string>(),
      responses: new Set<string>()
    };
    const issues: TestResultsUploadIssueDto[] = [];
    const logMetricsAgg = {
      allBooklets: new Set<string>(),
      bookletsWithLogs: new Set<string>(),
      allUnits: new Set<string>(),
      unitsWithLogs: new Set<string>()
    };

    const statusCounts: Record<string, number> = {};

    try {
      const validMimeTypes = [
        'text/csv',
        'application/csv',
        'application/vnd.ms-excel',
        'text/plain',
        'text/x-csv',
        'application/x-csv',
        'text/comma-separated-values',
        'text/x-comma-separated-values'
      ];

      if (validMimeTypes.includes(file.mimetype)) {
        let fileStream: Readable;
        if (file.path) {
          this.logger.log(`Reading from file: ${file.path}`);
          fileStream = fs.createReadStream(file.path);

          if (file.size) {
            this.logger.log(`File size: ${file.size}`);
            let bytesRead = 0;
            let lastProgress = 0;
            fileStream.on('data', (chunk: Buffer) => {
              bytesRead += chunk.length;
              const progress = Math.round((bytesRead / file.size) * 100);
              if (progress > lastProgress) {
                lastProgress = progress;
                job.progress(progress).catch(err => {
                  this.logger.warn(`Failed to update job progress: ${err.message}`);
                });
              }
            });
          } else {
            this.logger.warn(`File size missing for ${file.originalname}, progress tracking disabled.`);
          }
        } else {
          throw new Error('File path missing in job data');
        }

        if (resultType === 'logs') {
          await this.handleCsvStream<Log>(fileStream, resultType, async rowData => {
            // ... (Same logic as uploadFile for logs)
            rowData.forEach((row, rowIndex) => {
              const groupname = row.groupname || '';
              const loginname = row.loginname || '';
              const code = row.code || '';
              const personKey = personMatchMode === 'loose' ? `${loginname}@@${code}` : `${groupname}@@${loginname}@@${code}`;
              expectedAgg.persons.add(personKey);
              expectedAgg.groups.add(groupname);
              if (row.bookletname) {
                expectedAgg.booklets.add(row.bookletname);
                logMetricsAgg.allBooklets.add(row.bookletname);
              }
              const unitKey = row.unitname || '';
              if (unitKey) {
                expectedAgg.units.add(unitKey);
              }

              if (row.bookletname && row.unitname === '') {
                logMetricsAgg.bookletsWithLogs.add(row.bookletname);
              } else if (row.bookletname && row.unitname) {
                const uKey = `${row.bookletname}@@@${unitKey}`;
                logMetricsAgg.allUnits.add(uKey);
                logMetricsAgg.unitsWithLogs.add(uKey);
              }

              if (!groupname || !loginname || !code) {
                issues.push({
                  level: 'warning',
                  message: 'Missing group/login/code in row',
                  fileName: file.originalname,
                  rowIndex
                });
              }
            });

            const { bookletLogs, unitLogs } = rowData.reduce(
              (acc, row) => {
                row.unitname === '' ? acc.bookletLogs.push(row) : acc.unitLogs.push(row);
                return acc;
              },
              { bookletLogs: [] as Log[], unitLogs: [] as Log[] }
            );
            const personList = (await this.personService.createPersonList(rowData, workspaceId)).map(p => {
              const pWithBooklets = this.personService.assignBookletLogsToPerson(p, rowData, issues, file.originalname);
              pWithBooklets.booklets = pWithBooklets.booklets.map(b => this.personService.assignUnitLogsToBooklet(b, rowData, issues, file.originalname)
              );
              return pWithBooklets;
            });
            const result = await this.personService.processPersonLogs(personList, unitLogs, bookletLogs, overwriteExisting);
            if (result.issues) {
              issues.push(...result.issues);
            }
          });
        } else if (resultType === 'responses') {
          await this.handleCsvStream<Response>(fileStream, resultType, async rowData => {
            // ... (Same logic as uploadFile for responses)
            rowData.forEach((row, rowIndex) => {
              const groupname = row.groupname || '';
              const loginname = row.loginname || '';
              const code = row.code || '';
              const bookletname = row.bookletname || '';
              const unitKey = row.unitname || '';

              const personKey = personMatchMode === 'loose' ? `${loginname}@@${code}` : `${groupname}@@${loginname}@@${code}`;
              expectedAgg.persons.add(personKey);
              expectedAgg.groups.add(groupname);
              if (bookletname) {
                expectedAgg.booklets.add(bookletname);
              }
              if (unitKey) {
                expectedAgg.units.add(unitKey);
              }

              try {
                const chunks = typeof row.responses === 'string' ? JSON.parse(row.responses) : row.responses;
                if (Array.isArray(chunks)) {
                  chunks.forEach(chunk => {
                    if (!chunk || typeof chunk !== 'object') return;
                    const subForm = (chunk as { subForm?: string }).subForm || '';
                    const content = (chunk as { content?: string }).content;
                    if (!content || typeof content !== 'string') return;
                    try {
                      const chunkResponses = JSON.parse(content) as Array<{ id?: string; status?: string }>;
                      if (!Array.isArray(chunkResponses)) return;
                      chunkResponses.forEach(r => {
                        const responseId = r?.id || '';
                        if (!responseId) return;
                        const uniqueKey = `${personKey}@@${bookletname}@@${unitKey}@@${subForm}@@${responseId}`;
                        expectedAgg.responses.add(uniqueKey);

                        let status = r?.status;
                        if (!status) {
                          status = 'INVALID';
                          issues.push({
                            level: 'warning',
                            message: `Missing status (defaulting to INVALID) in response for ${uniqueKey}`,
                            fileName: file.originalname,
                            rowIndex,
                            category: 'missing_status'
                          });
                        } else if (statusStringToNumber(status) === null) {
                          issues.push({
                            level: 'warning',
                            message: `Invalid status '${status}' (defaulting to INVALID) in response for ${uniqueKey}`,
                            fileName: file.originalname,
                            rowIndex,
                            category: 'invalid_status'
                          });
                          status = 'INVALID';
                        }

                        statusCounts[status] = (statusCounts[status] || 0) + 1;
                      });
                    } catch {
                      issues.push({
                        level: 'warning',
                        message: 'Malformed chunk content JSON',
                        fileName: file.originalname,
                        rowIndex
                      });
                    }
                  });
                }
              } catch {
                issues.push({
                  level: 'warning',
                  message: 'Malformed responses JSON',
                  fileName: file.originalname,
                  rowIndex
                });
              }
            });

            const basePersons = await this.personService.createPersonList(rowData, workspaceId);
            const personsWithUnits = await Promise.all(
              basePersons.map(async person => {
                const personWithBooklets = await this.personService.assignBookletsToPerson(person, rowData, issues);
                return this.personService.assignUnitsToBookletAndPerson(personWithBooklets, rowData, issues);
              })
            );

            const filteredPersons = this.filterImportedPersons(personsWithUnits, scope, scopeFilters);
            await this.personService.processPersonBooklets(filteredPersons, workspaceId, overwriteMode, scope === 'workspace' ? 'workspace' : 'person');
          });
        }
        // Cleanup temp file
        // Cleanup temp file
        try {
          if (fs.existsSync(file.path)) {
            await unlink(file.path);
          }
        } catch (e) {
          this.logger.warn(`Failed to delete temp file ${file.path}: ${e.message}`);
        }
      } else {
        issues.push({ level: 'error', message: `Invalid mime type: ${file.mimetype}`, fileName: file.originalname });
      }
    } catch (e) {
      this.logger.error(`Error processing file ${file.originalname}: ${e.message}`);
      issues.push({ level: 'error', message: `Processing error: ${e.message}`, fileName: file.originalname });
    }

    const after = await this.personService.getWorkspaceUploadStats(workspaceId);
    const expected: TestResultsUploadStatsDto = {
      testPersons: expectedAgg.persons.size,
      testGroups: expectedAgg.groups.size,
      uniqueBooklets: expectedAgg.booklets.size,
      uniqueUnits: expectedAgg.units.size,
      uniqueResponses: expectedAgg.responses.size
    };

    const delta: TestResultsUploadStatsDto = {
      testPersons: after.testPersons - before.testPersons,
      testGroups: after.testGroups - before.testGroups,
      uniqueBooklets: after.uniqueBooklets - before.uniqueBooklets,
      uniqueUnits: after.uniqueUnits - before.uniqueUnits,
      uniqueResponses: after.uniqueResponses - before.uniqueResponses
    };

    const logMetrics = resultType === 'logs' ? {
      bookletsWithLogs: logMetricsAgg.bookletsWithLogs.size,
      totalBooklets: logMetricsAgg.allBooklets.size,
      unitsWithLogs: logMetricsAgg.unitsWithLogs.size,
      totalUnits: logMetricsAgg.allUnits.size,
      bookletDetails: Array.from(logMetricsAgg.allBooklets).map(name => ({
        name,
        hasLog: logMetricsAgg.bookletsWithLogs.has(name)
      })),
      unitDetails: Array.from(logMetricsAgg.allUnits).map(key => {
        const [bookletName, unitKey] = key.split('@@@');
        return {
          bookletName,
          unitKey,
          hasLog: logMetricsAgg.unitsWithLogs.has(key)
        };
      })
    } : undefined;

    return {
      expected,
      before,
      after,
      delta,
      responseStatusCounts: Object.keys(statusCounts).length ? statusCounts : undefined,
      issues: issues.length ? issues : undefined,
      logMetrics,
      importedLogs: resultType === 'logs',
      importedResponses: resultType === 'responses'
    };
  }

  async uploadTestResults(
    workspace_id: number,
    originalFiles: FileIo[],
    resultType: 'logs' | 'responses',
    overwriteExisting: boolean = true,
    personMatchMode?: 'strict' | 'loose',
    overwriteMode: 'skip' | 'merge' | 'replace' = 'skip',
    scope: 'person' | 'workspace' | 'group' | 'booklet' | 'unit' | 'response' = 'person',
    scopeFilters: { groupName?: string; bookletName?: string; unitNameOrAlias?: string; variableId?: string; subform?: string } | undefined = undefined
  ): Promise<TestResultsUploadJobDto[]> {
    if (!Array.isArray(originalFiles) || originalFiles.length === 0) {
      this.logger.error('The uploaded files parameter is not an array or is empty.');
      throw new Error('No files to upload');
    }

    this.logger.log(`Queueing upload jobs for workspace ${workspace_id} (files: ${originalFiles.length})`);

    const MAX_FILES_LENGTH = 1000;
    if (originalFiles.length > MAX_FILES_LENGTH) {
      this.logger.error(`Too many files to upload: ${originalFiles.length}`);
      throw new Error(`Too many files: ${originalFiles.length}`);
    }

    const jobPromises = originalFiles.map(file => {
      // Create lightweight job payload - prevent passing buffer to Redis
      const jobFile = { ...file };
      if (jobFile.buffer) {
        delete jobFile.buffer;
      }

      return this.jobQueueService.addUploadJob({
        workspaceId: workspace_id,
        file: jobFile,
        resultType,
        overwriteExisting,
        personMatchMode: personMatchMode || 'strict',
        overwriteMode,
        scope,
        scopeFilters
      });
    });

    const jobs = await Promise.all(jobPromises);
    const jobDtos = jobs.map(job => ({ jobId: job.id.toString() }));

    return jobDtos;
  }

  private handleCsvStream<T>(
    bufferStream: Readable,
    resultType: 'logs' | 'responses',
    onDataProcessed: (rowData: T[]) => Promise<void>
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let batch: T[] = [];
      const BATCH_SIZE = 500;
      this.logger.log(`Processing CSV stream for ${resultType} with batch size ${BATCH_SIZE}`);

      const stream = csv.parseStream(bufferStream, { headers: true, delimiter: ';', quote: resultType === 'logs' ? null : '"' })
        .transform((row: T) => {
          if (resultType === 'logs') {
            Object.keys(row).forEach(key => {
              if (typeof row[key] === 'string') {
                row[key] = row[key].replace(/"/g, '');
              }
            });
          }
          return row;
        })
        .on('error', error => {
          this.logger.error(`CSV Parsing Error: ${error.message}`);
          reject(error);
        })
        .on('data', async (row: T) => {
          batch.push(row);
          if (batch.length >= BATCH_SIZE) {
            stream.pause();
            try {
              await onDataProcessed(batch);
              batch = [];
            } catch (processError) {
              stream.destroy(processError);
              reject(processError);
            }
            stream.resume();
          }
        })
        .on('end', async () => {
          try {
            if (batch.length > 0) {
              await onDataProcessed(batch);
            }
            resolve();
          } catch (processError) {
            reject(processError);
          }
        });
    });
  }
}
