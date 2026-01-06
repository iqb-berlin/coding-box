import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

/**
 * DatabaseModule - Strictly for Database Connection Configuration
 *
 * This module handles only the database connection setup.
 * All entities are managed by their respective feature modules:
 * - CodingModule: Coding-related entities
 * - UsersModule: User-related entities
 * - WorkspacesModule: Workspace and test-related entities
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get('POSTGRES_HOST'),
        port: +configService.get<number>('POSTGRES_PORT'),
        username: configService.get('POSTGRES_USER'),
        password: configService.get('POSTGRES_PASSWORD'),
        database: configService.get('POSTGRES_DB'),
        // Entity registration is handled by feature modules via TypeOrmModule.forFeature()
        autoLoadEntities: true,
        synchronize: false
      }),
      inject: [ConfigService]
    })
  ],
  providers: [],
  exports: []
})
export class DatabaseModule {}
