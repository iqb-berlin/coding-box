import { NestFactory } from '@nestjs/core';
import { json } from 'express';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as fs from 'fs';
import * as path from 'path';
import { AppModule } from './app/app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const configService = app.get(ConfigService);
  const host = configService.get('API_HOST') || '0.0.0.0';
  const port = 3333;
  const globalPrefix = 'api';

  app.use((req, _res, next) => {
    const [pathname, query = ''] = req.url.split('?', 2);
    const normalizedPathname = pathname.replace(/\/{2,}/g, '/');
    req.url = query ? `${normalizedPathname}?${query}` : normalizedPathname;
    next();
  });

  const packagesRoot = path.resolve('./packages');
  const packageDirectoryMap = new Map<string, string>();
  if (fs.existsSync(packagesRoot)) {
    fs.readdirSync(packagesRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .forEach(entry => packageDirectoryMap.set(entry.name.toLowerCase(), entry.name));
  }

  app.use('/api/packages', (req, _res, next) => {
    // Resolve top-level package directory case-insensitively.
    const match = req.url.match(/^\/([^/]+)(\/.*)?$/);
    if (match) {
      const requestedTopLevel = match[1];
      const normalizedTopLevel = packageDirectoryMap.get(requestedTopLevel.toLowerCase());
      if (normalizedTopLevel && normalizedTopLevel !== requestedTopLevel) {
        req.url = `/${normalizedTopLevel}${match[2] || ''}`;
      }
    }
    next();
  });

  // Explicit compatibility alias for historical GeoGebra package paths.
  app.useStaticAssets('./packages/Geogebra', { prefix: '/api/packages/GeoGebra' });
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
