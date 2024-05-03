import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
// eslint-disable-next-line import/no-extraneous-dependencies

import User from './entities/user.entity';
import { UsersService } from './services/users.service';

@Module({
  imports: [
    User,
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get('POSTGRES_HOST'),
        port: +configService.get<number>('POSTGRES_PORT'),
        username: configService.get('POSTGRES_USER'),
        password: configService.get('POSTGRES_PASSWORD'),
        database: configService.get('POSTGRES_DB'),
        entities: [
          User
        ],
        synchronize: false
      }),
      inject: [ConfigService]
    }),
    TypeOrmModule.forFeature([User])
  ],
  providers: [UsersService],
  exports: [
    User,
    UsersService
  ]
})
export class DatabaseModule {}
