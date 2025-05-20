import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import * as https from 'https';
import { catchError, firstValueFrom } from 'rxjs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { logger } from 'nx/src/utils/logger';
// eslint-disable-next-line import/no-cycle
import { Person, Response, WorkspaceService } from './workspace.service';
import {
  ImportOptions
} from '../../../../../frontend/src/app/ws-admin/components/test-center-import/test-center-import.component';

import Logs from '../entities/logs.entity';
import { TestGroupsInfoDto } from '../../../../../../api-dto/files/test-groups-info.dto';
import { PersonService } from './person.service';

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
    private workspaceService: WorkspaceService,
    @InjectRepository(Logs)
    private logsRepository:Repository<Logs>

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
      return response.data;
    } catch (error) {
      logger.error(`Error fetching test groups: ${error.message}`);
      return [];
    }
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
    const {
      units, responses, definitions, player, codings, logs, testTakers, booklets
    } = importOptions;

    const headersRequest = {
      Authtoken: authToken
    };

    const result: Result = {
      success: false,
      testFiles: 0,
      responses: 0,
      logs: 0
    };

    const promises: Promise<void>[] = [];

    const createChunks = <T>(array: T[], size: number): T[][] => Array.from({ length: Math.ceil(array.length / size) }, (_, i) => array.slice(i * size, i * size + size));

    try {
      // === Import Responses ===
      if (responses === 'true') {
        logger.log('Import response data from TC');
        const chunks = createChunks(testGroups.split(','), 2);

        const responsePromises = chunks.map(async chunk => {
          const endpoint = url ?
            `${url}/api/workspace/${tc_workspace}/report/response?dataIds=${chunk.join(',')}` :
            `https://www.iqb-testcenter${server}/api/workspace/${tc_workspace}/report/response?dataIds=${chunk.join(',')}`;

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

        promises.push(...responsePromises);
      }

      // === Import Logs ===
      if (logs === 'true') {
        logger.log('Import logs data from TC');
        const logsChunks = createChunks(testGroups.split(','), 2);

        const logsPromises = logsChunks.map(async chunk => {
          const logsUrl = url ?
            `${url}/api/workspace/${tc_workspace}/report/log?dataIds=${chunk.join(',')}` :
            `https://iqb-testcenter${server}.de/api/workspace/${tc_workspace}/report/log?dataIds=${chunk.join(',')}`;
          try {
            const { data: logData } = await this.httpService.axiosRef.get<Log[]>(logsUrl, {
              httpsAgent: agent,
              headers: headersRequest
            });
            const { bookletLogs, unitLogs } = logData.reduce(
              (acc, row) => {
                row.unitname === '' ? acc.bookletLogs.push(row) : acc.unitLogs.push(row);
                return acc;
              },
              { bookletLogs: [], unitLogs: [] }
            );

            const persons = await this.personService.createPersonList(logData, Number(workspace_id));
            await this.personService.processPersonLogs(persons, unitLogs, bookletLogs);
          } catch (error) {
            logger.error('Error processing logs:');
            throw error;
          }
        });

        promises.push(...logsPromises);
      }

      // === Import Files ===
      if (definitions === 'true' || player === 'true' || units === 'true' ||
        codings === 'true' || testTakers === 'true' || booklets === 'true') {
        const filesEndpoint = url ?
          `${url}/api/workspace/${tc_workspace}/files` :
          `http://iqb-testcenter${server}.de/api/workspace/${tc_workspace}/files`;

        try {
          const { data: files } = await this.httpService.axiosRef.get<ServerFilesResponse>(filesEndpoint, {
            httpsAgent: agent,
            headers: headersRequest
          });

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

          const fetchedFiles = await Promise.all(filePromises.map(async filePromise => {
            const file = await filePromise;
            return this.getFile(file, server, tc_workspace, authToken, url);
          }));

          const dbEntries = fetchedFiles.map(res => ({
            filename: res.name,
            file_id: res.id,
            file_type: res.type,
            file_size: res.size,
            workspace_id: workspace_id,
            data: res.data
          }));

          await this.workspaceService.testCenterImport(dbEntries);
          result.testFiles = fetchedFiles.length;
          if (fetchedFiles.length > 0) {
            result.success = true;
          }
        } catch (error) {
          logger.error('Error fetching files:');
        }
      }

      await Promise.all(promises);
      result.success = true;
      return result;
    } catch (error) {
      logger.error('Error during importWorkspaceFiles:');
      result.success = false;
      return result;
    }
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
    const headersRequest = {
      Authtoken: authToken
    };

    const requestUrl = url ?
      `${url}/api/workspace/${tcWorkspace}/file/${file.type}/${file.name}` :
      `http://iqb-testcenter${server}.de/api/workspace/${tcWorkspace}/file/${file.type}/${file.name}`;

    try {
      const response = await this.httpService.axiosRef.get<File>(requestUrl, {
        httpsAgent: agent, // Disable SSL validation for HTTPS requests
        headers: headersRequest // Add the authorization headers
      });

      const fileData = response.data;

      return {
        data: fileData,
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
}
