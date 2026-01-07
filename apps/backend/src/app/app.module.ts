import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { AdminModule } from './admin/admin.module';
import { UsersModule } from './users/users.module';
import { WorkspacesModule } from './workspaces/workspaces.module';
import { CodingModule } from './coding/coding.module';
import { JobQueueModule } from './job-queue/job-queue.module';
import { HealthModule } from './health/health.module';
import { CacheModule } from './cache/cache.module';
import { WsgAdminModule } from './wsg-admin/wsg-admin.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env.dev',
      cache: true
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get('POSTGRES_HOST'),
        port: +configService.get<number>('POSTGRES_PORT'),
        username: configService.get('POSTGRES_USER'),
        password: configService.get('POSTGRES_PASSWORD'),
        database: configService.get('POSTGRES_DB'),
        autoLoadEntities: true,
        synchronize: false
      }),
      inject: [ConfigService]
    }),
    AuthModule,
    UsersModule,
    WorkspacesModule,
    CodingModule,
    AdminModule,
    HttpModule,
    JobQueueModule,
    HealthModule,
    CacheModule,
    WsgAdminModule
  ],
  controllers: [AppController]
})
export class AppModule {}
