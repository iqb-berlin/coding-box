/* eslint-disable max-classes-per-file */
import { DynamicModule, Global, Module } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bull';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import { Connection, DataSource, getMetadataArgsStorage } from 'typeorm';
import { AppModule } from './app.module';
import { DatabaseModule } from './database/database.module';
import { CacheModule } from './cache/cache.module';
import { CacheClientModule } from './cache/cache-client.module';
import { CacheService } from './cache/cache.service';
import { JobQueueModule } from './job-queue/job-queue.module';
import { JobQueueClientModule } from './job-queue/job-queue-client.module';
import { JobQueueService } from './job-queue/job-queue.service';
import { WorkspaceFilesController } from './admin/workspace/workspace-files.controller';
import { ContentPoolIntegrationService } from './admin/content-pool/content-pool-integration.service';
import { WorkspaceSettingsService } from './workspace/workspace-settings.service';
import { WorkspaceFilesAdminModule } from './admin/workspace-files/workspace-files-admin.module';
import FileUpload from './database/entities/file_upload.entity';

jest.mock('./config/environment.validation', () => {
  const actual = jest.requireActual('./config/environment.validation');
  return {
    ...actual,
    validateEnvironment: (config: Record<string, unknown>) => actual.validateEnvironment({
      ...config,
      POSTGRES_HOST: 'localhost',
      POSTGRES_PORT: '5432',
      POSTGRES_USER: 'test',
      POSTGRES_PASSWORD: 'test-password',
      POSTGRES_DB: 'test',
      JWT_SECRET: 'test-secret',
      KEYCLOAK_CLIENT_ID: 'test',
      OIDC_ISSUER: 'http://test.invalid/realms/test',
      OIDC_JWKS_URI: 'http://test.invalid/realms/test/certs'
    })
  };
});

@Global()
@Module({
  providers: [{ provide: DataSource, useValue: {} }, { provide: Connection, useValue: {} }],
  exports: [DataSource, Connection]
})
class DatabaseStubModule {}

@Module({ providers: [{ provide: CacheService, useValue: {} }], exports: [CacheService] })
class CacheStubModule {}

@Module({ providers: [{ provide: JobQueueService, useValue: {} }], exports: [JobQueueService] })
class QueueStubModule {}

@Module({
  imports: Reflect.getMetadata(MODULE_METADATA.IMPORTS, WorkspaceFilesAdminModule)
    .map((imported: DynamicModule) => (imported.module === TypeOrmModule ?
      TypeOrmModule.forFeature([FileUpload]) : imported)),
  controllers: Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, WorkspaceFilesAdminModule),
  providers: Reflect.getMetadata(MODULE_METADATA.PROVIDERS, WorkspaceFilesAdminModule)
})
class MissingSettingsRepositoryModule {}

function applicationBuilder() {
  const builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideModule(DatabaseModule).useModule(DatabaseStubModule)
    .overrideModule(CacheModule)
    .useModule(CacheStubModule)
    .overrideModule(CacheClientModule)
    .useModule(CacheStubModule)
    .overrideModule(JobQueueModule)
    .useModule(QueueStubModule)
    .overrideModule(JobQueueClientModule)
    .useModule(QueueStubModule);
  builder.overrideProvider(getQueueToken('database-export')).useValue({
    process: jest.fn(), on: jest.fn(), close: jest.fn()
  });
  // Override registered repositories only. A missing feature import must still fail.
  for (const entity of getMetadataArgsStorage().tables) {
    builder.overrideProvider(getRepositoryToken(entity.target as never)).useValue({});
  }
  return builder;
}

describe('Application module boundaries', () => {
  it('rejects a missing settings repository even with stubbed infrastructure', async () => {
    await expect(applicationBuilder()
      .overrideModule(WorkspaceFilesAdminModule).useModule(MissingSettingsRepositoryModule)
      .compile()).rejects.toThrow('SettingRepository');
  });

  it('starts all application controllers with repositories registered in their actual feature scopes', async () => {
    const builder = applicationBuilder();
    const module = await builder.compile();
    const app = module.createNestApplication();
    app.useLogger(false);
    try {
      await app.init();
      expect(module.get(WorkspaceFilesController)).toBeInstanceOf(WorkspaceFilesController);
      expect(module.get(ContentPoolIntegrationService)).toBeInstanceOf(ContentPoolIntegrationService);
      expect(module.get(WorkspaceSettingsService)).toBeInstanceOf(WorkspaceSettingsService);
    } finally {
      await app.close();
    }
  });
});
