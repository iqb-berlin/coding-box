import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import * as https from 'https';
import { catchError, firstValueFrom } from 'rxjs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
// import AdmZip = require('adm-zip');
import { WorkspaceService } from './workspace.service';
import Responses from '../entities/responses.entity';
import {
  ImportOptions
} from '../../../../../frontend/src/app/ws-admin/test-center-import/test-center-import.component';
import FileUpload from '../entities/file_upload.entity';

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

  async authenticate(credentials: { username: string, password: string, server:string }): Promise<string> {
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
      units, responses, definitions, player, codings
    } = importOptions;

    const headersRequest = {
      Authtoken: authToken
    };
    if (responses === 'true') {
      const resultsPromise = this.httpService.axiosRef
        .get<TestserverResponse[]>(`http://iqb-testcenter${server}.de/api/workspace/${tc_workspace}/results`, {
        httpsAgent: agent,
        headers: headersRequest
      });
      const report = await resultsPromise.then(res => res);
      if (report) {
        const resultGroupNames = report.data.map(group => group.groupName);
        const createChunks = (a, size) => Array.from(
          new Array(Math.ceil(a.length / size)),
          (_, i) => a.slice(i * size, i * size + size)
        );
        const chunks = createChunks(resultGroupNames, 25);
        const unitResponsesPromises = [];
        chunks.forEach(chunk => {
          const unitResponsesPromise = this.httpService.axiosRef
            .get<Response[]>(`http://iqb-testcenter${server}.de/api/workspace/
          ${tc_workspace}/report/response?dataIds=${chunk.join(',')}`,
          {
            httpsAgent: agent,
            headers: headersRequest
          });
          unitResponsesPromises.push(unitResponsesPromise);
        });

        const unitResponses = await Promise.all(unitResponsesPromises).then(res => res);
        const unitResponsesData = unitResponses.map(unitResponse => unitResponse.data).flat();
        if (unitResponses) {
          const mappedResponses = unitResponsesData.map(unitResponse => ({
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

    if (definitions === 'true' || player === 'true' || units === 'true' || codings === 'true') {
      const filesPromise = this.httpService.axiosRef
        .get<ServerFilesResponse>(
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
        let promises = [];
        // const zipPromises = zipFiles
        //   .map(file => this.getPackage(file, server, tc_workspace, authToken));
        // promises = [...promises, ...packagesPromises];

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
        const results :File[] = await Promise.all(promises);
        if (results.length > 0) {
          const dbEntries: unknown = results.map(result => ({
            filename: result.name || '',
            file_id: result.id,
            file_type: result.type,
            file_size: result.size,
            workspace_id: workspace_id,
            data: result.data
          }));
          await this.testFileService.testCenterImport(dbEntries as FileUpload[]);
          return true;
        }
        return false;
      }
      return false;
    }
    return true;
  }

  async getFile(file:File, server:string, tc_workspace:string, authToken:string):
  Promise<{
    data: File, name: string, type: string, size: number, id: string
  }> {
    const headersRequest = {
      Authtoken: authToken
    };
    const filePromise = this.httpService.axiosRef
      .get<File>(`http://iqb-testcenter${server}.de/api/workspace/${tc_workspace}/file/${file.type}/${file.name}`,
      {
        httpsAgent: agent,
        headers: headersRequest
      });
    const fileData = await filePromise.then(res => res.data);
    return {
      data: fileData, name: file.name, type: file.type, size: file.size, id: file.id
    };
  }

  // async getPackage(res:File, server:string, tc_workspace:string, authToken:string): Promise<any> {
  //   const headersRequest = {
  //     Authtoken: authToken
  //   };
  //   const filePromise = this.httpService.axiosRef
  //     .get(`http://iqb-testcenter${server}.de/api/workspace/${tc_workspace}/file/${res.type}/${res.name}`,
  //       {
  //         httpsAgent: agent,
  //         headers: headersRequest
  //       });
  //   //const fileData = await filePromise.then(res => res.data);
  //   //const zip = new AdmZip(Buffer.from(fileData));
  //   //const packageFiles = zip.getEntries().map(entry => entry.entryName);
  //
  //   // return {
  //   //   data: fileData, name: res.name, type: res.type, size: res.size, id: res.id
  //   // };
  // }
}
