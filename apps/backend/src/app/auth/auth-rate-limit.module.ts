import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthRateLimitStorageModule } from './auth-rate-limit-storage.module';
import { AuthRateLimitStorage } from './auth-rate-limit.storage';
import { parseAuthRateLimitConfig } from './auth-rate-limit.config';

@Module({
  imports: [
    AuthRateLimitStorageModule,
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule, AuthRateLimitStorageModule],
      inject: [ConfigService, AuthRateLimitStorage],
      useFactory: (config: ConfigService, storage: AuthRateLimitStorage) => ({
        storage,
        throttlers: [parseAuthRateLimitConfig({
          AUTH_RATE_LIMIT_LIMIT: config.get('AUTH_RATE_LIMIT_LIMIT'),
          AUTH_RATE_LIMIT_TTL_MS: config.get('AUTH_RATE_LIMIT_TTL_MS')
        })]
      })
    })
  ],
  providers: [ThrottlerGuard],
  exports: [ThrottlerModule, ThrottlerGuard]
})
export class AuthRateLimitModule {}
