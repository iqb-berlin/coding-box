import { INestApplicationContext } from '@nestjs/common';

export function configureShutdownHooks(app: INestApplicationContext): void {
  app.enableShutdownHooks();
}
