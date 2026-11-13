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

  it.each([
    { identity: 'replacement-subject', issuer: 'https://issuer.example' },
    { identity: 'existing-subject', issuer: 'https://other-issuer.example' }
  ])('keeps the original account when a different identity uses its username', async replacement => {
    const original = {
      username: 'same-name', identity: 'existing-subject', issuer: 'https://issuer.example'
    };
    const id = await service.syncKeycloakUser(original);
    await service.createOidcProviderUser({ ...original, isAdmin: true });
    const collision = { ...original, ...replacement };
    await expect(service.syncKeycloakUser(collision)).rejects.toThrow('already bound');
    await expect(service.createOidcProviderUser(collision)).rejects.toThrow('already bound');
    await expect(database.getRepository(User).findOneByOrFail({ id })).resolves.toMatchObject({
      ...original, isAdmin: true
    });
    await expect(service.createOidcProviderUser(original)).resolves.toBe(id);
    expect(await database.getRepository(User).count()).toBe(1);
  });

  it('rejects an identity already associated with multiple local accounts', async () => {
    const identity = { identity: 'subject', issuer: 'https://issuer.example' };
    const repository = database.getRepository(User);
    await repository.save([
      { ...identity, username: 'one', isAdmin: false },
      { ...identity, username: 'two', isAdmin: true }
    ]);
    await expect(service.createOidcProviderUser({ ...identity, username: 'one' })).rejects.toThrow('multiple accounts');
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
    await expect(service.createOidcProviderUser({ ...profile, username: undefined } as never)).resolves.toBe(user.id);
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
