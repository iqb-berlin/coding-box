import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { DatabaseModule } from './database/database.module';

@Module({
  imports: [ConfigModule.forRoot({
    envFilePath: '.env.dev',
    cache: true
  }), AuthModule, DatabaseModule],
  controllers: [AppController]
})
export class AppModule {}
