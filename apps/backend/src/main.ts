import { NestFactory } from '@nestjs/core';
import { json } from 'express';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app/app.module';
import { environment } from './environments/environment';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const configService = app.get(ConfigService);
  const host = configService.get('API_HOST') || 'localhost';
  const port = 3333;
  const globalPrefix = 'api';

  app.useStaticAssets('./packages', { prefix: '/api/packages' });
  app.use(json({ limit: '50mb' }));
  app.setGlobalPrefix(globalPrefix);
  app.use(json({ limit: '50mb' }));
  app.enableCors();

  // Enable Swagger-UI
  if (!environment.production) {
    const config = new DocumentBuilder()
      .setTitle('IQB Coding Box API')
      .setDescription('The Coding Box API description and try-out')
      .setVersion('0.2.7')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api', app, document);
  }

  await app.listen(port, host);
  Logger.log(
    `🚀 Application is running on: http://${host}:${port}/${globalPrefix}`
  );
}
bootstrap();
