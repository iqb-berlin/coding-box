import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import User from '../../entities/user.entity';
import Workspace from '../../entities/workspace.entity';
import WorkspaceUser from '../../entities/workspace_user.entity';
import { UsersService } from './users.service';

const describePostgres = process.env.POSTGRES_INTEGRATION_TESTS === 'true' ? describe : describe.skip;

describePostgres('OIDC profile name persistence in PostgreSQL', () => {
  const identity = randomUUID();
  const profile = {
    username: `ada-${identity}`, identity, issuer: 'https://issuer.example', isAdmin: false
  };
  let database: DataSource;
  let service: UsersService;

  beforeAll(async () => {
    database = await new DataSource({
      type: 'postgres',
      host: process.env.POSTGRES_HOST,
      port: Number(process.env.POSTGRES_PORT || 5432),
      username: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
      database: process.env.POSTGRES_DB,
      entities: [User, WorkspaceUser, Workspace],
      synchronize: false
    }).initialize();
    service = new UsersService(database.getRepository(User), database.getRepository(WorkspaceUser));
  });

  afterAll(async () => {
    if (database?.isInitialized) {
      try {
        await database.getRepository(User).delete({ identity, issuer: profile.issuer });
      } finally {
        await database.destroy();
      }
    }
  });

  it('fills a legacy account on authentication and exposes refreshed names after reloading from storage', async () => {
    const user = await database.getRepository(User).save({ ...profile });
    const listedProfiles = async () => (await service.getAllUsers()).filter(entry => entry.username === profile.username);
    const listedUser = { id: user.id, username: profile.username, isAdmin: false };
    await expect(listedProfiles()).resolves.toEqual([{ ...listedUser, displayName: '' }]);

    await expect(service.createOidcProviderUser({ ...profile, firstName: 'Ada', lastName: 'Lovelace' }))
      .resolves.toBe(user.id);
    await expect(database.getRepository(User).findOneByOrFail({ id: user.id })).resolves.toMatchObject({
      firstName: 'Ada', lastName: 'Lovelace'
    });
    await expect(listedProfiles()).resolves.toEqual([{ ...listedUser, displayName: 'Ada Lovelace' }]);

    await service.createOidcProviderUser({ ...profile, lastName: 'Byron' });
    await service.createOidcProviderUser(profile);
    await expect(listedProfiles()).resolves.toEqual([{ ...listedUser, displayName: 'Ada Byron' }]);
  });
});
