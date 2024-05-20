import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import * as https from 'https';
import { catchError, firstValueFrom, map } from 'rxjs';
import { WorkspaceService } from '../../database/services/workspace.service';

const agent = new https.Agent({
  rejectUnauthorized: false
});

type ServerFilesResponse = {
  Booklet:[],
  Resource:Resource[],
  Unit:[],
  Testtakers:[],
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

@Injectable()
export class TestcenterService {
  private readonly logger = new Logger(TestcenterService.name);
  constructor(
    private readonly httpService: HttpService,
    private testFileService: WorkspaceService

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

  async importWorkspaceFiles(workspace:string, server:string, authToken:string): Promise<any> {
    const headersRequest = {
      Authtoken: authToken
    };
    const filesPromise = this.httpService.axiosRef
      .get<ServerFilesResponse>(`http://iqb-testcenter${server}.de/api/workspace/${workspace}/files`, {
      httpsAgent: agent,
      headers: headersRequest
    });

    const files = await filesPromise.then(res => res.data.Resource).catch(err => { err; });
    if (files) {
      const promises = files
        .filter(file => file.name.includes('.voud'))
        .map(file => this.getFile(file, server, workspace, authToken, { name: file.id, type: file.type }));
      const results = await Promise.all(promises);
      const dbEntries = results.map(result => ({ filename: result.name, workspace_id: workspace, data: result.data }));
      await this.testFileService.testcenterImport(dbEntries);
    }
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
    return { data: file, name: fileOptions.name, type: fileOptions.type };
  }
}
