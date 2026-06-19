import { Injectable, Logger, Optional } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { DataSource } from 'typeorm';
import * as https from 'https';
import { catchError, firstValueFrom } from 'rxjs';
import { Person, Response, Log } from '../shared';

import { TestGroupsInfoDto } from '../../../../../../../api-dto/files/test-groups-info.dto';
import { PersonService } from './person.service';
import { WorkspaceFilesService } from '../workspace/workspace-files.service';
import { TestResultsUploadIssueDto } from '../../../../../../../api-dto/files/test-results-upload-result.dto';
import { ImportOptionsDto as ImportOptions, ImportResultDto as Result } from '../../../../../../../api-dto/files/import-options.dto';

import {
  TestFilesUploadResultDto,
  TestFilesUploadUploadedDto,
  TestFilesUploadFailedDto
} from '../../../../../../../api-dto/files/test-files-upload-result.dto';
import {
  ImportWorkspaceFilesProgressDto,
  ImportWorkspaceOptionKey
} from '../../../../../../../api-dto/files/import-workspace-progress.dto';
import { TestGroupsLoadProgressDto } from '../../../../../../../api-dto/files/test-groups-load-progress.dto';
import { CacheService } from '../../../cache/cache.service';
import { WorkspaceTestResultsService } from './workspace-test-results.service';
import { CodingFreshnessService } from '../coding/coding-freshness.service';
import { CodingAnalysisService } from '../coding/coding-analysis.service';
import { TestResultsMutationSummary } from './person-persistence.service';
import { withWorkspaceTestResultsMutationLock } from '../shared/workspace-test-results-lock.util';

export { Result };

const agent = new https.Agent({
  rejectUnauthorized: false
});

type ServerFilesResponse = {
  Booklet: [];
  Resource: File[];
  Unit: File[];
  Testtakers: [];
};

type File = {
  name: string;
  size: number;
  modificationTime: number;
  type: string;
  id: string;
  report: [];
  info: {
    label: string;
    description: string;
  };
  data: string;
};

@Injectable()
export class TestcenterService {
  private readonly logger = new Logger(TestcenterService.name);

  constructor(
    private readonly personService: PersonService,
    private readonly httpService: HttpService,
    private workspaceFilesService: WorkspaceFilesService,
    private cacheService: CacheService,
    private readonly workspaceTestResultsService: WorkspaceTestResultsService,
    private readonly connection: DataSource,
    @Optional()
    private readonly codingFreshnessService?: CodingFreshnessService,
    @Optional()
    private readonly codingAnalysisService?: CodingAnalysisService
  ) {}

  persons: Person[] = [];

  async authenticate(credentials: {
    username: string;
    password: string;
    server: string;
    url: string;
  }): Promise<Record<string, unknown>> {
    const endpoint =
      credentials.url && !credentials.server ?
        `${credentials.url}/api/session/admin` :
        `http://iqb-testcenter${credentials.server}.de/api/session/admin`;

    try {
      const { data } = await firstValueFrom(
        this.httpService
          .put(
            endpoint,
            {
              name: credentials.username,
              password: credentials.password
            },
            {
              httpsAgent: agent
            }
          )
          .pipe(
            catchError(error => {
              throw new Error(
                `Authentication failed: ${error?.message || error}`
              );
            })
          )
      );
      return data;
    } catch (error) {
      throw new Error(
        `Authentication error: ${error.message || 'Unknown error'}`
      );
    }
  }

  async getTestgroups(
    workspace_id: string,
    tc_workspace: string,
    server: string,
    url: string,
    authToken: string,
    importRunId?: string
  ): Promise<TestGroupsInfoDto[]> {
    const headersRequest = {
      Authtoken: authToken
    };
    try {
      await this.updateTestGroupsLoadProgress(workspace_id, importRunId, {
        status: 'running',
        phase: 'fetching-testcenter-groups',
        totalGroups: 0,
        processedGroups: 0,
        existingGroups: 0,
        groupsWithLogs: 0,
        message: 'Testgruppen werden vom Testcenter abgerufen.'
      });

      const response = await this.httpService.axiosRef.get<TestGroupsInfoDto[]>(
        url ?
          `${url}/api/workspace/${tc_workspace}/results` :
          `https://iqb-testcenter${server}.de/api/workspace/${tc_workspace}/results`,
        {
          httpsAgent: agent,
          headers: headersRequest
        }
      );
      if (!Array.isArray(response.data)) {
        throw new Error('Unexpected Testcenter response: expected a list of test groups.');
      }
      const testGroups = response.data;

      await this.updateTestGroupsLoadProgress(workspace_id, importRunId, {
        phase: 'checking-workspace-groups',
        totalGroups: testGroups.length,
        processedGroups: 0,
        message: `${testGroups.length} Testgruppen geladen. Vorhandene Gruppen werden geprüft.`
      });

      const existingGroups = await this.personService.getWorkspaceGroups(
        Number(workspace_id)
      );

      await this.updateTestGroupsLoadProgress(workspace_id, importRunId, {
        phase: 'checking-booklet-logs',
        existingGroups: existingGroups.length,
        message: 'Vorhandene Booklet-Logs werden geprüft.'
      });

      const groupsWithLogs = await this.personService.getGroupsWithBookletLogs(
        Number(workspace_id),
        existingGroups
      );
      const existingGroupsSet = new Set(existingGroups);
      const groupsWithLogsCount = Array.from(groupsWithLogs.values())
        .filter(Boolean).length;

      await this.updateTestGroupsLoadProgress(workspace_id, importRunId, {
        phase: 'annotating-groups',
        groupsWithLogs: groupsWithLogsCount,
        message: 'Testgruppen werden für die Auswahl vorbereitet.'
      });

      const annotatedGroups = await this.annotateTestGroupsWithProgress(
        workspace_id,
        importRunId,
        testGroups,
        existingGroupsSet,
        groupsWithLogs
      );

      await this.updateTestGroupsLoadProgress(workspace_id, importRunId, {
        status: 'completed',
        phase: 'annotating-groups',
        totalGroups: testGroups.length,
        processedGroups: testGroups.length,
        message: `${testGroups.length} Testgruppen wurden abgerufen.`
      });

      return annotatedGroups;
    } catch (error) {
      this.logger.error(`Error fetching test groups: ${error.message}`);
      await this.updateTestGroupsLoadProgress(workspace_id, importRunId, {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
        message: 'Testgruppen konnten nicht abgerufen werden.'
      });
      throw new Error(
        `Failed to retrieve test groups from Testcenter: ${
          error?.message || 'Unknown error'
        }`
      );
    }
  }

  private testGroupsLoadProgressKey(
    workspaceId: string,
    importRunId: string
  ): string {
    return `testcenter_test_groups_progress:${workspaceId}:${importRunId}`;
  }

  private createInitialTestGroupsLoadProgress(
    importRunId: string
  ): TestGroupsLoadProgressDto {
    return {
      importRunId,
      status: 'running',
      phase: 'fetching-testcenter-groups',
      totalGroups: 0,
      processedGroups: 0,
      existingGroups: 0,
      groupsWithLogs: 0,
      message: 'Testgruppen werden vom Testcenter abgerufen.',
      updatedAt: Date.now()
    };
  }

  private async loadTestGroupsLoadProgress(
    workspaceId: string,
    importRunId?: string
  ): Promise<TestGroupsLoadProgressDto | null> {
    if (!importRunId) return null;
    return this.cacheService.get<TestGroupsLoadProgressDto>(
      this.testGroupsLoadProgressKey(workspaceId, importRunId)
    );
  }

  private async saveTestGroupsLoadProgress(
    workspaceId: string,
    importRunId: string,
    progress: TestGroupsLoadProgressDto
  ): Promise<void> {
    progress.updatedAt = Date.now();
    await this.cacheService.set(
      this.testGroupsLoadProgressKey(workspaceId, importRunId),
      progress,
      3600
    );
  }

  async getTestGroupsLoadProgress(
    workspaceId: string,
    importRunId: string
  ): Promise<TestGroupsLoadProgressDto> {
    const progress = await this.loadTestGroupsLoadProgress(
      workspaceId,
      importRunId
    );
    if (progress) return progress;

    return {
      importRunId,
      status: 'unknown',
      totalGroups: 0,
      processedGroups: 0,
      existingGroups: 0,
      groupsWithLogs: 0,
      updatedAt: Date.now()
    };
  }

  private async updateTestGroupsLoadProgress(
    workspaceId: string,
    importRunId: string | undefined,
    patch: Partial<Omit<TestGroupsLoadProgressDto, 'importRunId' | 'updatedAt'>>
  ): Promise<void> {
    if (!importRunId) return;
    const current = await this.loadTestGroupsLoadProgress(
      workspaceId,
      importRunId
    );
    const progress = {
      ...this.createInitialTestGroupsLoadProgress(importRunId),
      ...(current || {}),
      ...patch,
      importRunId
    };
    await this.saveTestGroupsLoadProgress(workspaceId, importRunId, progress);
  }

  private async annotateTestGroupsWithProgress(
    workspaceId: string,
    importRunId: string | undefined,
    testGroups: TestGroupsInfoDto[],
    existingGroups: Set<string>,
    groupsWithLogs: Map<string, boolean>
  ): Promise<TestGroupsInfoDto[]> {
    const annotatedGroups: TestGroupsInfoDto[] = [];
    const chunkSize = 250;

    for (let index = 0; index < testGroups.length; index += chunkSize) {
      const chunk = testGroups.slice(index, index + chunkSize);
      annotatedGroups.push(
        ...chunk.map(group => ({
          ...group,
          existsInDatabase: existingGroups.has(group.groupName),
          hasBookletLogs: groupsWithLogs.get(group.groupName) || false
        }))
      );

      const processedGroups = Math.min(index + chunk.length, testGroups.length);
      await this.updateTestGroupsLoadProgress(workspaceId, importRunId, {
        phase: 'annotating-groups',
        totalGroups: testGroups.length,
        processedGroups,
        message:
          `${processedGroups}/${testGroups.length} Testgruppen vorbereitet.`
      });
    }

    return annotatedGroups;
  }

  private createChunks<T>(array: T[], size: number): T[][] {
    return Array.from({ length: Math.ceil(array.length / size) }, (_, i) => array.slice(i * size, i * size + size)
    );
  }

  private createHeaders(authToken: string): { Authtoken: string } {
    return { Authtoken: authToken };
  }

  private async importResponses(
    workspace_id: string,
    tc_workspace: string,
    server: string,
    url: string,
    authToken: string,
    testGroups: string
  ): Promise<Promise<{ issues: TestResultsUploadIssueDto[] }>[]> {
    this.logger.log('Import response data from TC');
    const headersRequest = this.createHeaders(authToken);
    const chunks = this.createChunks(testGroups.split(','), 1);

    return [
      Promise.resolve().then(async () => {
        const issues: TestResultsUploadIssueDto[] = [];
        try {
          const PERSON_BATCH_SIZE = 50;

          for (const chunk of chunks) {
            const endpoint = url ?
              `${url}/api/workspace/${tc_workspace}/report/response?dataIds=${chunk.join(
                ','
              )}` :
              `https://iqb-testcenter${server}.de/api/workspace/${tc_workspace}/report/response?dataIds=${chunk.join(
                ','
              )}`;

            let rawResponses: Response[] = [];
            try {
              const response = await this.httpService.axiosRef.get<Response[]>(endpoint, {
                httpsAgent: agent,
                headers: headersRequest
              });
              rawResponses = response.data || [];
            } catch (error) {
              this.logger.error(
                `Error fetching response chunk from "${endpoint}": ${
                  error?.message || error
                }`
              );
              throw error;
            }

            if (!rawResponses.length) continue;

            this.persons = await this.personService.createPersonList(
              rawResponses,
              Number(workspace_id)
            );

            const responsesByPerson = new Map<string, Response[]>();
            rawResponses.forEach(row => {
              const key = `${row.groupname || ''}@@${row.loginname || ''}@@${row.code || ''}`;
              const rows = responsesByPerson.get(key) || [];
              rows.push(row);
              responsesByPerson.set(key, rows);
            });

            let personList: Person[] = [];
            const personBatches: Person[][] = [];
            for (const person of this.persons) {
              const personKey = `${person.group || ''}@@${person.login || ''}@@${person.code || ''}`;
              const personRows = responsesByPerson.get(personKey) || [];
              if (!personRows.length) continue;

              const personWithBooklets =
                await this.personService.assignBookletsToPerson(
                  person,
                  personRows,
                  issues
                );
              const personWithUnits = await this.personService.assignUnitsToBookletAndPerson(
                personWithBooklets,
                personRows,
                issues
              );
              personList.push(personWithUnits);

              if (personList.length >= PERSON_BATCH_SIZE) {
                personBatches.push(personList);
                personList = [];
              }
            }

            if (personList.length > 0) {
              personBatches.push(personList);
            }

            if (personBatches.length === 0) continue;

            let responseImportMutatedData = false;
            await withWorkspaceTestResultsMutationLock(this.connection, Number(workspace_id), async () => {
              const mutationSummary = this.createMutationSummary();
              for (const personBatch of personBatches) {
                const batchSummary = await this.personService.processPersonBooklets(
                  personBatch,
                  Number(workspace_id),
                  'skip',
                  'person',
                  issues
                );
                this.mergeMutationSummary(mutationSummary, batchSummary);
              }

              responseImportMutatedData =
                this.responseImportMutatedTestResults(mutationSummary);
              await this.updateCodingFreshnessAfterResponseImport(
                Number(workspace_id),
                mutationSummary,
                issues
              );
            });

            if (responseImportMutatedData) {
              await this.invalidateCodingCachesAfterResponsesImport(
                Number(workspace_id),
                issues
              );
            }
          }

          return { issues };
        } catch (error) {
          this.logger.error('Error processing consolidated response data:');
          throw error;
        }
      })
    ];
  }

  private async importLogs(
    workspace_id: string,
    tc_workspace: string,
    server: string,
    url: string,
    authToken: string,
    testGroups: string,
    overwriteExistingLogs: boolean = true
  ): Promise<{ issues: TestResultsUploadIssueDto[] }> {
    this.logger.log('Import logs data from TC');
    const headersRequest = this.createHeaders(authToken);
    const logsChunks = this.createChunks(testGroups.split(','), 1);
    const allLogData: Log[] = [];
    const importIssues: TestResultsUploadIssueDto[] = [];

    for (const chunk of logsChunks) {
      const logsUrl = url ?
        `${url}/api/workspace/${tc_workspace}/report/log?dataIds=${chunk.join(
          ','
        )}` :
        `https://iqb-testcenter${server}.de/api/workspace/${tc_workspace}/report/log?dataIds=${chunk.join(
          ','
        )}`;

      try {
        const { data: logData } = await this.httpService.axiosRef.get<Log[]>(
          logsUrl,
          {
            httpsAgent: agent,
            headers: headersRequest
          }
        );
        allLogData.push(...logData);
      } catch (error) {
        this.logger.error(`Error fetching log chunk: ${error.message}`);
        throw error;
      }
    }

    try {
      const { bookletLogs, unitLogs } = this.separateLogsByType(allLogData);
      const filename = `Testcenter:${tc_workspace}:${testGroups}`;

      const persons = await Promise.all(
        (await this.personService.createPersonList(
          allLogData,
          Number(workspace_id)
        )).map(async p => {
          const personWithBooklets = this.personService.assignBookletLogsToPerson(p, bookletLogs, importIssues, filename);
          const personUnitLogs = this.personService.filterLogRowsForPerson(unitLogs, p);
          this.personService.ensureBookletsForUnitLogs(personWithBooklets, personUnitLogs);
          personWithBooklets.booklets = personWithBooklets.booklets.map(b => this.personService.assignUnitLogsToBooklet(b, personUnitLogs, importIssues, filename)
          );
          return personWithBooklets;
        })
      );

      const result = await this.personService.processPersonLogs(
        persons,
        unitLogs,
        bookletLogs,
        overwriteExistingLogs
      );

      if (result.issues) {
        importIssues.push(...result.issues);
      }

      this.logger.log(`Logs import result: ${JSON.stringify(result)}`);
    } catch (error) {
      this.logger.error(
        `Error processing consolidated log data: ${error.message}`
      );
      throw error;
    }

    return { issues: importIssues };
  }

  private separateLogsByType(logData: Log[]): {
    bookletLogs: Log[];
    unitLogs: Log[];
  } {
    return logData.reduce(
      (acc, row) => {
        row.unitname === '' ?
          acc.bookletLogs.push(row) :
          acc.unitLogs.push(row);
        return acc;
      },
      { bookletLogs: [] as Log[], unitLogs: [] as Log[] }
    );
  }

  private importProgressKey(workspaceId: string, importRunId: string): string {
    return `testcenter_import_progress:${workspaceId}:${importRunId}`;
  }

  private createInitialProgress(
    importRunId: string,
    optionBuckets: Record<ImportWorkspaceOptionKey, File[]>
  ): ImportWorkspaceFilesProgressDto {
    const options = (Object.keys(optionBuckets) as ImportWorkspaceOptionKey[]).map(
      optionKey => ({
        optionKey,
        planned: optionBuckets[optionKey].length,
        processed: 0,
        uploaded: 0,
        failed: 0,
        status: 'pending' as const
      })
    );

    return {
      importRunId,
      status: 'running',
      totalPlanned: options.reduce((sum, option) => sum + option.planned, 0),
      totalProcessed: 0,
      totalUploaded: 0,
      totalFailed: 0,
      options,
      updatedAt: Date.now()
    };
  }

  private async loadProgress(
    workspaceId: string,
    importRunId?: string
  ): Promise<ImportWorkspaceFilesProgressDto | null> {
    if (!importRunId) return null;
    return this.cacheService.get<ImportWorkspaceFilesProgressDto>(
      this.importProgressKey(workspaceId, importRunId)
    );
  }

  private async saveProgress(
    workspaceId: string,
    importRunId: string,
    progress: ImportWorkspaceFilesProgressDto
  ): Promise<void> {
    progress.updatedAt = Date.now();
    await this.cacheService.set(
      this.importProgressKey(workspaceId, importRunId),
      progress,
      3600
    );
  }

  async getImportWorkspaceFilesProgress(
    workspaceId: string,
    importRunId: string
  ): Promise<ImportWorkspaceFilesProgressDto> {
    const progress = await this.loadProgress(workspaceId, importRunId);
    if (progress) return progress;

    return {
      importRunId,
      status: 'unknown',
      totalPlanned: 0,
      totalProcessed: 0,
      totalUploaded: 0,
      totalFailed: 0,
      options: [],
      updatedAt: Date.now()
    };
  }

  private async setCurrentFileProgress(
    workspaceId: string,
    importRunId: string | undefined,
    optionKey: ImportWorkspaceOptionKey,
    fileName: string
  ): Promise<void> {
    if (!importRunId) return;
    const progress = await this.loadProgress(workspaceId, importRunId);
    if (!progress) return;

    progress.currentOption = optionKey;
    progress.currentFile = fileName;
    progress.options = progress.options.map(option => {
      if (option.optionKey !== optionKey) return option;
      return {
        ...option,
        currentFile: fileName,
        status: 'active'
      };
    });
    await this.saveProgress(workspaceId, importRunId, progress);
  }

  private async applyFileResultProgress(
    workspaceId: string,
    importRunId: string | undefined,
    optionKey: ImportWorkspaceOptionKey,
    uploadedDelta: number,
    failedDelta: number
  ): Promise<void> {
    if (!importRunId) return;
    const progress = await this.loadProgress(workspaceId, importRunId);
    if (!progress) return;

    progress.totalProcessed += 1;
    progress.totalUploaded += uploadedDelta;
    progress.totalFailed += failedDelta;

    progress.options = progress.options.map(option => {
      if (option.optionKey !== optionKey) return option;
      const processed = option.processed + 1;
      const updated = {
        ...option,
        processed,
        uploaded: option.uploaded + uploadedDelta,
        failed: option.failed + failedDelta,
        currentFile: undefined
      };
      updated.status =
        processed >= updated.planned ? 'completed' : 'pending';
      return updated;
    });

    progress.currentFile = undefined;
    progress.currentOption = undefined;
    await this.saveProgress(workspaceId, importRunId, progress);
  }

  private async importFiles(
    workspace_id: string,
    tc_workspace: string,
    server: string,
    url: string,
    authToken: string,
    importOptions: ImportOptions,
    overwriteFileIds?: string[],
    importRunId?: string
  ): Promise<{
      success: boolean;
      testFiles: number;
      filesPlayer: number;
      filesUnits: number;
      filesDefinitions: number;
      filesCodings: number;
      filesBooklets: number;
      filesTestTakers: number;
      filesMetadata: number;
      uploadResult: TestFilesUploadResultDto;
    }> {
    const headersRequest = this.createHeaders(authToken);
    const filesEndpoint = url ?
      `${url}/api/workspace/${tc_workspace}/files` :
      `http://iqb-testcenter${server}.de/api/workspace/${tc_workspace}/files`;

    try {
      const { data: files } =
        await this.httpService.axiosRef.get<ServerFilesResponse>(
          filesEndpoint,
          {
            httpsAgent: agent,
            headers: headersRequest
          }
        );

      const {
        units, definitions, player, codings, testTakers, booklets, metadata
      } =
        importOptions;

      const playerArr: File[] =
        player === 'true' ?
          files.Resource.filter(f => f.name.includes('.html')) :
          [];
      const unitsArr: File[] = units === 'true' ? files.Unit : [];
      const definitionsArr: File[] =
        definitions === 'true' ?
          files.Resource.filter(f => f.name.includes('.voud')) :
          [];
      const codingsArr: File[] =
        codings === 'true' ?
          files.Resource.filter(f => f.name.includes('.vocs')) :
          [];
      const bookletsArr: File[] =
        booklets === 'true' ? (files.Booklet as unknown as File[]) : [];
      const testTakersArr: File[] =
        testTakers === 'true' ? (files.Testtakers as unknown as File[]) : [];
      const metadataArr: File[] =
        metadata === 'true' ?
          files.Resource.filter(f => f.name.includes('.vomd')) :
          [];

      const overwriteIdSet = new Set((overwriteFileIds || []).filter(Boolean));
      const onlyOverwriteSelected = overwriteIdSet.size > 0;

      const optionBuckets: Record<ImportWorkspaceOptionKey, File[]> = {
        definitions: definitionsArr,
        units: unitsArr,
        player: playerArr,
        codings: codingsArr,
        booklets: bookletsArr,
        testTakers: testTakersArr,
        metadata: metadataArr
      };

      const filteredOptionBuckets = (Object.keys(
        optionBuckets
      ) as ImportWorkspaceOptionKey[]).reduce(
        (acc, optionKey) => {
          const source = optionBuckets[optionKey];
          acc[optionKey] = onlyOverwriteSelected ?
            source.filter(f => overwriteIdSet.has(f.id)) :
            source;
          return acc;
        },
        {
          definitions: [] as File[],
          units: [] as File[],
          player: [] as File[],
          codings: [] as File[],
          booklets: [] as File[],
          testTakers: [] as File[],
          metadata: [] as File[]
        } as Record<ImportWorkspaceOptionKey, File[]>
      );

      if (importRunId) {
        await this.saveProgress(
          workspace_id,
          importRunId,
          this.createInitialProgress(importRunId, filteredOptionBuckets)
        );
      }

      const filesWithOption: Array<{
        optionKey: ImportWorkspaceOptionKey;
        file: File;
      }> = (Object.keys(filteredOptionBuckets) as ImportWorkspaceOptionKey[])
        .flatMap(
          optionKey => filteredOptionBuckets[optionKey].map(file => ({
            optionKey,
            file
          }))
        );

      const uploadedFiles: TestFilesUploadUploadedDto[] = [];
      const failedFiles: TestFilesUploadFailedDto[] = [];
      const conflicts: NonNullable<TestFilesUploadResultDto['conflicts']> = [];
      const issues: TestResultsUploadIssueDto[] = [];

      for (const { optionKey, file } of filesWithOption) {
        await this.setCurrentFileProgress(
          workspace_id,
          importRunId,
          optionKey,
          file.name
        );
        try {
          const fetched = await this.getFile(
            file,
            server,
            tc_workspace,
            authToken,
            url
          );

          const dbEntries = this.createDatabaseEntries([fetched], workspace_id);
          const perFileResult = await (
            this.workspaceFilesService as unknown as {
              testCenterImport: (
                entries: Record<string, unknown>[],
                overwriteFileIds?: string[]
              ) => Promise<TestFilesUploadResultDto>;
            }
          ).testCenterImport(dbEntries, overwriteFileIds);

          const uploadedCount =
            Number(
              perFileResult.uploaded ||
                (perFileResult.uploadedFiles || []).length
            ) || 0;
          const failedCount =
            Number(
              perFileResult.failed || (perFileResult.failedFiles || []).length
            ) || 0;

          if ((perFileResult.uploadedFiles || []).length > 0) {
            uploadedFiles.push(...(perFileResult.uploadedFiles || []));
          } else if (uploadedCount > 0) {
            uploadedFiles.push({
              fileId: fetched.id,
              filename: fetched.name,
              fileType: fetched.type
            });
          }

          if ((perFileResult.failedFiles || []).length > 0) {
            failedFiles.push(...(perFileResult.failedFiles || []));
          }
          if ((perFileResult.conflicts || []).length > 0) {
            conflicts.push(...(perFileResult.conflicts || []));
          }
          if ((perFileResult.issues || []).length > 0) {
            issues.push(...(perFileResult.issues || []));
          }

          await this.applyFileResultProgress(
            workspace_id,
            importRunId,
            optionKey,
            uploadedCount,
            failedCount
          );
        } catch (e) {
          failedFiles.push({
            filename: file.name,
            reason: e instanceof Error ? e.message : 'Failed to fetch file'
          });
          await this.applyFileResultProgress(
            workspace_id,
            importRunId,
            optionKey,
            0,
            1
          );
        }
      }
      const uploadResult: TestFilesUploadResultDto = {
        total: filesWithOption.length,
        uploaded: uploadedFiles.length,
        failed: failedFiles.length,
        uploadedFiles,
        failedFiles,
        conflicts,
        issues: issues.length > 0 ? issues : undefined
      };

      if (importRunId) {
        const progress = await this.loadProgress(workspace_id, importRunId);
        if (progress) {
          progress.status = 'completed';
          progress.currentFile = undefined;
          progress.currentOption = undefined;
          progress.options = progress.options.map(option => ({
            ...option,
            currentFile: undefined,
            status: option.processed >= option.planned ? 'completed' : option.status
          }));
          await this.saveProgress(workspace_id, importRunId, progress);
        }
      }

      return {
        success: uploadResult.uploaded > 0,
        testFiles: uploadResult.uploaded,
        filesPlayer: playerArr.length,
        filesUnits: unitsArr.length,
        filesDefinitions: definitionsArr.length,
        filesCodings: codingsArr.length,
        filesBooklets: bookletsArr.length,
        filesTestTakers: testTakersArr.length,
        filesMetadata: metadataArr.length,
        uploadResult
      };
    } catch (error) {
      this.logger.error('Error fetching files:');
      const uploadResult: TestFilesUploadResultDto = {
        total: 0,
        uploaded: 0,
        failed: 0,
        uploadedFiles: [],
        failedFiles: [
          {
            filename: 'Testcenter import',
            reason: error instanceof Error ? error.message : 'Unknown error'
          }
        ]
      };
      if (importRunId) {
        const progress = await this.loadProgress(workspace_id, importRunId);
        if (progress) {
          progress.status = 'failed';
          progress.error = error instanceof Error ? error.message : 'Unknown error';
          progress.currentFile = undefined;
          progress.currentOption = undefined;
          await this.saveProgress(workspace_id, importRunId, progress);
        }
      }
      return {
        success: false,
        testFiles: 0,
        filesPlayer: 0,
        filesUnits: 0,
        filesDefinitions: 0,
        filesCodings: 0,
        filesBooklets: 0,
        filesTestTakers: 0,
        filesMetadata: 0,
        uploadResult
      };
    }
  }

  private createDatabaseEntries(
    fetchedFiles: Array<{
      data: File;
      name: string;
      type: string;
      size: number;
      id: string;
    }>,
    workspace_id: string
  ): Record<string, unknown>[] {
    return fetchedFiles.map(res => ({
      filename: res.name,
      file_id: res.id,
      file_type: res.type,
      file_size: res.size,
      workspace_id: workspace_id,
      data: res.data
    }));
  }

  async importWorkspaceFiles(
    workspace_id: string,
    tc_workspace: string,
    server: string,
    url: string,
    authToken: string,
    importOptions: ImportOptions,
    testGroups: string,
    overwriteExistingLogs: boolean = true,
    overwriteFileIds?: string[],
    importRunId?: string
  ): Promise<Result> {
    const { responses, logs } = importOptions;
    const result: Result = {
      success: false,
      testFiles: 0,
      responses: 0,
      logs: 0,
      booklets: 0,
      units: 0,
      persons: 0,
      importedGroups: testGroups.split(',').map(g => g.trim())
    };

    const appendIssues = (issues?: TestResultsUploadIssueDto[]): void => {
      if (!issues || issues.length === 0) {
        return;
      }
      if (!result.issues) result.issues = [];
      result.issues.push(...issues);
    };

    try {
      if (responses === 'true') {
        const responsePromises = await this.importResponses(
          workspace_id,
          tc_workspace,
          server,
          url,
          authToken,
          testGroups
        );
        result.responses = responsePromises.length;
        const responseResults = await Promise.all(responsePromises);
        responseResults.forEach(res => {
          if (res && typeof res === 'object' && 'issues' in res && Array.isArray(res.issues)) {
            appendIssues(res.issues);
          }
        });

        try {
          const stats = await this.personService.getImportStatistics(
            Number(workspace_id)
          );
          result.persons = stats.persons || 0;
          result.booklets = stats.booklets || 0;
          result.units = stats.units || 0;
        } catch (statsError) {
          this.logger.warn(`Could not get import statistics: ${statsError.message}`);
        }
      }

      if (logs === 'true') {
        const { issues: logsIssues } = await this.importLogs(
          workspace_id,
          tc_workspace,
          server,
          url,
          authToken,
          testGroups,
          overwriteExistingLogs
        );
        result.logs = 1; // Mark that log import was triggered
        appendIssues(logsIssues);

        // Calculate log coverage statistics
        try {
          const logStats = await this.personService.getLogCoverageStats(Number(workspace_id));
          result.bookletsWithLogs = logStats.bookletsWithLogs;
          result.totalBooklets = logStats.totalBooklets;
          result.unitsWithLogs = logStats.unitsWithLogs;
          result.totalUnits = logStats.totalUnits;
          result.bookletDetails = logStats.bookletDetails;
          result.unitDetails = logStats.unitDetails;
        } catch (statsError) {
          this.logger.warn(`Could not get log coverage statistics: ${statsError.message}`);
        }
      }

      const shouldImportFiles = this.shouldImportFiles(importOptions);
      if (shouldImportFiles) {
        const filesResult = await this.importFiles(
          workspace_id,
          tc_workspace,
          server,
          url,
          authToken,
          importOptions,
          overwriteFileIds,
          importRunId
        );
        result.testFiles = filesResult.testFiles;
        result.success = filesResult.success;
        result.filesPlayer = filesResult.filesPlayer;
        result.filesUnits = filesResult.filesUnits;
        result.filesDefinitions = filesResult.filesDefinitions;
        result.filesCodings = filesResult.filesCodings;
        result.filesBooklets = filesResult.filesBooklets;
        result.filesTestTakers = filesResult.filesTestTakers;
        result.filesMetadata = filesResult.filesMetadata;
        result.testFilesUploadResult = filesResult.uploadResult;
        appendIssues(filesResult.uploadResult.issues);
      }

      if (responses === 'true') {
        await this.attachCodingFreshnessSummary(Number(workspace_id), result);
      }
      if (responses === 'true' || logs === 'true') {
        await this.invalidateWorkspaceOverviewCache(workspace_id, result);
      }
      result.success = true;
      return result;
    } catch (error) {
      this.logger.error(
        `Error during importWorkspaceFiles for workspace ${workspace_id}, tc_workspace ${tc_workspace}: ${
          error?.message || error
        }`
      );
      if (importRunId) {
        const progress = await this.loadProgress(workspace_id, importRunId);
        if (progress) {
          progress.status = 'failed';
          progress.error = error?.message || 'Unknown error';
          progress.currentFile = undefined;
          progress.currentOption = undefined;
          await this.saveProgress(workspace_id, importRunId, progress);
        }
      }
      result.success = false;
      return result;
    }
  }

  private async invalidateWorkspaceOverviewCache(
    workspaceId: string,
    result: Result
  ): Promise<void> {
    try {
      await this.workspaceTestResultsService.invalidateWorkspaceStatsCache(
        Number(workspaceId)
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Could not invalidate workspace overview cache after Testcenter import: ${detail}`);
      if (!result.issues) result.issues = [];
      result.issues.push({
        level: 'warning',
        category: 'other',
        message:
          'Der Testcenter-Import wurde verarbeitet, aber der Übersichtscache konnte nicht zuverlässig aktualisiert werden. Die Übersicht kann sich nach Aktualisierung noch ändern.'
      });
    }
  }

  private async invalidateCodingCachesAfterResponsesImport(
    workspaceId: number,
    issues: TestResultsUploadIssueDto[]
  ): Promise<void> {
    try {
      await Promise.all([
        this.codingAnalysisService?.invalidateCache(workspaceId),
        this.workspaceTestResultsService.invalidateCodingStatisticsCache(workspaceId),
        this.workspaceTestResultsService.invalidateCodingAvailabilityCache(workspaceId)
      ]);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Could not invalidate coding caches after Testcenter response import: ${detail}`);
      issues.push({
        level: 'warning',
        category: 'other',
        message:
          'Der Testcenter-Import wurde verarbeitet, aber Kodierstatistiken, Antwort-Analyse oder verfügbare Fälle konnten nicht zuverlässig aktualisiert werden. Die Werte können sich nach Aktualisierung noch ändern.'
      });
    }
  }

  private responseImportMutatedTestResults(
    mutationSummary: Partial<TestResultsMutationSummary>
  ): boolean {
    return (mutationSummary.addedUnitIds?.length || 0) > 0 ||
      (mutationSummary.changedUnitIds?.length || 0) > 0 ||
      (mutationSummary.addedResponseIds?.length || 0) > 0 ||
      (mutationSummary.addedResponseCount || 0) > 0 ||
      (mutationSummary.changedResponseCount || 0) > 0 ||
      (mutationSummary.savedResponseCount || 0) > 0 ||
      (mutationSummary.deletedResponseCount || 0) > 0;
  }

  private createMutationSummary(): TestResultsMutationSummary {
    return {
      addedUnitIds: [],
      changedUnitIds: [],
      addedResponseIds: [],
      addedResponseCount: 0,
      changedResponseCount: 0,
      savedResponseCount: 0,
      deletedResponseCount: 0,
      skippedExistingResponseCount: 0
    };
  }

  private mergeMutationSummary(
    target: TestResultsMutationSummary,
    source?: Partial<TestResultsMutationSummary> | null
  ): void {
    if (!source) {
      return;
    }
    target.addedUnitIds.push(...(source.addedUnitIds || []));
    target.changedUnitIds.push(...(source.changedUnitIds || []));
    target.addedResponseIds?.push(...(source.addedResponseIds || []));
    target.addedResponseCount += source.addedResponseCount || 0;
    target.changedResponseCount += source.changedResponseCount || 0;
    target.savedResponseCount =
      (target.savedResponseCount || 0) + (source.savedResponseCount || 0);
    target.deletedResponseCount =
      (target.deletedResponseCount || 0) + (source.deletedResponseCount || 0);
    target.skippedExistingResponseCount =
      (target.skippedExistingResponseCount || 0) +
      (source.skippedExistingResponseCount || 0);
  }

  private async updateCodingFreshnessAfterResponseImport(
    workspaceId: number,
    mutationSummary: TestResultsMutationSummary,
    issues: TestResultsUploadIssueDto[]
  ): Promise<void> {
    if (!this.codingFreshnessService || !Number.isFinite(workspaceId) || workspaceId <= 0) {
      return;
    }

    const addedUnitIds = this.uniquePositiveIds(mutationSummary.addedUnitIds);
    const changedUnitIds = this.uniquePositiveIds(mutationSummary.changedUnitIds);
    const addedResponseIds = this.uniquePositiveIds(mutationSummary.addedResponseIds || []);
    if (addedUnitIds.length === 0 && changedUnitIds.length === 0 && addedResponseIds.length === 0) {
      return;
    }

    try {
      await this.codingFreshnessService.markUnitsPendingAfterImport(
        workspaceId,
        addedUnitIds,
        mutationSummary.addedResponseCount
      );
      if (addedResponseIds.length > 0) {
        await this.codingFreshnessService.markResponsesPendingAfterImport(
          workspaceId,
          addedResponseIds
        );
      }
      await this.codingFreshnessService.markUnitsStaleAfterResultChange(
        workspaceId,
        changedUnitIds,
        'RESULT_UPDATED'
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Could not update coding freshness after Testcenter import: ${detail}`);
      issues.push({
        level: 'warning',
        category: 'other',
        message:
          'Der Testcenter-Import wurde verarbeitet, aber der Kodierungsstatus konnte nicht zuverlässig aktualisiert werden.'
      });
    }
  }

  private async attachCodingFreshnessSummary(
    workspaceId: number,
    result: Result
  ): Promise<void> {
    if (!this.codingFreshnessService || !Number.isFinite(workspaceId) || workspaceId <= 0) {
      return;
    }

    try {
      result.codingFreshness = await this.codingFreshnessService.getSummary(workspaceId);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Could not load coding freshness after Testcenter import: ${detail}`);
      if (!result.issues) result.issues = [];
      result.issues.push({
        level: 'warning',
        category: 'other',
        message:
          'Der Testcenter-Import wurde verarbeitet, aber der Kodierungsstatus konnte nicht geladen werden.'
      });
    }
  }

  private uniquePositiveIds(ids: number[]): number[] {
    return Array.from(
      new Set(
        (ids || [])
          .map(id => Number(id))
          .filter(id => Number.isInteger(id) && id > 0)
      )
    );
  }

  private shouldImportFiles(importOptions: ImportOptions): boolean {
    const {
      definitions, player, units, codings, testTakers, booklets, metadata
    } =
      importOptions;
    return (
      definitions === 'true' ||
      player === 'true' ||
      units === 'true' ||
      codings === 'true' ||
      testTakers === 'true' ||
      booklets === 'true' ||
      metadata === 'true'
    );
  }

  async getFile(
    file: File,
    server: string,
    tcWorkspace: string,
    authToken: string,
    url?: string
  ): Promise<{
      data: File;
      name: string;
      type: string;
      size: number;
      id: string;
    }> {
    const headersRequest = this.createHeaders(authToken);
    const requestUrl = this.buildFileRequestUrl(file, server, tcWorkspace, url);

    try {
      const response = await this.httpService.axiosRef.get<File>(requestUrl, {
        httpsAgent: agent,
        headers: headersRequest
      });

      return {
        data: response.data,
        name: file.name,
        type: file.type,
        size: file.size,
        id: file.id
      };
    } catch (error) {
      this.logger.error(`Failed to fetch file: ${file.name} ${error}`);
      throw new Error('Unable to fetch the file from server.');
    }
  }

  private buildFileRequestUrl(
    file: File,
    server: string,
    tcWorkspace: string,
    url?: string
  ): string {
    return url ?
      `${url}/api/workspace/${tcWorkspace}/file/${file.type}/${file.name}` :
      `http://iqb-testcenter${server}.de/api/workspace/${tcWorkspace}/file/${file.type}/${file.name}`;
  }
}
