import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource, EntityManager, QueryRunner } from 'typeorm';
import { isAxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';
import { UsersService } from '../database/services/users';
import { KeycloakUserSyncConfig, parseKeycloakUserSyncConfig } from './keycloak-user-sync.config';

interface DirectoryUser {
  id: string;
  username: string;
  enabled?: boolean;
  firstName?: string;
  lastName?: string;
  serviceAccountClientId?: string;
}

const PAGE_SIZE = 100;
const SYNC_LOCK_NAMESPACE = 774020253;

@Injectable()
export class KeycloakUserSyncService implements OnModuleInit {
  private readonly logger = new Logger(KeycloakUserSyncService.name);
  private readonly config?: KeycloakUserSyncConfig;
  private running = false;

  constructor(
    configService: ConfigService,
    private readonly http: HttpService,
    private readonly users: UsersService,
    private readonly database: DataSource
  ) {
    const keys = ['KEYCLOAK_USER_SYNC_ENABLED', 'KEYCLOAK_USER_SYNC_USERS_URL',
      'KEYCLOAK_USER_SYNC_CLIENT_ID', 'KEYCLOAK_USER_SYNC_CLIENT_SECRET', 'OIDC_ISSUER', 'OIDC_TOKEN_ENDPOINT'];
    this.config = parseKeycloakUserSyncConfig(Object.fromEntries(keys.map(key => [key, configService.get(key)])));
  }

  onModuleInit(): void {
    this.synchronize().catch(() => this.logger.error({ event: 'keycloak-user-sync.startup-failed' }));
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async synchronize(): Promise<void> {
    if (!this.config || this.running) return;
    this.running = true;
    let runner: QueryRunner | undefined;
    let locked = false;
    try {
      runner = this.database.createQueryRunner();
      await runner.connect();
      const rows: { locked: boolean }[] = await runner.query(
        'SELECT pg_try_advisory_lock($1::int, hashtext($2)) AS locked',
        [SYNC_LOCK_NAMESPACE, this.config.issuer]
      );
      locked = rows[0]?.locked === true;
      if (!locked) return;
      const token = await this.getToken(this.config);
      const seen = new Set<string>();
      let imported = 0;
      let skipped = 0;
      for (let first = 0; first < 100_000; first += PAGE_SIZE) {
        const response = await firstValueFrom(this.http.get<unknown>(this.config.usersUrl, {
          timeout: 10_000,
          maxRedirects: 0,
          headers: { Authorization: `Bearer ${token}` },
          params: {
            enabled: true, briefRepresentation: false, first, max: PAGE_SIZE
          }
        }));
        if (!Array.isArray(response.data)) throw new Error('Invalid Keycloak directory response');
        const page: unknown[] = response.data;
        if (page.length === 0) {
          this.logger.log({ event: 'keycloak-user-sync.completed', imported, skipped });
          return;
        }
        const result = await this.syncPage(page, seen, this.config.issuer, runner.manager);
        imported += result.imported;
        skipped += result.skipped;
        if (result.newIds === 0) throw new Error('Keycloak directory pagination made no progress');
      }
      throw new Error('Keycloak directory page limit reached');
    } catch (error) {
      // Axios errors can contain credentials and full profiles; log only the status.
      this.logger.error({ event: 'keycloak-user-sync.failed', status: isAxiosError(error) ? error.response?.status : undefined });
    } finally {
      try {
        if (locked && runner) await runner.query('SELECT pg_advisory_unlock($1::int, hashtext($2))', [SYNC_LOCK_NAMESPACE, this.config.issuer]);
      } catch {
        this.logger.error({ event: 'keycloak-user-sync.unlock-failed' });
      } finally {
        this.running = false;
        try { await runner?.release(); } catch { this.logger.error({ event: 'keycloak-user-sync.release-failed' }); }
      }
    }
  }

  private async syncPage(page: unknown[], seen: Set<string>, issuer: string, manager: EntityManager): Promise<{ imported: number; skipped: number; newIds: number }> {
    let imported = 0;
    let skipped = 0;
    let newIds = 0;
    for (const entry of page) {
      if (!this.isDirectoryUser(entry)) { skipped += 1; continue; }
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      newIds += 1;
      if (entry.enabled !== true || entry.serviceAccountClientId || entry.username.startsWith('service-account-')) {
        skipped += 1;
        continue;
      }
      try {
        await this.users.syncKeycloakUser({
          identity: entry.id,
          issuer,
          username: entry.username,
          ...(typeof entry.firstName === 'string' ? { firstName: entry.firstName } : {}),
          ...(typeof entry.lastName === 'string' ? { lastName: entry.lastName } : {}),
          isAdmin: false
        }, manager);
        imported += 1;
      } catch {
        skipped += 1;
        this.logger.warn({ event: 'keycloak-user-sync.user-skipped' });
      }
    }
    return { imported, skipped, newIds };
  }

  private async getToken(config: KeycloakUserSyncConfig): Promise<string> {
    const body = new URLSearchParams({
      grant_type: 'client_credentials', client_id: config.clientId, client_secret: config.clientSecret
    });
    const response = await firstValueFrom(this.http.post<{ access_token?: unknown }>(config.tokenUrl, body.toString(), {
      timeout: 10_000, maxRedirects: 0, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    }));
    const token = response.data?.access_token;
    if (typeof token !== 'string' || !token.trim()) throw new Error('Keycloak service token missing');
    return token;
  }

  private isDirectoryUser(value: unknown): value is DirectoryUser {
    return typeof value === 'object' && value !== null &&
      'id' in value && typeof value.id === 'string' && !!value.id.trim() &&
      'username' in value && typeof value.username === 'string' && !!value.username.trim();
  }
}
