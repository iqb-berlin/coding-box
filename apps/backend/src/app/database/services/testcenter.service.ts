import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import * as https from 'https';
import { catchError, firstValueFrom } from 'rxjs';
import { logger } from 'nx/src/utils/logger';
import { Person, Response } from './shared-types';
import {
  ImportOptions
} from '../../../../../frontend/src/app/ws-admin/components/test-center-import/test-center-import.component';
import { TestGroupsInfoDto } from '../../../../../../api-dto/files/test-groups-info.dto';
import { PersonService } from './person.service';
import { WorkspaceFilesService } from './workspace-files.service';

const agent = new https.Agent({
  rejectUnauthorized: false
});

type ServerFilesResponse = {
  Booklet:[],
  Resource:File[],
  Unit:File[],
  Testtakers:[],
};

type File = {
  name: string,
  size: number,
  modificationTime: number,
  type: string,
  id: string,
  report: [],
  info: {
    label: string,
    description: string
  },
  data: string
};

export type Log = {
  groupname:string,
  loginname : string,
  code : string,
  bookletname : string,
  unitname : string,
  timestamp: number,
  logentry : string,
};

export type Result = {
  success: boolean,
  testFiles: number,
  responses: number,
  logs: number
};

@Injectable()
export class TestcenterService {
  constructor(
    private readonly personService: PersonService,
    private readonly httpService: HttpService,
    private workspaceFilesService: WorkspaceFilesService
  ) {
  }

  persons: Person[] = [];

  async authenticate(credentials: { username: string; password: string; server: string; url: string }): Promise<Record<string, unknown>> {
    const endpoint = credentials.url && !credentials.server ?
      `${credentials.url}/api/session/admin` :
      `http://iqb-testcenter${credentials.server}.de/api/session/admin`;

    try {
      const { data } = await firstValueFrom(
        this.httpService.put(endpoint,
          {
            name: credentials.username,
            password: credentials.password
          },
          {
            httpsAgent: agent
          }).pipe(
          catchError(error => {
            throw new Error(`Authentication failed: ${error?.message || error}`);
          })
        )
      );
      return data;
    } catch (error) {
      throw new Error(`Authentication error: ${error.message || 'Unknown error'}`);
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

      const existingGroups = await this.personService.getWorkspaceGroups(Number(workspace_id));

      // Mark test groups that already exist in the database
      const testGroups = response.data.map(group => ({
        ...group,
        existsInDatabase: existingGroups.includes(group.groupName)
      }));

      return testGroups;
    } catch (error) {
      logger.error(`Error fetching test groups: ${error.message}`);
      return [];
    }
  }

  private createChunks<T>(array: T[], size: number): T[][] {
    return Array.from(
      { length: Math.ceil(array.length / size) },
      (_, i) => array.slice(i * size, i * size + size)
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
  ): Promise<Promise<void>[]> {
    logger.log('Import response data from TC');
    const headersRequest = this.createHeaders(authToken);
    const chunks = this.createChunks(testGroups.split(','), 2);

    return chunks.map(async chunk => {
      const endpoint = url ?
        `${url}/api/workspace/${tc_workspace}/report/response?dataIds=${chunk.join(',')}` :
        `https://www.iqb-testcenter${server}.de/api/workspace/${tc_workspace}/report/response?dataIds=${chunk.join(',')}`;

      try {
        const { data: rawResponses } = await this.httpService.axiosRef.get<Response[]>(endpoint, {
          httpsAgent: agent,
          headers: headersRequest
        });

        this.persons = await this.personService.createPersonList(rawResponses, Number(workspace_id));

        const personList = await Promise.all(
          this.persons.map(async person => {
            const personWithBooklets = await this.personService.assignBookletsToPerson(person, rawResponses);
            return this.personService.assignUnitsToBookletAndPerson(personWithBooklets, rawResponses);
          })
        );
        await this.personService.processPersonBooklets(personList, Number(workspace_id));
      } catch (error) {
        logger.error('Error processing response chunk:');
        throw error;
      }
    });
  }

  private async importLogs(
    workspace_id: string,
    tc_workspace: string,
    server: string,
    url: string,
    authToken: string,
    testGroups: string
  ): Promise<Promise<void>[]> {
    logger.log('Import logs data from TC');
    const headersRequest = this.createHeaders(authToken);
    const logsChunks = this.createChunks(testGroups.split(','), 2);

    const logsPromises = logsChunks.map(async chunk => {
      const logsUrl = url ?
        `${url}/api/workspace/${tc_workspace}/report/log?dataIds=${chunk.join(',')}` :
        `https://iqb-testcenter${server}.de/api/workspace/${tc_workspace}/report/log?dataIds=${chunk.join(',')}`;
      try {
        const { data: logData } = await this.httpService.axiosRef.get<Log[]>(logsUrl, {
          httpsAgent: agent,
          headers: headersRequest
        });
        const { bookletLogs, unitLogs } = this.separateLogsByType(logData);

        const persons = await this.personService.createPersonList(logData, Number(workspace_id));
        // @ts-expect-error - Method signature mismatch between PersonService and expected types
        await this.personService.processPersonLogs(persons, unitLogs, bookletLogs);
      } catch (error) {
        logger.error('Error processing logs:');
        throw error;
      }
    });

    return logsPromises;
  }

  private separateLogsByType(logData: Log[]): { bookletLogs: Log[], unitLogs: Log[] } {
    return logData.reduce(
      (acc, row) => {
        row.unitname === '' ? acc.bookletLogs.push(row) : acc.unitLogs.push(row);
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
    importOptions: ImportOptions
  ): Promise<{ success: boolean, testFiles: number }> {
    const headersRequest = this.createHeaders(authToken);
    const filesEndpoint = url ?
      `${url}/api/workspace/${tc_workspace}/files` :
      `http://iqb-testcenter${server}.de/api/workspace/${tc_workspace}/files`;

    try {
      const { data: files } = await this.httpService.axiosRef.get<ServerFilesResponse>(filesEndpoint, {
        httpsAgent: agent,
        headers: headersRequest
      });

      const filePromises = this.createFilePromises(files, importOptions);

      const fetchedFiles = await Promise.all(filePromises.map(async filePromise => {
        const file = await filePromise;
        return this.getFile(file, server, tc_workspace, authToken, url);
      }));

      const dbEntries = this.createDatabaseEntries(fetchedFiles, workspace_id);

      await this.workspaceFilesService.testCenterImport(dbEntries);
      return {
        success: fetchedFiles.length > 0,
        testFiles: fetchedFiles.length
      };
    } catch (error) {
      logger.error('Error fetching files:');
      return { success: false, testFiles: 0 };
    }
  }

  private createFilePromises(files: ServerFilesResponse, importOptions: ImportOptions): Promise<File>[] {
    const {
      units,
      definitions,
      player,
      codings,
      testTakers,
      booklets
    } = importOptions;
    const filePromises: Promise<File>[] = [];

    if (player === 'true') {
      filePromises.push(...files.Resource.filter(f => f.name.includes('.html')).map(file => Promise.resolve(file)));
    }
    if (units === 'true') {
      filePromises.push(...files.Unit.map(file => Promise.resolve(file)));
    }
    if (definitions === 'true') {
      filePromises.push(...files.Resource.filter(f => f.name.includes('.voud')).map(file => Promise.resolve(file)));
    }
    if (codings === 'true') {
      filePromises.push(...files.Resource.filter(f => f.name.includes('.vocs')).map(file => Promise.resolve(file)));
    }
    if (booklets === 'true') {
      filePromises.push(...files.Booklet.map(file => Promise.resolve(file)));
    }
    if (testTakers === 'true') {
      filePromises.push(...files.Testtakers.map(file => Promise.resolve(file)));
    }

    return filePromises;
  }

  /**
   * Creates database entries from fetched files
   * @param fetchedFiles The fetched files
   * @param workspace_id The workspace ID
   * @returns An array of database entries
   */
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
    testGroups: string
  ): Promise<Result> {
    const { responses, logs } = importOptions;
    const result: Result = {
      success: false,
      testFiles: 0,
      responses: 0,
      logs: 0
    };

    const promises: Promise<void>[] = [];

    try {
      if (responses === 'true') {
        const responsePromises = await this.importResponses(
          workspace_id, tc_workspace, server, url, authToken, testGroups
        );
        promises.push(...responsePromises);
        result.responses = responsePromises.length;
      }

      if (logs === 'true') {
        const logsPromises = await this.importLogs(
          workspace_id, tc_workspace, server, url, authToken, testGroups
        );
        promises.push(...logsPromises);
        result.logs = logsPromises.length;
      }

      const shouldImportFiles = this.shouldImportFiles(importOptions);
      if (shouldImportFiles) {
        const filesResult = await this.importFiles(
          workspace_id, tc_workspace, server, url, authToken, importOptions
        );
        result.testFiles = filesResult.testFiles;
        result.success = filesResult.success;
      }

      // Wait for all promises to complete
      await Promise.all(promises);
      result.success = true;
      return result;
    } catch (error) {
      logger.error('Error during importWorkspaceFiles:');
      result.success = false;
      return result;
    }
  }

  private shouldImportFiles(importOptions: ImportOptions): boolean {
    const {
      definitions,
      player,
      units,
      codings,
      testTakers,
      booklets
    } = importOptions;
    return definitions === 'true' || player === 'true' || units === 'true' ||
      codings === 'true' || testTakers === 'true' || booklets === 'true';
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
        httpsAgent: agent, // Disable SSL validation for HTTPS requests
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

  private buildFileRequestUrl(file: File, server: string, tcWorkspace: string, url?: string): string {
    return url ?
      `${url}/api/workspace/${tcWorkspace}/file/${file.type}/${file.name}` :
      `http://iqb-testcenter${server}.de/api/workspace/${tcWorkspace}/file/${file.type}/${file.name}`;
  }
}
