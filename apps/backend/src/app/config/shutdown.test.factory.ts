/* eslint-disable max-classes-per-file -- isolated Nest lifecycle fixture */
import { appendFile } from 'fs/promises';
import {
  Controller, Get, Injectable, Module
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { configureShutdownHooks } from './shutdown';

const trace = process.env.SHUTDOWN_TRACE_PATH;
if (!trace) throw new Error('Missing synthetic shutdown trace');
const record = (phase: string, signal?: string) => appendFile(trace, `${JSON.stringify({ phase, signal })}\n`);

@Injectable()
class LifecycleProbe {
  private readonly keepAlive = setInterval(() => undefined, 1000);
  async onModuleDestroy() { clearInterval(this.keepAlive); await record('destroy'); }
  async beforeApplicationShutdown(signal?: string) { await record('before', signal); }
  async onApplicationShutdown(signal?: string) { await record('shutdown', signal); }
}
@Controller()
class ProbeController {
  @Get() ready() { return { ready: true }; }
}
@Module({ controllers: [ProbeController], providers: [LifecycleProbe] })
class ProbeModule {}

async function start() {
  if (process.env.APP_ROLE === 'export-worker') {
    const app = await NestFactory.createApplicationContext(ProbeModule, { logger: false });
    configureShutdownHooks(app);
    process.send?.({ ready: true });
  } else {
    const app = await NestFactory.create(ProbeModule, { logger: false });
    configureShutdownHooks(app);
    await app.listen(0, '127.0.0.1');
    process.send?.({ ready: true, url: await app.getUrl() });
  }
}
start().catch(error => { process.stderr.write(String(error)); process.exitCode = 1; });
