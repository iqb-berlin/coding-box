import {
  Controller, Get, Req, UseGuards
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { ScheduleModule } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { setTimeout as delay } from 'node:timers/promises';
import User from '../database/entities/user.entity';
import Workspace from '../database/entities/workspace.entity';
import WorkspaceUser from '../database/entities/workspace_user.entity';
import { JournalEntry } from '../database/entities/journal-entry.entity';
import { UsersService } from '../database/services/users';
import { JwtStrategy } from '../auth/jwt.strategy';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { KeycloakUserSyncService } from './keycloak-user-sync.service';

@Controller()
class FirstLoginController {
  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@Req() request: { user: { userId: number } }) { return request.user; }
}

const live = process.env.KEYCLOAK_SYNC_TEST_URL ? describe : describe.skip;

live('enabled Keycloak accounts before first login (real Keycloak and PostgreSQL)', () => {
  it('imports after activation via the scheduled job and retains pre-login assignments', async () => {
    const base = process.env.KEYCLOAK_SYNC_TEST_URL!;
    const realm = process.env.KEYCLOAK_SYNC_TEST_REALM!;
    const issuer = `${base}/realms/${realm}`;
    const identity = process.env.KEYCLOAK_SYNC_TEST_IDENTITY!;
    const config: Record<string, string> = {
      OIDC_ISSUER: issuer,
      OIDC_TOKEN_ENDPOINT: `${issuer}/protocol/openid-connect/token`,
      OIDC_JWKS_URI: `${issuer}/protocol/openid-connect/certs`,
      OAUTH2_CLIENT_ID: 'coding-box-test-login',
      KEYCLOAK_USER_SYNC_ENABLED: 'true',
      KEYCLOAK_USER_SYNC_USERS_URL: `${base}/admin/realms/${realm}/users`,
      KEYCLOAK_USER_SYNC_CLIENT_ID: 'coding-box-user-sync',
      KEYCLOAK_USER_SYNC_CLIENT_SECRET: process.env.KEYCLOAK_SYNC_TEST_SECRET!
    };
    const database = await new DataSource({
      type: 'postgres',
      url: process.env.KEYCLOAK_SYNC_TEST_DATABASE_URL,
      entities: [User, Workspace, WorkspaceUser, JournalEntry],
      synchronize: true,
      extra: { max: 1 }
    }).initialize();
    const users = new UsersService(database.getRepository(User), database.getRepository(WorkspaceUser));
    const module = await Test.createTestingModule({
      imports: [HttpModule, ScheduleModule.forRoot()],
      controllers: [FirstLoginController],
      providers: [KeycloakUserSyncService, JwtStrategy, JwtAuthGuard,
        { provide: ConfigService, useValue: { get: (key: string) => config[key] } },
        { provide: DataSource, useValue: database }, { provide: UsersService, useValue: users }]
    }).compile();
    const app = module.createNestApplication();
    try {
      await app.listen(0, '127.0.0.1');
      await delay(1000);
      await app.get(KeycloakUserSyncService).synchronize();
      expect(await database.getRepository(User).count()).toBe(0);
      const activation = await fetch(`${base}/admin/realms/${realm}/users/${identity}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${process.env.KEYCLOAK_SYNC_TEST_ADMIN_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ enabled: true })
      });
      expect(activation.status).toBe(204);
      const deadline = Date.now() + 70_000;
      let imported: User | null = null;
      while (Date.now() < deadline) {
        imported = await database.getRepository(User).findOneBy({ identity, issuer });
        if (imported) break;
        await delay(500);
      }
      expect(imported).toMatchObject({
        identity, issuer, username: 'waiting-coder', isAdmin: false
      });
      const userId = imported!.id;
      const manager = await database.getRepository(User).save({
        identity: 'local-manager', issuer: 'local', username: 'study-manager', isAdmin: true
      });
      const workspace = await database.getRepository(Workspace).save({ name: 'Assigned before login' });
      await database.getRepository(WorkspaceUser).save({
        userId: manager.id, workspaceId: workspace.id, accessLevel: 3, canCode: false
      });
      await users.updateUsersAccess(workspace.id, [{ id: userId, accessLevel: 1, canCode: true }]);
      expect(await users.getUsersWithWorkspaceAccess(workspace.id)).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: userId, canCode: true })
      ]));
      const tokenResponse = await fetch(config.OIDC_TOKEN_ENDPOINT, {
        method: 'POST',
        body: new URLSearchParams({
          grant_type: 'password',
          client_id: 'coding-box-test-login',
          username: 'waiting-coder',
          password: process.env.KEYCLOAK_SYNC_TEST_USER_PASSWORD!
        })
      });
      expect(tokenResponse.status).toBe(200);
      const token = await tokenResponse.json() as { access_token: string };
      const response = await fetch(`${await app.getUrl()}/me`, {
        headers: { Authorization: `Bearer ${token.access_token}` }
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ userId, identity, issuer });
      await app.get(KeycloakUserSyncService).synchronize();
      expect(await database.getRepository(User).countBy({ identity, issuer })).toBe(1);
      expect(await database.getRepository(WorkspaceUser).findOneBy({ userId, workspaceId: workspace.id }))
        .toMatchObject({ accessLevel: 1, canCode: true });
    } finally {
      await app.close();
      await database.destroy();
    }
  }, 100_000);
});
