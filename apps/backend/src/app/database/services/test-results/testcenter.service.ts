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
    private workspaceFilesService: WorkspaceFilesService
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
    const chunks = this.createChunks(testGroups.split(','), 2);
    const allRawResponses: Response[] = [];

    for (const chunk of chunks) {
      const endpoint = url ?
        `${url}/api/workspace/${tc_workspace}/report/response?dataIds=${chunk.join(
          ','
        )}` :
        `https://iqb-testcenter${server}.de/api/workspace/${tc_workspace}/report/response?dataIds=${chunk.join(
          ','
        )}`;

      try {
        const { data: rawResponses } = await this.httpService.axiosRef.get<
        Response[]
        >(endpoint, {
          httpsAgent: agent,
          headers: headersRequest
        });
        allRawResponses.push(...rawResponses);
      } catch (error) {
        logger.error(
          `Error fetching response chunk from "${endpoint}": ${
            error?.message || error
          }`
        );
        throw error;
      }
    }

    return [
      Promise.resolve().then(async () => {
        const issues: TestResultsUploadIssueDto[] = [];
        try {
          this.persons = await this.personService.createPersonList(
            allRawResponses,
            Number(workspace_id)
          );

          const personList = await Promise.all(
            this.persons.map(async person => {
              const personWithBooklets =
                await this.personService.assignBookletsToPerson(
                  person,
                  allRawResponses,
                  issues
                );
              return this.personService.assignUnitsToBookletAndPerson(
                personWithBooklets,
                allRawResponses,
                issues
              );
            })
          );
          await this.personService.processPersonBooklets(
            personList,
            Number(workspace_id),
            'skip',
            'person',
            issues
          );
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
    const logsChunks = this.createChunks(testGroups.split(','), 2);
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

  private async importFiles(
    workspace_id: string,
    tc_workspace: string,
    server: string,
    url: string,
    authToken: string,
    importOptions: ImportOptions,
    overwriteFileIds?: string[]
  ): Promise<{
      success: boolean;
      testFiles: number;
      filesPlayer: number;
      filesUnits: number;
      filesDefinitions: number;
      filesCodings: number;
      filesBooklets: number;
      filesTestTakers: number;
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
        units, definitions, player, codings, testTakers, booklets
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

      const overwriteIdSet = new Set((overwriteFileIds || []).filter(Boolean));
      const onlyOverwriteSelected = overwriteIdSet.size > 0;

      const allSelected: File[] = [
        ...playerArr,
        ...unitsArr,
        ...definitionsArr,
        ...codingsArr,
        ...bookletsArr,
        ...testTakersArr
      ];

      const filteredSelected = onlyOverwriteSelected ?
        allSelected.filter(f => overwriteIdSet.has(f.id)) :
        allSelected;

      const filePromises: Promise<File>[] = filteredSelected.map(file => Promise.resolve(file)
      );

      const uploadedFiles: TestFilesUploadUploadedDto[] = [];
      const failedFiles: TestFilesUploadFailedDto[] = [];
      const fetchedFiles: Array<{
        data: File;
        name: string;
        type: string;
        size: number;
        id: string;
      }> = [];

      for (const filePromise of filePromises) {
        const file = await filePromise;
        try {
          const fetched = await this.getFile(
            file,
            server,
            tc_workspace,
            authToken,
            url
          );
          fetchedFiles.push(fetched);
          uploadedFiles.push({
            fileId: fetched.id,
            filename: fetched.name,
            fileType: fetched.type
          });
        } catch (e) {
          failedFiles.push({
            filename: file.name,
            reason: e instanceof Error ? e.message : 'Failed to fetch file'
          });
        }
      }

      const dbEntries = this.createDatabaseEntries(fetchedFiles, workspace_id);

      const dbImportResult = await (
        this.workspaceFilesService as unknown as {
          testCenterImport: (
            entries: Record<string, unknown>[],
            overwriteFileIds?: string[]
          ) => Promise<TestFilesUploadResultDto>;
        }
      ).testCenterImport(dbEntries, overwriteFileIds);
      const uploadResult: TestFilesUploadResultDto = {
        total: Number(dbImportResult.total || 0) + failedFiles.length,
        uploaded: Number(
          dbImportResult.uploaded || (dbImportResult.uploadedFiles || []).length
        ),
        failed:
          Number(
            dbImportResult.failed || (dbImportResult.failedFiles || []).length
          ) + failedFiles.length,
        uploadedFiles: dbImportResult.uploadedFiles || [],
        failedFiles: [...(dbImportResult.failedFiles || []), ...failedFiles],
        conflicts: dbImportResult.conflicts
      };

      return {
        success: uploadResult.uploaded > 0,
        testFiles: uploadResult.uploaded,
        filesPlayer: playerArr.length,
        filesUnits: unitsArr.length,
        filesDefinitions: definitionsArr.length,
        filesCodings: codingsArr.length,
        filesBooklets: bookletsArr.length,
        filesTestTakers: testTakersArr.length,
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
      return {
        success: false,
        testFiles: 0,
        filesPlayer: 0,
        filesUnits: 0,
        filesDefinitions: 0,
        filesCodings: 0,
        filesBooklets: 0,
        filesTestTakers: 0,
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
    overwriteExistingLogs?: boolean
  ): Promise<Result>;
  async importWorkspaceFiles(
    workspace_id: string,
    tc_workspace: string,
    server: string,
    url: string,
    authToken: string,
    importOptions: ImportOptions,
    testGroups: string,
    overwriteExistingLogs: boolean = true,
    overwriteFileIds?: string[]
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
          overwriteFileIds
        );
        result.testFiles = filesResult.testFiles;
        result.success = filesResult.success;
        result.filesPlayer = filesResult.filesPlayer;
        result.filesUnits = filesResult.filesUnits;
        result.filesDefinitions = filesResult.filesDefinitions;
        result.filesCodings = filesResult.filesCodings;
        result.filesBooklets = filesResult.filesBooklets;
        result.filesTestTakers = filesResult.filesTestTakers;
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
      result.success = false;
      return result;
    }
  }

  private shouldImportFiles(importOptions: ImportOptions): boolean {
    const {
      definitions, player, units, codings, testTakers, booklets
    } =
      importOptions;
    return (
      definitions === 'true' ||
      player === 'true' ||
      units === 'true' ||
      codings === 'true' ||
      testTakers === 'true' ||
      booklets === 'true'
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
