import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { AUTH_RATE_LIMIT_REDIS, AuthRateLimitStorage } from './auth-rate-limit.storage';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: AUTH_RATE_LIMIT_REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        // A separate bounded connection keeps a cache reconnect/command backlog
        // from hanging public auth requests or retaining unlimited queued work.
        const redis = new Redis({
          host: config.get<string>('REDIS_HOST', 'redis'),
          port: Number(config.get<string>('REDIS_PORT', '6379')),
          keyPrefix: `${config.get<string>('REDIS_PREFIX', 'coding-box')}:auth-rate-limit:`,
          enableOfflineQueue: false,
          maxRetriesPerRequest: 0,
          commandTimeout: 1000,
          connectTimeout: 1000
        });
        redis.on('error', () => undefined);
        return redis;
      }
    },
    AuthRateLimitStorage
  ],
  exports: [AuthRateLimitStorage]
})
export class AuthRateLimitStorageModule {}
