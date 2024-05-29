import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import * as https from 'https';
import { catchError, firstValueFrom } from 'rxjs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkspaceService } from './workspace.service';
import Responses from '../entities/responses.entity';
import {
  ImportOptions
} from '../../../../../frontend/src/app/ws-admin/test-center-import/test-center-import.component';

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
  }
};

export type Response = {
  groupname:string,
  loginname : string,
  code : string,
  bookletname : string,
  unitname : string,
  responses : string,
  laststate : string,
};

@Injectable()
export class TestcenterService {
  private readonly logger = new Logger(TestcenterService.name);
  constructor(
    private readonly httpService: HttpService,
    private testFileService: WorkspaceService,
    @InjectRepository(Responses)
    private responsesRepository:Repository<Responses>

  ) {
  }

  async authenticate(credentials: { username: string, password: string, server:string }): Promise<any> {
    const { data } = await firstValueFrom(
      this.httpService.put(`http://iqb-testcenter${credentials.server}.de/api/session/admin`, {
        name: credentials.username,
        password: credentials.password
      }, {
        httpsAgent: agent
      }).pipe(
        catchError(error => {
          throw new Error(error);
        })
      )
    );
    return data;
  }

  async importWorkspaceFiles(
    workspace_id:string,
    tc_workspace:string,
    server:string,
    authToken:string,
    importOptions:ImportOptions
  ): Promise<boolean> {
    const {
      units, responses, definitions, player,codings
    } = importOptions;

    const headersRequest = {
      Authtoken: authToken
    };
    if (responses) {
      const resultsPromise = this.httpService.axiosRef
        .get<TestserverResponse[]>(`http://iqb-testcenter${server}.de/api/workspace/${tc_workspace}/results`, {
        httpsAgent: agent,
        headers: headersRequest
      });
      const report = await resultsPromise.then(res => res).catch(err => { err; });
      if (report) {
        const resultGroups = report.data.map(group => group.groupName);
        // eslint-disable-next-line max-len
        const unitResponsesPromise = this.httpService.axiosRef
          .get<Response[]>(`http://iqb-testcenter${server}.de/api/workspace/${tc_workspace}/report/response?dataIds=${resultGroups.join(',')}`, {
          httpsAgent: agent,
          headers: headersRequest
        });
        const unitResponses = await unitResponsesPromise.then(res => res).catch(err => { err; });
        if (unitResponses) {
          const mappedResponses = unitResponses.data.map(unitResponse => ({
            test_person: unitResponse.loginname + unitResponse.code,
            unit_id: unitResponse.unitname,
            responses: JSON.stringify(unitResponse.responses),
            test_group: unitResponse.groupname,
            workspace_id: Number(workspace_id)
          }));
          await this.responsesRepository.save(mappedResponses, { chunk: 1000 });
        }
      }
    }

    if (definitions || player || units || codings) {
      const filesPromise = this.httpService.axiosRef
        .get<ServerFilesResponse>(`http://iqb-testcenter${server}.de/api/workspace/${tc_workspace}/files`, {
        httpsAgent: agent,
        headers: headersRequest
      });
      const files = await filesPromise.then(res => res.data).catch(err => { err; });
      if (files) {
        // const zipFiles = files.filter(file => file.name.includes('.zip'));
        const unitDefFiles = files.Resource.filter(file => file.name.includes('.voud'));
        const playerFiles = files.Resource.filter(file => file.name.includes('.html'));
        const codingSchemeFiles = files.Resource.filter(file => file.name.includes('.vocs'));
        const unitFiles = files.Unit;
        let promises = [];
        if (player === 'true' && playerFiles.length > 0) {
          const playerPromises = playerFiles
            .map(file => this.getFile(file, server, tc_workspace, authToken));
          promises = [...promises, ...playerPromises];
        }
        if (units === 'true' && unitFiles.length > 0) {
          const unitFilesPromises = unitFiles
            .map(file => this.getFile(file, server, tc_workspace, authToken));
          promises = [...promises, ...unitFilesPromises];
        }
        if (definitions === 'true' && unitDefFiles.length > 0) {
          const unitDefPromises = unitDefFiles
            .map(file => this.getFile(file, server, tc_workspace, authToken));
          promises = [...promises, ...unitDefPromises];
        }
        if (codings === 'true' && codingSchemeFiles.length > 0) {
          const codingSchemePromises = codingSchemeFiles
            .map(file => this.getFile(file, server, tc_workspace, authToken));
          promises = [...promises, ...codingSchemePromises];
        }
        const results = await Promise.all(promises);
        if (results.length > 0) {
          const dbEntries = results.map(result => ({
            filename: result.name,
            file_id: result.id,
            file_type: result.type,
            file_size: result.size,
            workspace_id: workspace_id,
            data: result.data
          }));
          await this.testFileService.testcenterImport(dbEntries);
          return true;
        }
        return false;
      }
      return false;
    }
    return true;
  }

  async getFile(res:File, server:string, tc_workspace:string, authToken:string): Promise<any> {
    const headersRequest = {
      Authtoken: authToken
    };
    const filePromise = this.httpService.axiosRef
      .get<File>(`http://iqb-testcenter${server}.de/api/workspace/${tc_workspace}/file/${res.type}/${res.name}`,
      {
        httpsAgent: agent,
        headers: headersRequest
      });
    const fileData = await filePromise.then(res => res.data).catch(err => { err; });
    return {
      data: fileData, name: res.name, type: res.type, size: res.size, id: res.id
    };
  }
}
