import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import * as https from 'https';
import { catchError, firstValueFrom } from 'rxjs';
import { logger } from 'nx/src/utils/logger';
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
import { CacheService } from '../../../cache/cache.service';

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
  constructor(
    private readonly personService: PersonService,
    private readonly httpService: HttpService,
    private workspaceFilesService: WorkspaceFilesService,
    private cacheService: CacheService
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
    authToken: string
  ): Promise<TestGroupsInfoDto[]> {
    const headersRequest = {
      Authtoken: authToken
    };
    try {
      const response = await this.httpService.axiosRef.get<TestGroupsInfoDto[]>(
        url ?
          `${url}/api/workspace/${tc_workspace}/results` :
          `https://iqb-testcenter${server}.de/api/workspace/${tc_workspace}/results`,
        {
          httpsAgent: agent,
          headers: headersRequest
        }
      );
      const existingGroups = await this.personService.getWorkspaceGroups(
        Number(workspace_id)
      );
      const groupsWithLogs = await this.personService.getGroupsWithBookletLogs(
        Number(workspace_id)
      );

      return response.data.map(group => ({
        ...group,
        existsInDatabase: existingGroups.includes(group.groupName),
        hasBookletLogs: groupsWithLogs.get(group.groupName) || false
      }));
    } catch (error) {
      logger.error(`Error fetching test groups: ${error.message}`);
      return [];
    }
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
    logger.log('Import response data from TC');
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
              logger.error(
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
                await this.personService.processPersonBooklets(
                  personList,
                  Number(workspace_id),
                  'skip',
                  'person',
                  issues
                );
                personList = [];
              }
            }

            if (personList.length > 0) {
              await this.personService.processPersonBooklets(
                personList,
                Number(workspace_id),
                'skip',
                'person',
                issues
              );
            }
          }

          return { issues };
        } catch (error) {
          logger.error('Error processing consolidated response data:');
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
    logger.log('Import logs data from TC');
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
        logger.error(`Error fetching log chunk: ${error.message}`);
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
          const personWithBooklets = this.personService.assignBookletLogsToPerson(p, allLogData, importIssues, filename);
          personWithBooklets.booklets = personWithBooklets.booklets.map(b => this.personService.assignUnitLogsToBooklet(b, allLogData, importIssues, filename)
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

      logger.log(`Logs import result: ${JSON.stringify(result)}`);
    } catch (error) {
      logger.error(
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
        conflicts
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
      logger.error('Error fetching files:');
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

    const promises: Promise<{ issues?: TestResultsUploadIssueDto[] } | void>[] = [];

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
        promises.push(...responsePromises);
        result.responses = responsePromises.length;

        try {
          const stats = await this.personService.getImportStatistics(
            Number(workspace_id)
          );
          result.persons = stats.persons || 0;
          result.booklets = stats.booklets || 0;
          result.units = stats.units || 0;
        } catch (statsError) {
          logger.warn(`Could not get import statistics: ${statsError.message}`);
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
        if (logsIssues) {
          if (!result.issues) result.issues = [];
          result.issues.push(...logsIssues);
        }

        // Calculate log coverage statistics
        try {
          const logStats = await this.personService.getLogCoverageStats(Number(workspace_id));
          result.bookletsWithLogs = logStats.bookletsWithLogs;
          result.totalBooklets = logStats.totalBooklets;
          result.unitsWithLogs = logStats.unitsWithLogs;
          result.totalUnits = logStats.totalUnits;
        } catch (statsError) {
          logger.warn(`Could not get log coverage statistics: ${statsError.message}`);
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
      }

      if (promises.length > 0) {
        const results = await Promise.all(promises);
        results.forEach(res => {
          if (res && typeof res === 'object' && 'issues' in res && Array.isArray(res.issues)) {
            if (!result.issues) result.issues = [];
            result.issues.push(...res.issues);
          }
        });
      }
      result.success = true;
      return result;
    } catch (error) {
      logger.error(
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
      logger.error(`Failed to fetch file: ${file.name} ${error}`);
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
