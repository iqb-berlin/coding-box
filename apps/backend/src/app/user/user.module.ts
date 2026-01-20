import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import User from '../database/entities/user.entity';
import WorkspaceUser from '../database/entities/workspace_user.entity';
import { UsersService } from '../database/services/users';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, WorkspaceUser])
  ],
  providers: [
    UsersService
  ],
  exports: [
    UsersService
  ]
})
export class UserModule { }
