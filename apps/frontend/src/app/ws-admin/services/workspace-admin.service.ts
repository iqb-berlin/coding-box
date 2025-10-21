import { Injectable } from '@angular/core';
import { TestGroupsInfoDto } from '../../../../../../api-dto/files/test-groups-info.dto';

export type WorkspaceAdmin = {
  label: string,
  id: string,
  type: string,
  flags: {
    mode: string
  }
};

export type Testcenter = {
  id:number,
  label:string
};
@Injectable({
  providedIn: 'root'
})
export class WorkspaceAdminService {
  private lastAuthToken: string = '';
  private lastServer: string = '';
  private lastUrl: string = '';
  private lastTestcenterInstance!: Testcenter[];
  private claims!: WorkspaceAdmin[];
  private testGroups!: TestGroupsInfoDto[];

  getAuthToken() : string {
    return this.lastAuthToken;
  }

  getLastServer() : string {
    return this.lastServer;
  }

  getLastUrl() : string {
    return this.lastUrl;
  }

  getClaims() : WorkspaceAdmin[] {
    return this.claims;
  }

  setLastAuthToken(token:string) {
    this.lastAuthToken = token;
  }

  setLastServer(server:string) {
    this.lastServer = server;
  }

  setLastUrl(url:string) {
    this.lastUrl = url;
  }

  setClaims(claims:WorkspaceAdmin[]) {
    this.claims = claims;
  }

  setlastTestcenterInstance(testcenter:Testcenter[]) {
    this.lastTestcenterInstance = testcenter;
  }

  getlastTestcenterInstance() {
    return this.lastTestcenterInstance;
  }

  getTestGroups() {
    return this.testGroups;
  }

  setTestGroups(testGroups: TestGroupsInfoDto[]) {
    this.testGroups = testGroups;
  }
}
