import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { DatabaseModule } from './database/database.module';
import { UserModule } from './user/user.module';
import { CodingModule } from './coding/coding.module';
import { WorkspaceModule } from './workspace/workspace.module';
import { AdminModule } from './admin/admin.module';
import { JobQueueModule } from './job-queue/job-queue.module';
import { HealthModule } from './health/health.module';
import { CacheModule } from './cache/cache.module';
import { WsgAdminModule } from './wsg-admin/wsg-admin.module';

@Module({
  imports: [ConfigModule.forRoot({
    isGlobal: true,
    envFilePath: '.env.dev',
    cache: true
  }), AuthModule, DatabaseModule, UserModule, CodingModule, WorkspaceModule, AdminModule, HttpModule, JobQueueModule, HealthModule, CacheModule, WsgAdminModule],
  controllers: [AppController]
})
export class AppModule { }
