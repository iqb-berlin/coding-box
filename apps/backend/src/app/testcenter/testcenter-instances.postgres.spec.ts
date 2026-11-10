import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { DataSource } from 'typeorm';
import { Setting } from '../database/entities/setting.entity';
import { TestcenterInstancesService } from './testcenter-instances.service';

const describePostgres = process.env.POSTGRES_INTEGRATION_TESTS === 'true' ? describe : describe.skip;

describePostgres('Testcenter approval changes with PostgreSQL', () => {
  const schema = `tc_approvals_${process.pid}_${Date.now()}`;
  let databases: DataSource[];
  let services: TestcenterInstancesService[];

  beforeAll(async () => {
    databases = [0, 1].map(() => new DataSource({
      type: 'postgres',
      host: process.env.POSTGRES_HOST || 'localhost',
      port: Number(process.env.POSTGRES_PORT || 5432),
      username: process.env.POSTGRES_USER || 'root',
      password: process.env.POSTGRES_PASSWORD || 'root-password',
      database: process.env.POSTGRES_DB || 'coding-box',
      schema,
      entities: [Setting],
      synchronize: false,
      extra: { max: 2, connectionTimeoutMillis: 2000, statement_timeout: 5000 }
    }));
    await Promise.all(databases.map(database => database.initialize()));
    await databases[0].query(`CREATE SCHEMA "${schema}"`);
    await databases[0].query(`CREATE TABLE "${schema}".setting (
      key VARCHAR(255) PRIMARY KEY, content TEXT NOT NULL,
      CONSTRAINT reject_fixture CHECK (content NOT LIKE '%reject-fixture%'))`);
    services = databases.map(database => new TestcenterInstancesService(
      database.getRepository(Setting), new ConfigService(), new HttpService()
    ));
  });

  beforeEach(async () => { await databases[0].getRepository(Setting).clear(); });

  afterAll(async () => {
    try {
      if (databases?.[0].isInitialized) await databases[0].query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      await Promise.all((databases || []).filter(database => database.isInitialized).map(database => database.destroy()));
    }
  });

  const fill = async (count: number) => {
    for (let index = 0; index < count; index++) {
      await services[0].saveInstance({ label: `Fixture ${index}`, baseUrl: `https://fixture${index}.example.org` });
    }
  };

  it('admits exactly one new approval when two replicas compete for the final slot', async () => {
    await fill(99);
    const results = await Promise.allSettled(services.map((service, index) => service.saveInstance({
      label: `Replica ${index}`, baseUrl: `https://replica${index}.example.org`
    })));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    expect(failure?.reason).toBeInstanceOf(BadRequestException);
    expect(await databases[0].getRepository(Setting).count()).toBe(100);
  });

  it('serializes concurrent approvals of the same URL without duplicates or unique-key failures', async () => {
    await fill(99);
    await Promise.all(services.map((service, index) => service.saveInstance({
      label: `Replica ${index}`, baseUrl: 'https://shared.example.org/tci'
    })));
    expect(await databases[0].getRepository(Setting).count()).toBe(100);
    expect((await services[1].getInstances()).filter(instance => instance.baseUrl === 'https://shared.example.org/tci')).toHaveLength(1);
  });

  it('can rename at capacity and reuse a revoked slot after a rejected transaction', async () => {
    await fill(100);
    const next = { label: 'Next', baseUrl: 'https://next.example.org' };
    await expect(services[0].saveInstance(next)).rejects.toBeInstanceOf(BadRequestException);
    await services[1].saveInstance({ label: 'Renamed', baseUrl: 'https://fixture0.example.org' });
    await services[1].deleteInstance('https://fixture0.example.org');
    await services[0].saveInstance(next);
    expect(await databases[0].getRepository(Setting).count()).toBe(100);
    await expect(services[1].resolve('', 'https://fixture0.example.org')).rejects.toMatchObject({ status: 403 });
  });

  it('persists IQB revocation and reapproval across independent database pools', async () => {
    const baseUrl = 'https://iqb-testcenter1.de';
    await services[0].saveInstance({ label: 'Renamed IQB', baseUrl });
    expect(await services[1].getInstances()).toContainEqual({ label: 'Renamed IQB', baseUrl, source: 'standard' });
    await services[1].deleteInstance(baseUrl);
    await expect(services[0].resolve('1')).rejects.toMatchObject({ status: 403 });
    await expect(services[0].resolve('', baseUrl)).rejects.toMatchObject({ status: 403 });
    expect((await services[0].getInstances()).some(instance => instance.baseUrl === baseUrl)).toBe(false);
    await services[0].saveInstance({ label: 'Reapproved IQB', baseUrl });
    await expect(services[1].resolve('1')).resolves.toBe(baseUrl);
  });

  it('persists HTTP approval, renaming and revocation across independent database pools', async () => {
    const baseUrl = 'http://study.example:8080/tci';
    await services[0].saveInstance({ label: 'HTTP study', baseUrl });
    await expect(services[1].resolve('', baseUrl)).resolves.toBe(baseUrl);
    await services[1].saveInstance({ label: 'Renamed HTTP study', baseUrl });
    expect(await services[0].getInstances()).toContainEqual({ label: 'Renamed HTTP study', baseUrl, source: 'administrator' });
    await services[0].deleteInstance(baseUrl);
    await expect(services[1].resolve('', baseUrl)).rejects.toMatchObject({ status: 403 });
  });

  it('rolls back a failed write and releases the database lock for another replica', async () => {
    await expect(services[0].saveInstance({ label: 'reject-fixture', baseUrl: 'https://rejected.example.org' })).rejects.toThrow();
    expect(await databases[0].getRepository(Setting).count()).toBe(0);
    await services[1].saveInstance({ label: 'Valid', baseUrl: 'https://valid.example.org' });
    await expect(services[0].resolve('', 'https://valid.example.org')).resolves.toBe('https://valid.example.org');
  });
});
