import { Injectable } from '@angular/core';
import WorkspaceAdmin from '../../../../../backend/src/app/database/entities/workspace-admin.entity';

@Injectable({
  providedIn: 'root'
})
export class WorkspaceAdminService {
  lastAuthToken: string | null = null;
  workspaces!: WorkspaceAdmin[];

  getAuthToken() : string | null {
    return this.lastAuthToken;
  }
}
