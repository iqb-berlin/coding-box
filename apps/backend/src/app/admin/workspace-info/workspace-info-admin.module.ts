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
import { AccessRightsMatrixService } from '../workspace/access-rights-matrix.service';

@Module({
  imports: [
    DatabaseModule,
    WorkspaceModule,
    AuthModule,
    CodingModule
  ],
  controllers: [
    WorkspaceController,
    JournalController,
    ValidationTaskController,
    BookletInfoController,
    UnitInfoController,
    MissingsProfilesController
  ],
  providers: [
    AccessRightsMatrixService
  ]
})
export class WorkspaceInfoAdminModule { }
