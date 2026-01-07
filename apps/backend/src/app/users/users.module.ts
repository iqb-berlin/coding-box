import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import User from './entities/user.entity';
import WorkspaceUser from '../workspaces/entities/workspace_user.entity';
import { UsersService } from './services/users.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      WorkspaceUser
    ])
  ],
  providers: [
    UsersService
  ],
  exports: [
    UsersService,
    TypeOrmModule // Exporting TypeOrmModule allows other modules to inject Repository<User> if really needed
  ]
})
export class UsersModule {}
