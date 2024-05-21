import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import * as https from 'https';
import { catchError, firstValueFrom } from 'rxjs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkspaceService } from './workspace.service';
import Responses from '../entities/responses.entity';

const agent = new https.Agent({
  rejectUnauthorized: false
});

type ServerFilesResponse = {
  Booklet:[],
  Resource:Resource[],
  Unit:[],
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

type Resource = {
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

  async importWorkspaceFiles(workspace:string,
                             server:string,
                             authToken:string,
                             responses:string,
                             definitions:string): Promise<boolean> {
    const headersRequest = {
      Authtoken: authToken
    };
    if (responses) {
      const resultsPromise = this.httpService.axiosRef
        .get<TestserverResponse[]>(`http://iqb-testcenter${server}.de/api/workspace/${workspace}/results`, {
        httpsAgent: agent,
        headers: headersRequest
      });
      const report = await resultsPromise.then(res => res).catch(err => { err; });
      if (report) {
        const resultGroups = report.data.map(group => group.groupName);
        // eslint-disable-next-line max-len
        const unitResponsesPromise = this.httpService.axiosRef.get<Response[]>(`http://iqb-testcenter${server}.de/api/workspace/${workspace}/report/response?dataIds=${resultGroups.join(',')}`, {
          httpsAgent: agent,
          headers: headersRequest
        });
        const unitResponses = await unitResponsesPromise.then(res => res).catch(err => { err; });
        if (unitResponses) {
          const mappedResponses = unitResponses.data.map(unitResponse => ({
            test_person: unitResponse.loginname + unitResponse.code,
            unit_id: unitResponse.unitname,
            responses: JSON.stringify(unitResponse.responses),
            test_group: unitResponse.groupname
          }));
          await this.responsesRepository.save(mappedResponses, { chunk: 1000 });
        }
      }
    }

    if (definitions) {
      console.log('===', responses, definitions);
      const filesPromise = this.httpService.axiosRef
        .get<ServerFilesResponse>(`http://iqb-testcenter${server}.de/api/workspace/${workspace}/files`, {
        httpsAgent: agent,
        headers: headersRequest
      });
      const filenames = await filesPromise.then(res => res.data.Resource).catch(err => { err; });
      console.log('filenames', filenames);
      const files = [];
      if (files) {
        // console.log(files,'files');
        const zipFiles = files.filter(file => file.name.includes('.zip'));
        const unitDefFiles = files.filter(file => file.name.includes('.voud'));
        const playerFiles = files.filter(file => file.name.includes('.html'));
        const notZipFiles = [...unitDefFiles, ...playerFiles];
        console.log({
          zipFiles,
          notZipFiles
        });
        const notZipFilesPromises = notZipFiles
          .map(file => this.getFile(file, server, workspace, authToken, {
            name: file.id,
            type: file.type
          }));
        const results = await Promise.all(notZipFilesPromises);
        if (results.length > 0) {
          const dbEntries = results.map(result => ({
            filename: result.name,
            workspace_id: workspace,
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

  async getFile(res:Resource, server:string, workspace:string, authToken:string, fileOptions:any): Promise<any> {
    const headersRequest = {
      Authtoken: authToken
    };
    const filePromise = this.httpService.axiosRef
      .get<Resource>(`http://iqb-testcenter${server}.de/api/workspace/${workspace}/file/Resource/${res.name}`,
      {
        httpsAgent: agent,
        headers: headersRequest
      });
    const file = await filePromise.then(res => res.data).catch(err => { err; });
    console.log({ data: file, name: fileOptions.name, type: fileOptions.type });
    return { data: file, name: fileOptions.name, type: fileOptions.type };
  }
}
