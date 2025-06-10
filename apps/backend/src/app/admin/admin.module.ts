import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { UsersController } from './users/users.controller';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { WorkspaceController } from './workspace/workspace.controller';
import { LogoController } from './logo/logo.controller';
import { UnitTagsController } from './unit-tags/unit-tags.controller';
import { UnitNotesController } from './unit-notes/unit-notes.controller';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    HttpModule
  ],
  controllers: [
    UsersController, WorkspaceController, LogoController, UnitTagsController, UnitNotesController
  ],
  providers: []
})
export class AdminModule {}
