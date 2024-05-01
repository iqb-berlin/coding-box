import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { json } from 'express';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const host = configService.get('API_HOST') || 'localhost';
  const port = 3333;
  const globalPrefix = 'api';

  app.setGlobalPrefix(globalPrefix);
  app.use(json({ limit: '50mb' }));
  app.enableCors();
  await app.listen(port, host);
  Logger.log(
    `🚀 Application is running on: http://${host}:${port}/${globalPrefix}`
  );
}
bootstrap();
