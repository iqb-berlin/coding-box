import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import * as https from 'https';
import { catchError, firstValueFrom } from 'rxjs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkspaceService } from './workspace.service';
import Responses from '../entities/responses.entity';
import {
  ImportOptions
} from '../../../../../frontend/src/app/ws-admin/components/test-center-import/test-center-import.component';
import FileUpload from '../entities/file_upload.entity';
import { ResponseDto } from '../../../../../../api-dto/responses/response-dto';
import { LogsDto } from '../../../../../../api-dto/logs/logs-dto';
import Logs from '../entities/logs.entity';

const agent = new https.Agent({
  rejectUnauthorized: false
});

type ServerFilesResponse = {
  Booklet:[],
  Resource:File[],
  Unit:File[],
  Testtakers:[],
};

type TestserverResponse = {
  groupName: string,
  groupLabel: string,
  bookletsStarted: number,
  numUnitsMin: number,
  numUnitsMax: number,
  numUnitsTotal: number,
  numUnitsAvg: number,
  lastChange: number,
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

export type UnitResponse = {
  groupname:string,
  loginname : string,
  code : string,
  bookletname : string,
  unitname : string,
  responses : Array<{ id: string; content: string; ts: number; responseType: string }>,
  laststate : string,
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
    private readonly httpService: HttpService,
    private workspaceService: WorkspaceService,
    @InjectRepository(Responses)
    private responsesRepository:Repository<Responses>,
    @InjectRepository(Logs)
    private logsRepository:Repository<Logs>

  ) {
  }

  async authenticate(credentials: { username: string; password: string; server: string; url: string }): Promise<string> {
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

  async importWorkspaceFiles(
    workspace_id:string,
    tc_workspace:string,
    server:string,
    url:string,
    authToken:string,
    importOptions:ImportOptions
  ): Promise<Result> {
    const {
      units, responses, definitions, player, codings, logs, testTakers, booklets
    } = importOptions;

    const headersRequest = {
      Authtoken: authToken
    };

    const result: Result = {
      success: false, testFiles: 0, responses: 0, logs: 0
    };

    if (responses === 'true') {
      const resultsPromise = this.httpService.axiosRef
        .get<TestserverResponse[]>(url ? `${url}/api/workspace/${tc_workspace}/results` :
        `http://iqb-testcenter${server}.de/api/workspace/${tc_workspace}/results`, {
        httpsAgent: agent,
        headers: headersRequest
      });
      const report = await resultsPromise.then(res => res);
      if (!report) {
        throw new Error('could not obtain information about groups from TC');
      }
      const resultGroupNames = report.data.map(group => group.groupName);
      const createChunks = (a, size) => Array.from(
        new Array(Math.ceil(a.length / size)),
        (_, i) => a.slice(i * size, i * size + size)
      );

      const chunks = createChunks(resultGroupNames, 2);
      const unitResponsesPromises = chunks.map(async chunk => {
        const endpoint = url ?
          `${url}/api/workspace/${tc_workspace}/report/response?dataIds=${chunk.join(',')}` :
          `http://iqb-testcenter${server}.de/api/workspace/${tc_workspace}/report/response?dataIds=${chunk.join(',')}`;

        try {
          const { data: rawResponses } = await this.httpService.axiosRef.get<UnitResponse[]>(endpoint, {
            httpsAgent: agent,
            headers: headersRequest
          });

          const rows: ResponseDto[] = rawResponses.map((unitResponse: UnitResponse) => ({
            test_person: TestcenterService.getTestPersonName(unitResponse),
            unit_id: unitResponse.unitname,
            responses: unitResponse.responses,
            test_group: unitResponse.groupname,
            workspace_id: Number(workspace_id),
            unit_state: JSON.parse(unitResponse.laststate),
            booklet_id: unitResponse.bookletname,
            id: undefined,
            created_at: undefined
          }));

          const cleanedRows = WorkspaceService.cleanResponses(rows);
          await this.responsesRepository.upsert(cleanedRows, ['test_person', 'unit_id']);
        } catch (error) {
          console.error('Error processing chunk:', error.message || error);
          throw error; // Rethrow to handle it globally
        }
      });

      try {
        await Promise.all(unitResponsesPromises);
        result.success = true;
        result.responses = report.data.length; // Assuming `report.data` is accessible here
      } catch (error) {
        result.success = false;
      }
    }

    if (logs === 'true') {
      try {
        const resultsUrl = url ?
          `${url}api/workspace/${tc_workspace}/results` :
          `http://iqb-testcenter${server}.de/api/workspace/${tc_workspace}/results`;

        const report = await this.httpService.axiosRef.get<TestserverResponse[]>(resultsUrl, {
          httpsAgent: agent,
          headers: headersRequest
        });

        if (!report || !report.data) {
          throw new Error('Could not obtain information about groups from TC');
        }

        // extract group name
        const resultGroupNames = report.data.map(group => group.groupName);

        // function to create chuncs
        const createChunks = <T>(array: T[], size: number): T[][] => Array.from({ length: Math.ceil(array.length / size) }, (_, i) => array.slice(i * size, i * size + size)
        );

        // Split group names into chunks of 2 elements each
        const chunks = createChunks(resultGroupNames, 2);

        // Create promises for fetching the logs
        const fetchLogsForChunks = async (chunk: string[]): Promise<void> => {
          const logsUrl = url ?
            `${url}/api/workspace/${tc_workspace}/report/log?dataIds=${chunk.join(',')}` :
            `http://iqb-testcenter${server}.de/api/workspace/${tc_workspace}/report/log?dataIds=${chunk.join(',')}`;

          const logsResponse = await this.httpService.axiosRef.get<Log[]>(logsUrl, {
            httpsAgent: agent,
            headers: headersRequest
          });

          if (logsResponse && logsResponse.data) {
            // Convert logs into the desired format
            const logsToSave: LogsDto[] = logsResponse.data.map((log: Log) => ({
              unit_id: log.unitname,
              timestamp: log.timestamp,
              test_group: log.groupname,
              workspace_id: Number(workspace_id),
              log_entry: log.logentry,
              booklet_id: log.bookletname,
              id: undefined
            }));

            // Save logs (chunk-wise processing for large data volumes)
            await this.logsRepository.save(logsToSave, { chunk: 50000 });
          }
        };

        // Retrieve and save all logs for the respective chunks in parallel
        await Promise.all(chunks.map(fetchLogsForChunks));

        // Record success
        result.success = true;
        result.logs = report.data.length;
      } catch (error) {
        // handle errors
        result.success = false;
        console.error('Error fetching logs:', error.message);
      }
    }

    if (definitions === 'true' ||
      player === 'true' ||
      units === 'true' ||
      codings === 'true' ||
      testTakers === 'true' ||
      booklets === 'true'
    ) {
      const filesPromise = this.httpService.axiosRef
        .get<ServerFilesResponse>(
        url ? `${url}/api/workspace/${tc_workspace}/files` :
          `http://iqb-testcenter${server}.de/api/workspace/${tc_workspace}/files`,
        {
          httpsAgent: agent,
          headers: headersRequest
        });
      const files = await filesPromise.then(res => res.data);
      if (files) {
        // const zipFiles = files.Resource.filter(file => file.name.includes('.zip'));
        const unitDefFiles = files.Resource.filter(file => file.name.includes('.voud'));
        const playerFiles = files.Resource.filter(file => file.name.includes('.html'));
        const codingSchemeFiles = files.Resource.filter(file => file.name.includes('.vocs'));
        const unitFiles = files.Unit;
        const bookletFiles = files.Booklet;
        const testTakerFiles = files.Testtakers;
        let promises = [];
        // const zipPromises = zipFiles
        //   .map(file => this.getPackage(file, server, tc_workspace, authToken));
        // promises = [...promises, ...packagesPromises];

        // TODO: Chunks!
        if (player === 'true' && playerFiles.length > 0) {
          const playerPromises = playerFiles
            .map(file => this.getFile(file, server, tc_workspace, authToken, url));
          promises = [...promises, ...playerPromises];
        }
        if (units === 'true' && unitFiles.length > 0) {
          const unitFilesPromises = unitFiles
            .map(file => this.getFile(file, server, tc_workspace, authToken, url));
          promises = [...promises, ...unitFilesPromises];
        }
        if (definitions === 'true' && unitDefFiles.length > 0) {
          const unitDefPromises = unitDefFiles
            .map(file => this.getFile(file, server, tc_workspace, authToken, url));
          promises = [...promises, ...unitDefPromises];
        }
        if (codings === 'true' && codingSchemeFiles.length > 0) {
          const codingSchemePromises = codingSchemeFiles
            .map(file => this.getFile(file, server, tc_workspace, authToken, url));
          promises = [...promises, ...codingSchemePromises];
        }
        if (booklets === 'true' && bookletFiles.length > 0) {
          const bookletPromises = bookletFiles
            .map(file => this.getFile(file, server, tc_workspace, authToken, url));
          promises = [...promises, ...bookletPromises];
        }
        if (testTakers === 'true' && testTakerFiles.length > 0) {
          const testTakersPromises = testTakerFiles
            .map(file => this.getFile(file, server, tc_workspace, authToken, url));
          promises = [...promises, ...testTakersPromises];
        }
        const results :File[] = await Promise.all(promises);
        if (results.length > 0) {
          const dbEntries: unknown = results.map(res => ({
            filename: res.name || '',
            file_id: res.id,
            file_type: res.type,
            file_size: res.size,
            workspace_id: workspace_id,
            data: res.data
          }));
          await this.workspaceService.testCenterImport(dbEntries as FileUpload[]);
          result.success = true;
          result.testFiles = results.length;
          return result;
        }
        result.success = false;
        return result;
      }
      result.success = false;
      return result;
    }
    result.success = true;
    return result;
  }

  private static getTestPersonName(unitResponse: UnitResponse): string {
    return `${unitResponse.loginname}@${unitResponse.code}@${unitResponse.bookletname}`;
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

    // Construct the request URL based on the provided url or fallback to the default URL
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
      console.error(`Failed to fetch file: ${file.name}`, error);

      throw new Error('Unable to fetch the file from server.');
    }
  }
}
