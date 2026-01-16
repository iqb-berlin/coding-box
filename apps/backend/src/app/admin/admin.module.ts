import { Module } from '@nestjs/common';
import { WorkspaceFilesAdminModule } from './workspace-files/workspace-files-admin.module';
import { WorkspaceTestResultsAdminModule } from './workspace-test-results/workspace-test-results-admin.module';
import { WorkspaceCodingAdminModule } from './workspace-coding/workspace-coding-admin.module';
import { WorkspaceUsersAdminModule } from './workspace-users/workspace-users-admin.module';
import { WorkspaceInfoAdminModule } from './workspace-info/workspace-info-admin.module';
import { CoreAdminModule } from './core/core-admin.module';

@Module({
  imports: [
    WorkspaceFilesAdminModule,
    WorkspaceTestResultsAdminModule,
    WorkspaceCodingAdminModule,
    WorkspaceUsersAdminModule,
    WorkspaceInfoAdminModule,
    CoreAdminModule
  ]
})
export class AdminModule { }
