import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { UsersController } from './users/users.controller';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { WorkspaceController } from './workspace/workspace.controller';
import { TestFilesController } from './test-files/test-files.controller';
import { TestcenterService } from '../testcenter/service/testcenter.service';
import { ResourcePackageService } from '../database/services/resource-package.service';
import ResourcePackage from '../database/entities/resource-package.entity';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    HttpModule,
    ResourcePackage
  ],
  controllers: [
    UsersController, WorkspaceController, TestFilesController
  ],
  providers: [TestcenterService]
})
export class AdminModule {}
