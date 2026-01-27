import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { UserModule } from '../../user/user.module';
import { WorkspaceModule } from '../../workspace/workspace.module';
import { AuthModule } from '../../auth/auth.module';
import { WorkspaceUsersController } from '../workspace/workspace-users.controller';
import { AccessRightsMatrixService } from '../workspace/access-rights-matrix.service';

@Module({
  imports: [
    DatabaseModule,
    UserModule,
    WorkspaceModule,
    AuthModule
  ],
  controllers: [
    WorkspaceUsersController
  ],
  providers: [
    AccessRightsMatrixService
  ]
})
export class WorkspaceUsersAdminModule { }
