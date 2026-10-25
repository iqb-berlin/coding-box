import { DataSource } from 'typeorm';
import User from '../../entities/user.entity';
import { UsersService } from './users.service';

describe('OIDC profile name persistence', () => {
  let database: DataSource;
  let service: UsersService;

  beforeEach(async () => {
    database = await new DataSource({
      type: 'sqlite', database: ':memory:', entities: [User], synchronize: true
    }).initialize();
    service = new UsersService(database.getRepository(User), {} as never);
  });

  afterEach(async () => { await database?.destroy(); });

  it('fills a legacy account on authentication and exposes refreshed names after reloading from storage', async () => {
    const profile = {
      username: 'ada-login', identity: 'subject', issuer: 'https://issuer.example', isAdmin: false
    };
    const user = await database.getRepository(User).save({ ...profile });
    await expect(service.getAllUsers()).resolves.toEqual([
      {
        id: user.id, username: 'ada-login', isAdmin: false, displayName: ''
      }
    ]);

    await expect(service.createOidcProviderUser({ ...profile, firstName: 'Ada', lastName: 'Lovelace' }))
      .resolves.toBe(user.id);
    await expect(database.getRepository(User).findOneByOrFail({ id: user.id })).resolves.toMatchObject({
      firstName: 'Ada', lastName: 'Lovelace'
    });
    await expect(service.getAllUsers()).resolves.toEqual([
      {
        id: user.id, username: 'ada-login', isAdmin: false, displayName: 'Ada Lovelace'
      }
    ]);

    await service.createOidcProviderUser({ ...profile, lastName: 'Byron' });
    await service.createOidcProviderUser(profile);
    await expect(service.getAllUsers()).resolves.toEqual([
      {
        id: user.id, username: 'ada-login', isAdmin: false, displayName: 'Ada Byron'
      }
    ]);
  });
});
