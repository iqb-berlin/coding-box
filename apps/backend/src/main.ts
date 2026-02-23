import { NestFactory } from '@nestjs/core';
import { json } from 'express';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app/app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const configService = app.get(ConfigService);
  const host = configService.get('SERVER_NAME') !== null && configService.get('SERVER_NAME') !== undefined && configService.get('SERVER_NAME') !== 'localhost' ? 'backend' : 'localhost';
  const port = 3333;
  const globalPrefix = 'api';

  app.useStaticAssets('./packages', { prefix: '/api/packages' });
  app.use(json({ limit: '50mb' }));
  app.setGlobalPrefix(globalPrefix);
  app.enableCors();

  // Enable Swagger-UI
  const config = new DocumentBuilder()
    .setTitle('IQB Coding Box API')
    .setDescription('The Coding Box API description and try-out')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(port, host);
  Logger.log(
    `🚀 Application is running on: http://${host}:${port}/${globalPrefix}`
  );
  Logger.log(
    `📚 Swagger documentation available at: http://${host}:${port}/${globalPrefix}/docs`
  );
}
bootstrap();
