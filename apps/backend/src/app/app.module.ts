import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { DatabaseModule } from './database/database.module';
import { AdminModule } from './admin/admin.module';
import { JobQueueModule } from './job-queue/job-queue.module';
import { HealthModule } from './health/health.module';
import { CacheModule } from './cache/cache.module';

@Module({
  imports: [ConfigModule.forRoot({
    isGlobal: true,
    envFilePath: '.env.dev',
    cache: true
  }), AuthModule, DatabaseModule, AdminModule, HttpModule, JobQueueModule, HealthModule, CacheModule],
  controllers: [AppController]
})
export class AppModule {}
