import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RedisModule } from '@nestjs-modules/ioredis';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CacheService } from './cache.service';
import { ResponseCacheSchedulerService } from './response-cache-scheduler.service';
import Persons from '../database/entities/persons.entity';
import { Unit } from '../database/entities/unit.entity';
// eslint-disable-next-line import/no-cycle
import { DatabaseModule } from '../database/database.module';

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
    ScheduleModule.forRoot(),
    TypeOrmModule.forFeature([Persons, Unit]),
    forwardRef(() => DatabaseModule)
  ],
  providers: [CacheService, ResponseCacheSchedulerService],
  exports: [CacheService]
})
export class CacheModule {}
