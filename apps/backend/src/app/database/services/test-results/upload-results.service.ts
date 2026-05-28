import {
  Injectable, Logger, Inject, forwardRef, Optional
} from '@nestjs/common';
import 'multer';
import * as csv from 'fast-csv';
import { Readable } from 'stream';
import * as fs from 'fs';
import { unlink } from 'fs/promises';
import { Job } from 'bull';
import { DataSource } from 'typeorm';
import {
  statusStringToNumber
} from '../../utils/response-status-converter';
import { FileIo } from '../../../admin/workspace/file-io.interface';
import { Log, Person, Response } from '../shared';
import { PersonService } from './person.service';
import {
  TestResultsUploadIssueDto,
  TestResultsUploadResultDto,
  TestResultsUploadSummaryDto,
  TestResultsUploadStatsDto
} from '../../../../../../../api-dto/files/test-results-upload-result.dto';
import { TestResultsUploadJobDto } from '../../../../../../../api-dto/files/test-results-upload-job.dto';
import { JobQueueService, TestResultsUploadJobData } from '../../../job-queue/job-queue.service';
import { WorkspaceTestResultsService } from './workspace-test-results.service';
import { CodingFreshnessService } from '../coding/coding-freshness.service';
import { CodingAnalysisService } from '../coding/coding-analysis.service';
import { withWorkspaceTestResultsMutationLock } from '../shared/workspace-test-results-lock.util';

type PersonWithoutBooklets = Omit<Person, 'booklets'>;

type UploadSummaryAccumulator = {
  totalRows: number;
  responseRows: number;
  logRows: number;
  bookletLogRows: number;
  unitLogRows: number;
  savedResponses: number;
  deletedResponses: number;
  skippedExistingUnitIds: Set<number>;
  skippedExistingResponses: number;
  addedUnitIds: Set<number>;
  changedUnitIds: Set<number>;
  savedLogs: number;
  skippedRows: number;
  skippedLogs: number;
};

type LogRowWarningStats = {
  zeroTimestampRows: number;
};

@Injectable()
export class UploadResultsService {
  private readonly logger = new Logger(UploadResultsService.name);
  person: PersonWithoutBooklets[] = [];
  constructor(
    private readonly personService: PersonService,
    @Inject(forwardRef(() => JobQueueService))
    private readonly jobQueueService: JobQueueService,
    private readonly workspaceTestResultsService: WorkspaceTestResultsService,
    private readonly connection: DataSource,
    @Optional()
    private readonly codingFreshnessService?: CodingFreshnessService,
    @Optional()
    private readonly codingAnalysisService?: CodingAnalysisService
  ) {
  }

  private emptyUploadStats(): TestResultsUploadStatsDto {
    return {
      testPersons: 0,
      testGroups: 0,
      uniqueBooklets: 0,
      uniqueUnits: 0,
      uniqueResponses: 0
    };
  }

  private async readWorkspaceUploadStats(
    workspaceId: number,
    phase: 'before' | 'after',
    issues: TestResultsUploadIssueDto[]
  ): Promise<{ stats: TestResultsUploadStatsDto; failed: boolean }> {
    try {
      return {
        stats: await this.personService.getWorkspaceUploadStats(workspaceId),
        failed: false
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Could not read upload stats ${phase} import: ${detail}`);
      issues.push({
        level: 'warning',
        category: 'other',
        message:
          'Die Datenbankstatistik konnte nicht zuverlässig gelesen werden. Die Übersicht kann sich nach Aktualisierung noch ändern.'
      });

      return {
        stats: this.emptyUploadStats(),
        failed: true
      };
    }
  }

  private async invalidateWorkspaceOverviewCache(
    workspaceId: number,
    issues: TestResultsUploadIssueDto[]
  ): Promise<boolean> {
    try {
      await this.workspaceTestResultsService.invalidateWorkspaceStatsCache(workspaceId);
      return false;
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Could not invalidate workspace overview cache after import: ${detail}`);
      issues.push({
        level: 'warning',
        category: 'other',
        message:
          'Die Ergebnisdaten wurden verarbeitet, aber der Übersichtscache konnte nicht zuverlässig aktualisiert werden. Die Übersicht kann sich nach Aktualisierung noch ändern.'
      });
      return true;
    }
  }

  private async invalidateCodingCachesAfterResponsesImport(
    workspaceId: number,
    issues: TestResultsUploadIssueDto[]
  ): Promise<void> {
    try {
      await Promise.all([
        this.codingAnalysisService?.invalidateCache(workspaceId),
        this.workspaceTestResultsService.invalidateCodingStatisticsCache(workspaceId)
      ]);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Could not invalidate coding caches after responses import: ${detail}`);
      issues.push({
        level: 'warning',
        category: 'other',
        message:
          'Die Ergebnisdaten wurden verarbeitet, aber Kodierstatistiken oder Antwort-Analyse konnten nicht zuverlässig aktualisiert werden. Die Werte können sich nach Aktualisierung noch ändern.'
      });
    }
  }

  private responseImportMutatedTestResults(mutationSummary: {
    addedUnitIds?: number[];
    changedUnitIds?: number[];
    addedResponseIds?: number[];
    addedResponseCount?: number;
    changedResponseCount?: number;
    savedResponseCount?: number;
  }): boolean {
    return (mutationSummary.addedUnitIds?.length || 0) > 0 ||
      (mutationSummary.changedUnitIds?.length || 0) > 0 ||
      (mutationSummary.addedResponseIds?.length || 0) > 0 ||
      (mutationSummary.addedResponseCount || 0) > 0 ||
      (mutationSummary.changedResponseCount || 0) > 0 ||
      (mutationSummary.savedResponseCount || 0) > 0;
  }

  private createUploadSummaryAccumulator(): UploadSummaryAccumulator {
    return {
      totalRows: 0,
      responseRows: 0,
      logRows: 0,
      bookletLogRows: 0,
      unitLogRows: 0,
      savedResponses: 0,
      deletedResponses: 0,
      skippedExistingUnitIds: new Set<number>(),
      skippedExistingResponses: 0,
      addedUnitIds: new Set<number>(),
      changedUnitIds: new Set<number>(),
      savedLogs: 0,
      skippedRows: 0,
      skippedLogs: 0
    };
  }

  private normalizeCsvHeader(header: string): string {
    return String(header || '').replace(/^\uFEFF/, '').trim();
  }

  private expectedCsvHeaders(resultType: 'logs' | 'responses'): string[] {
    return resultType === 'logs' ?
      ['groupname', 'loginname', 'code', 'bookletname', 'unitname', 'timestamp', 'logentry'] :
      ['groupname', 'loginname', 'code', 'bookletname', 'unitname', 'responses', 'laststate'];
  }

  private validateCsvHeaders(
    headers: string[],
    resultType: 'logs' | 'responses',
    fileName: string,
    issues: TestResultsUploadIssueDto[]
  ): boolean {
    const normalizedHeaders = new Set(headers.map(header => this.normalizeCsvHeader(header)));
    const missingHeaders = this.expectedCsvHeaders(resultType)
      .filter(header => !normalizedHeaders.has(header));

    if (missingHeaders.length === 0) {
      return true;
    }

    issues.push({
      level: 'error',
      category: 'csv_columns',
      fileName,
      message: `Missing required CSV column(s): ${missingHeaders.join(', ')}`
    });

    return false;
  }

  private getLogPersonBookletKey(row: Log): string {
    return [
      row.groupname || '',
      row.loginname || '',
      row.code || '',
      row.bookletname || ''
    ].join('@@');
  }

  private addLogRowWarnings(
    row: Log,
    rowIndex: number,
    fileName: string,
    issues: TestResultsUploadIssueDto[],
    bookletLogKeys: Set<string>,
    missingBookletLogWarnings: Set<string>,
    warningStats: LogRowWarningStats
  ): boolean {
    let rowCannotBeImported = false;
    const missingIdentityFields = [
      !row.groupname ? 'groupname' : '',
      !row.loginname ? 'loginname' : ''
    ].filter(Boolean);

    if (missingIdentityFields.length > 0) {
      issues.push({
        level: 'warning',
        category: 'missing_identity',
        message: `Missing ${missingIdentityFields.join(', ')} in log row; person assignment may be incomplete.`,
        fileName,
        rowIndex
      });
    }

    if (!row.bookletname) {
      rowCannotBeImported = true;
      issues.push({
        level: 'warning',
        category: 'missing_booklet',
        message: 'Missing bookletname in log row; the row cannot be assigned to a booklet.',
        fileName,
        rowIndex
      });
    }

    if (!row.logentry) {
      rowCannotBeImported = true;
      issues.push({
        level: 'warning',
        category: 'log_format',
        message: 'Missing logentry in log row; the row cannot be imported as a log entry.',
        fileName,
        rowIndex
      });
    }

    const timestamp = String(row.timestamp ?? '').trim();
    if (!timestamp) {
      issues.push({
        level: 'warning',
        category: 'timestamp',
        message: 'Missing timestamp in log row.',
        fileName,
        rowIndex
      });
    } else if (Number(timestamp) === 0) {
      warningStats.zeroTimestampRows += 1;
    }

    if (row.unitname && row.bookletname) {
      const personBookletKey = this.getLogPersonBookletKey(row);
      if (!bookletLogKeys.has(personBookletKey) && !missingBookletLogWarnings.has(personBookletKey)) {
        missingBookletLogWarnings.add(personBookletKey);
        issues.push({
          level: 'warning',
          category: 'missing_booklet_log',
          message: `Unit logs for booklet "${row.bookletname}" have no matching booklet-level log row in this import; they will be imported as unit logs only.`,
          fileName,
          rowIndex
        });
      }
    }

    return rowCannotBeImported;
  }

  private addAggregatedLogRowWarnings(
    fileName: string,
    issues: TestResultsUploadIssueDto[],
    warningStats: LogRowWarningStats
  ): void {
    if (warningStats.zeroTimestampRows > 0) {
      const plural = warningStats.zeroTimestampRows === 1 ? 'entry has' : 'entries have';
      issues.push({
        level: 'warning',
        category: 'timestamp',
        message: `${warningStats.zeroTimestampRows} log ${plural} timestamp 0; chronological replay views may place these entries at the Unix epoch.`,
        fileName
      });
    }
  }

  private countIssues(issues: TestResultsUploadIssueDto[]): TestResultsUploadSummaryDto['issueCounts'] | undefined {
    if (issues.length === 0) {
      return undefined;
    }

    return issues.reduce<NonNullable<TestResultsUploadSummaryDto['issueCounts']>>((acc, issue) => {
      const category = issue.category || 'uncategorized';
      acc[category] = (acc[category] || 0) + 1;
      return acc;
    }, {});
  }

  private buildImportSummary(
    resultType: 'logs' | 'responses',
    summary: UploadSummaryAccumulator,
    issues: TestResultsUploadIssueDto[],
    overwriteMode: 'skip' | 'merge' | 'replace' = 'skip',
    scope: 'person' | 'workspace' | 'group' | 'booklet' | 'unit' | 'response' = 'person'
  ): TestResultsUploadSummaryDto | undefined {
    const issueCounts = this.countIssues(issues);
    const hasResponseSummary = resultType === 'responses' && (
      summary.responseRows > 0 ||
      summary.savedResponses > 0 ||
      summary.deletedResponses > 0 ||
      summary.skippedExistingUnitIds.size > 0 ||
      summary.skippedExistingResponses > 0 ||
      summary.addedUnitIds.size > 0 ||
      summary.changedUnitIds.size > 0
    );

    if (summary.totalRows === 0 && !issueCounts && !hasResponseSummary) {
      return undefined;
    }

    const baseSummary: TestResultsUploadSummaryDto = {
      totalRows: summary.totalRows,
      skippedRows: summary.skippedRows || undefined,
      issueCounts
    };

    if (resultType === 'logs') {
      return {
        ...baseSummary,
        logRows: summary.logRows,
        bookletLogRows: summary.bookletLogRows,
        unitLogRows: summary.unitLogRows,
        savedLogs: summary.savedLogs || undefined,
        skippedLogs: summary.skippedLogs || undefined
      };
    }

    return {
      ...baseSummary,
      overwriteMode,
      scope,
      responseRows: summary.responseRows,
      savedResponses: summary.savedResponses,
      deletedResponses: summary.deletedResponses || undefined,
      skippedExistingUnits: overwriteMode === 'skip' ?
        summary.skippedExistingUnitIds.size :
        undefined,
      skippedExistingResponses: summary.skippedExistingResponses || undefined,
      addedUnits: summary.addedUnitIds.size || undefined,
      changedUnits: summary.changedUnitIds.size || undefined
    };
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

    const issues: TestResultsUploadIssueDto[] = [];
    const beforeStats = await this.readWorkspaceUploadStats(workspaceId, 'before', issues);
    const before = beforeStats.stats;
    let overviewPending = beforeStats.failed;
    const importSummaryAgg = this.createUploadSummaryAccumulator();
    // Initialize aggregation structures locally for this job
    const expectedAgg = {
      persons: new Set<string>(),
      groups: new Set<string>(),
      booklets: new Set<string>(),
      units: new Set<string>(),
      responses: new Set<string>()
    };
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
          await this.handleCsvStream<Log>(fileStream, resultType, issues, file.originalname, async rowData => {
            const bookletLogKeys = new Set(
              rowData
                .filter(row => row.unitname === '' && row.bookletname)
                .map(row => this.getLogPersonBookletKey(row))
            );
            const missingBookletLogWarnings = new Set<string>();
            const warningStats: LogRowWarningStats = {
              zeroTimestampRows: 0
            };

            rowData.forEach((row, rowIndex) => {
              const groupname = row.groupname || '';
              const loginname = row.loginname || '';
              const code = row.code || '';
              const personKey = personMatchMode === 'loose' ? `${loginname}@@${code}` : `${groupname}@@${loginname}@@${code}`;
              const isBookletLog = row.unitname === '';
              importSummaryAgg.totalRows += 1;
              importSummaryAgg.logRows += 1;
              if (isBookletLog) {
                importSummaryAgg.bookletLogRows += 1;
              } else {
                importSummaryAgg.unitLogRows += 1;
              }

              if (this.addLogRowWarnings(
                row,
                rowIndex,
                file.originalname,
                issues,
                bookletLogKeys,
                missingBookletLogWarnings,
                warningStats
              )) {
                importSummaryAgg.skippedRows += 1;
              }

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
            });
            this.addAggregatedLogRowWarnings(file.originalname, issues, warningStats);

            const { bookletLogs, unitLogs } = rowData.reduce(
              (acc, row) => {
                row.unitname === '' ? acc.bookletLogs.push(row) : acc.unitLogs.push(row);
                return acc;
              },
              { bookletLogs: [] as Log[], unitLogs: [] as Log[] }
            );
            const personList = (await this.personService.createPersonList(rowData, workspaceId)).map(p => {
              const pWithBooklets = this.personService.assignBookletLogsToPerson(p, bookletLogs, issues, file.originalname);
              const personUnitLogs = this.personService.filterLogRowsForPerson(unitLogs, p);
              this.personService.ensureBookletsForUnitLogs(pWithBooklets, personUnitLogs);
              pWithBooklets.booklets = pWithBooklets.booklets.map(b => this.personService.assignUnitLogsToBooklet(b, personUnitLogs, issues, file.originalname)
              );
              return pWithBooklets;
            });
            const result = await this.personService.processPersonLogs(personList, unitLogs, bookletLogs, overwriteExisting);
            importSummaryAgg.savedLogs += result.totalLogsSaved || 0;
            importSummaryAgg.skippedLogs += result.totalLogsSkipped || 0;
            if (result.issues) {
              issues.push(...result.issues);
            }
          });
        } else if (resultType === 'responses') {
          let responsesImportMutatedData = false;
          try {
            await this.handleCsvStream<Response>(fileStream, resultType, issues, file.originalname, async rowData => {
              // ... (Same logic as uploadFile for responses)
              rowData.forEach((row, rowIndex) => {
                importSummaryAgg.totalRows += 1;
                importSummaryAgg.responseRows += 1;

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
                  importSummaryAgg.skippedRows += 1;
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
              await withWorkspaceTestResultsMutationLock(this.connection, workspaceId, async () => {
                const mutationSummary = await this.personService.processPersonBooklets(
                  filteredPersons,
                  workspaceId,
                  overwriteMode,
                  scope === 'workspace' ? 'workspace' : 'person'
                ) || {
                  addedUnitIds: [],
                  changedUnitIds: [],
                  addedResponseIds: [],
                  addedResponseCount: 0,
                  changedResponseCount: 0
                };
                responsesImportMutatedData = responsesImportMutatedData ||
                  this.responseImportMutatedTestResults(mutationSummary);
                importSummaryAgg.savedResponses += mutationSummary.savedResponseCount || 0;
                importSummaryAgg.deletedResponses += mutationSummary.deletedResponseCount || 0;
                importSummaryAgg.skippedExistingResponses += mutationSummary.skippedExistingResponseCount || 0;
                (mutationSummary.skippedExistingUnitIds || [])
                  .forEach(unitId => importSummaryAgg.skippedExistingUnitIds.add(unitId));
                (mutationSummary.addedUnitIds || [])
                  .forEach(unitId => importSummaryAgg.addedUnitIds.add(unitId));
                (mutationSummary.changedUnitIds || [])
                  .forEach(unitId => importSummaryAgg.changedUnitIds.add(unitId));
                await this.codingFreshnessService?.markUnitsPendingAfterImport(
                  workspaceId,
                  mutationSummary.addedUnitIds,
                  mutationSummary.addedResponseCount
                );
                if ((mutationSummary.addedResponseIds?.length || 0) > 0) {
                  await this.codingFreshnessService?.markResponsesPendingAfterImport?.(
                    workspaceId,
                    mutationSummary.addedResponseIds || []
                  );
                }
                await this.codingFreshnessService?.markUnitsStaleAfterResultChange(
                  workspaceId,
                  mutationSummary.changedUnitIds,
                  'RESULT_UPDATED'
                );
              });
            });
          } finally {
            if (responsesImportMutatedData) {
              await this.invalidateCodingCachesAfterResponsesImport(workspaceId, issues);
            }
          }
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

    overviewPending = overviewPending ||
      await this.invalidateWorkspaceOverviewCache(workspaceId, issues);

    const afterStats = await this.readWorkspaceUploadStats(workspaceId, 'after', issues);
    const after = afterStats.stats;
    overviewPending = overviewPending || afterStats.failed;
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

    if (
      resultType === 'logs' &&
      importSummaryAgg.logRows > 0 &&
      importSummaryAgg.savedLogs === 0
    ) {
      issues.push({
        level: 'warning',
        category: 'no_logs_saved',
        fileName: file.originalname,
        message:
          'Es wurden Log-Zeilen gelesen, aber keine Logs gespeichert. Prüfen Sie, ob die zugehörigen Testergebnisse bereits importiert sind.'
      });
    }

    return {
      expected,
      before,
      after,
      delta,
      responseStatusCounts: Object.keys(statusCounts).length ? statusCounts : undefined,
      issues: issues.length ? issues : undefined,
      importSummary: this.buildImportSummary(resultType, importSummaryAgg, issues, overwriteMode, scope),
      logMetrics,
      importedLogs: resultType === 'logs',
      importedResponses: resultType === 'responses',
      overviewPending: overviewPending || undefined,
      overviewMessage: overviewPending ?
        'Die Daten wurden verarbeitet, aber die aggregierten Datenbankzahlen konnten noch nicht zuverlässig gelesen werden.' :
        undefined
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

    await this.jobQueueService.assertNoActiveUploadForWorkspace(workspace_id);
    await this.jobQueueService.assertNoDependencyConflicts('test-results-upload', workspace_id);

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

  private normalizeLogCsvValue(value: string, key?: string): string {
    const trimmed = value.trim();
    const normalizedValue = trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"') ?
      trimmed
        .substring(1, trimmed.length - 1)
        .replace(/""/g, '"') :
      value;

    return key === 'logentry' ? normalizedValue : normalizedValue.trim();
  }

  private handleCsvStream<T>(
    bufferStream: Readable,
    resultType: 'logs' | 'responses',
    issues: TestResultsUploadIssueDto[],
    fileName: string,
    onDataProcessed: (rowData: T[]) => Promise<void>
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let batch: T[] = [];
      let headersValid = true;
      const BATCH_SIZE = 500;
      const processInBatches = resultType !== 'logs';
      this.logger.log(
        processInBatches ?
          `Processing CSV stream for ${resultType} with batch size ${BATCH_SIZE}` :
          `Processing CSV stream for ${resultType} in a single file pass`
      );

      const stream = csv.parseStream(bufferStream, { headers: true, delimiter: ';', quote: resultType === 'logs' ? null : '"' })
        .on('headers', (headers: string[]) => {
          headersValid = this.validateCsvHeaders(headers, resultType, fileName, issues);
          if (!headersValid) {
            this.logger.warn(`Skipping CSV import for ${fileName} because required columns are missing.`);
          }
        })
        .transform((row: T) => {
          if (resultType === 'logs') {
            const record = row as Record<string, unknown>;
            Object.keys(record).forEach(key => {
              if (typeof record[key] === 'string') {
                record[key] = this.normalizeLogCsvValue(record[key], key);
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
          if (!headersValid) {
            return;
          }
          batch.push(row);
          if (processInBatches && batch.length >= BATCH_SIZE) {
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
            if (!headersValid) {
              resolve();
              return;
            }
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
