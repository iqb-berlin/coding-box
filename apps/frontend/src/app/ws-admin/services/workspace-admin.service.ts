import { Injectable } from '@angular/core';

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
  private lastTestcenterInstance!: Testcenter[];
  private claims!: WorkspaceAdmin[];

  getAuthToken() : string {
    return this.lastAuthToken;
  }

  getClaims() : WorkspaceAdmin[] {
    return this.claims;
  }

  setLastAuthToken(token:string) {
    this.lastAuthToken = token;
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
}