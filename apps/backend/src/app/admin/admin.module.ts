import { Module } from '@nestjs/common';
import { UsersController } from './users/users.controller';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { WorkspaceController } from './workspace/workspace.controller';

@Module({
  imports: [
    DatabaseModule,
    AuthModule
  ],
  controllers: [
    UsersController, WorkspaceController
  ]
})
export class AdminModule {}
