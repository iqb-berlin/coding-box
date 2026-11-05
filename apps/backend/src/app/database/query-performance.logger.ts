import { createHash } from 'node:crypto';
import { Logger as NestLogger } from '@nestjs/common';
import { Logger, LogLevel } from 'typeorm';

/** Log SQL fingerprints/duration only: answer values and parameters never enter logs. */
export class QueryPerformanceLogger implements Logger {
  private readonly logger = new NestLogger('PostgresQuery');

  logQuery(): void { /* Routine queries intentionally stay quiet. */ }

  logQueryError(): void {
    this.logger.error('Database query failed; request/job context contains the owning operation.');
  }

  logQuerySlow(time: number, query: string): void {
    const fingerprint = createHash('sha256').update(query).digest('hex').slice(0, 16);
    this.logger.warn(`Slow SQL fingerprint=${fingerprint} duration_ms=${Math.round(time)}`);
  }

  logSchemaBuild(): void { /* Schema is managed by Liquibase. */ }

  logMigration(): void { /* Schema is managed by Liquibase. */ }

  log(level: LogLevel): void {
    if (level === 'warn') this.logger.warn('PostgreSQL driver warning; inspect the owning operation.');
  }
}
