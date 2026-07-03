import { NestFactory } from '@nestjs/core';
import { json } from 'express';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as fs from 'fs';
import * as path from 'path';
import { AppModule } from './app/app.module';
import { ExportWorkerModule } from './app/export-worker/export-worker.module';
import { isExportWorkerProcess } from './app/export-worker/export-worker-role';
import { GlobalHttpExceptionFilter } from './app/http/global-http-exception.filter';
import {
  SLOW_REQUEST_THRESHOLD_ENV,
  createRequestMonitoringMiddleware,
  parseSlowRequestThresholdMs
} from './app/http/request-monitoring.middleware';
import { REQUEST_ID_HEADER } from './app/http/request-id';
import { requestIdMiddleware } from './app/http/request-id.middleware';

async function bootstrap() {
  if (isExportWorkerProcess()) {
    const workerApp = await NestFactory.createApplicationContext(ExportWorkerModule);
    workerApp.enableShutdownHooks();
    Logger.log('Export worker started');
    return;
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const configService = app.get(ConfigService);
  const host = configService.get('API_HOST') || 'localhost';
  const port = 3333;
  const globalPrefix = 'api';
  const slowRequestThresholdMs = parseSlowRequestThresholdMs(
    configService.get(SLOW_REQUEST_THRESHOLD_ENV)
  );

  app.use(requestIdMiddleware);
  app.useGlobalFilters(new GlobalHttpExceptionFilter());

  app.use((req, _res, next) => {
    const [pathname, query = ''] = req.url.split('?', 2);
    const normalizedPathname = pathname.replace(/\/{2,}/g, '/');
    req.url = query ? `${normalizedPathname}?${query}` : normalizedPathname;
    next();
  });
  app.use(createRequestMonitoringMiddleware({ slowRequestThresholdMs }));

  const packagesRoot = path.resolve('./packages');
  const packageDirectoryMap = new Map<string, string>();
  const refreshPackageDirectoryMap = () => {
    packageDirectoryMap.clear();
    if (!fs.existsSync(packagesRoot)) return;
    fs.readdirSync(packagesRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .forEach(entry => packageDirectoryMap.set(entry.name.toLowerCase(), entry.name));
  };
  refreshPackageDirectoryMap();

  // Compatibility aliases for historical GeoGebra paths.
  // New uploads keep the bundle folder at ./packages/Geogebra/GeoGebra,
  // while older tasks may reference /api/packages/GeoGebra/deployggb.js directly.
  app.useStaticAssets('./packages/Geogebra/GeoGebra', { prefix: '/api/packages/GeoGebra' });
  app.useStaticAssets('./packages/Geogebra', { prefix: '/api/packages/GeoGebra' });

  app.use('/api/packages', (req, _res, next) => {
    // Resolve top-level package directory case-insensitively.
    const match = req.url.match(/^\/([^/]+)(\/.*)?$/);
    if (match) {
      const requestedTopLevel = match[1];
      let normalizedTopLevel = packageDirectoryMap.get(requestedTopLevel.toLowerCase());
      if (!normalizedTopLevel) {
        refreshPackageDirectoryMap();
        normalizedTopLevel = packageDirectoryMap.get(requestedTopLevel.toLowerCase());
      }
      if (normalizedTopLevel && normalizedTopLevel !== requestedTopLevel) {
        req.url = `/${normalizedTopLevel}${match[2] || ''}`;
      }
    }
    next();
  });

  app.useStaticAssets('./packages', { prefix: '/api/packages' });
  app.use(json({ limit: '50mb' }));
  app.setGlobalPrefix(globalPrefix);
  app.enableCors({
    exposedHeaders: [REQUEST_ID_HEADER]
  });

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
