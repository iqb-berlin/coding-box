import { Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { InjectRedis, RedisModule } from '@nestjs-modules/ioredis';
import { CacheService } from './cache.service';

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
    })
  ],
  providers: [CacheService],
  exports: [CacheService]
})
export class CacheClientModule implements OnApplicationShutdown {
  constructor(@InjectRedis() private readonly redis: Redis) {}

  onApplicationShutdown(): void {
    // Close the owned socket without waiting on a command that could retry indefinitely.
    this.redis.disconnect();
  }
}
