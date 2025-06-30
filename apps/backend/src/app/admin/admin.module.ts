import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { UsersController } from './users/users.controller';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { WorkspaceController } from './workspace/workspace.controller';
import { WorkspaceFilesController } from './workspace/workspace-files.controller';
import { WorkspaceTestResultsController } from './workspace/workspace-test-results.controller';
import { WorkspaceUsersController } from './workspace/workspace-users.controller';
import { WorkspaceCodingController } from './workspace/workspace-coding.controller';
import { WorkspaceTestCenterController } from './workspace/workspace-test-center.controller';
import { WorkspacePlayerController } from './workspace/workspace-player.controller';
import { LogoController } from './logo/logo.controller';
import { UnitTagsController } from './unit-tags/unit-tags.controller';
import { UnitNotesController } from './unit-notes/unit-notes.controller';
import { ResourcePackageController } from './resource-packages/resource-package.controller';
import { JournalController } from './workspace/journal.controller';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    HttpModule
  ],
  controllers: [
    UsersController,
    WorkspaceController,
    WorkspaceFilesController,
    WorkspaceTestResultsController,
    WorkspaceUsersController,
    WorkspaceCodingController,
    WorkspaceTestCenterController,
    WorkspacePlayerController,
    LogoController,
    UnitTagsController,
    UnitNotesController,
    ResourcePackageController,
    JournalController
  ],
  providers: []
})
export class AdminModule {}
