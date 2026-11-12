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

  it('imports a person before login and reuses its ID on the first login and subsequent imports', async () => {
    const profile = {
      username: 'new-coder', identity: 'subject', issuer: 'https://issuer.example', isAdmin: false
    };
    const id = await service.syncKeycloakUser({ ...profile, firstName: 'Ada' });
    await expect(service.getAllUsers()).resolves.toEqual([
      {
        id, username: 'new-coder', isAdmin: false, displayName: 'Ada'
      }
    ]);
    await expect(service.createOidcProviderUser(profile)).resolves.toBe(id);
    await expect(service.syncKeycloakUser({ ...profile, username: 'renamed' })).resolves.toBe(id);
    expect(await database.getRepository(User).count()).toBe(1);
  });

  it('does not rebind an existing account with the same username during import', async () => {
    const existing = await database.getRepository(User).save({
      username: 'same-name', identity: 'existing-subject', issuer: 'https://issuer.example', isAdmin: true
    });
    await expect(service.syncKeycloakUser({
      username: 'same-name', identity: 'foreign-subject', issuer: 'https://issuer.example'
    })).rejects.toThrow('already bound');
    expect(await database.getRepository(User).findOneByOrFail({ id: existing.id })).toMatchObject({
      identity: 'existing-subject', isAdmin: true
    });
  });

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
