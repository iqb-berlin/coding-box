import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RedisModule } from '@nestjs-modules/ioredis';
import { CacheService } from './cache.service';
import { UploadSessionStore } from './upload-session.store';

@Module({
  imports: [
    RedisModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'single',
        options: {
          connectTimeout: 2000,
          commandTimeout: 1000,
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
          host: configService.get('REDIS_HOST', 'redis'),
          port: parseInt(configService.get('REDIS_PORT', '6379'), 10),
          keyPrefix: `${configService.get('REDIS_PREFIX', 'coding-box')}:cache:`
        }
      })
    })
  ],
  providers: [CacheService, UploadSessionStore],
  exports: [CacheService, UploadSessionStore]
})
export class CacheClientModule { }
