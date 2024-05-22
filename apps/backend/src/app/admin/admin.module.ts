import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { UsersController } from './users/users.controller';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { WorkspaceController } from './workspace/workspace.controller';
import { TestFilesController } from './test-files/test-files.controller';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    HttpModule
  ],
  controllers: [
    UsersController, WorkspaceController, TestFilesController
  ],
  providers: []
})
export class AdminModule {}
