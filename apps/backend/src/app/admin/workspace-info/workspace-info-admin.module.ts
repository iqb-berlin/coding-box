import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { WorkspaceModule } from '../../workspace/workspace.module';
import { AuthModule } from '../../auth/auth.module';
import { CodingModule } from '../../coding/coding.module';
import { WorkspaceController } from '../workspace/workspace.controller';
import { JournalController } from '../workspace/journal.controller';
import { ValidationTaskController } from '../workspace/validation-task.controller';
import { BookletInfoController } from '../workspace/booklet-info.controller';
import { UnitInfoController } from '../workspace/unit-info.controller';
import { MissingsProfilesController } from '../workspace/missings-profiles.controller';
import { WorkspaceProcessesController } from '../workspace/workspace-processes.controller';
import { AccessRightsMatrixService } from '../workspace/access-rights-matrix.service';
import { JobQueueModule } from '../../job-queue/job-queue.module';

@Module({
  imports: [
    DatabaseModule,
    WorkspaceModule,
    AuthModule,
    CodingModule,
    JobQueueModule
  ],
  controllers: [
    WorkspaceController,
    JournalController,
    ValidationTaskController,
    BookletInfoController,
    UnitInfoController,
    MissingsProfilesController,
    WorkspaceProcessesController
  ],
  providers: [
    AccessRightsMatrixService
  ]
})
export class WorkspaceInfoAdminModule { }
