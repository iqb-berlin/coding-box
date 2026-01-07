import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RedisModule } from '@nestjs-modules/ioredis';
import { ScheduleModule } from '@nestjs/schedule';
import { CacheService } from './cache.service';

/**
 * CacheModule - Generic Infrastructure Module for Redis Caching
 *
 * This module provides a generic CacheService for Redis-based caching.
 * It is designed to be a global infrastructure module that does not
 * depend on feature modules.
 */
@Module({
  imports: [
    RedisModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'single',
        options: {
          host: configService.get('REDIS_HOST', 'redis'),
          port: parseInt(configService.get('REDIS_PORT', '6379'), 10),
          keyPrefix: `${configService.get('REDIS_PREFIX', 'coding-box')}:cache:`
        }
      })
    }),
    ScheduleModule.forRoot()
  ],
  providers: [
    CacheService
  ],
  exports: [
    CacheService
  ]
})
export class CacheModule {}
