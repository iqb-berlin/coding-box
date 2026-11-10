import { ConfigService } from '@nestjs/config';
import { TestcenterInstancesService } from './testcenter-instances.service';

describe('Testcenter instance approvals', () => {
  let store: Map<string, { key: string; content: string }>;
  let settings: { find: jest.Mock; findOne: jest.Mock; save: jest.Mock; delete: jest.Mock; manager: { transaction: jest.Mock } };
  let http: { axiosRef: { get: jest.Mock } };
  let service: TestcenterInstancesService;
  const input = { label: 'Study Testcenter', baseUrl: 'https://study.example/tci' };

  beforeEach(() => {
    store = new Map();
    const manager = { getRepository: jest.fn(), query: jest.fn().mockResolvedValue([]) };
    settings = {
      find: jest.fn(async () => [...store.values()]),
      findOne: jest.fn(async ({ where }: { where: { key: string } }) => store.get(where.key) || null),
      save: jest.fn(async entry => { store.set(entry.key, entry); return entry; }),
      delete: jest.fn(async key => { store.delete(key); }),
      manager: { transaction: jest.fn(async (_isolation: string, change: (value: typeof manager) => Promise<unknown>) => change(manager)) }
    };
    manager.getRepository.mockReturnValue(settings);
    http = { axiosRef: { get: jest.fn() } };
    service = new TestcenterInstancesService(settings as never, new ConfigService({ TESTCENTER_ALLOWED_URLS: 'http://127.0.0.1:8080/tci' }), http as never);
  });

  it('preserves all eleven standard URLs and deliberately configured operator exceptions', async () => {
    const list = await service.getInstances();
    expect(list.filter(entry => entry.source === 'standard')).toHaveLength(11);
    expect(list).toContainEqual({ label: 'http://127.0.0.1:8080/tci', baseUrl: 'http://127.0.0.1:8080/tci', source: 'environment' });
  });

  it.each(['https://study.example/tci', 'http://study.example:8080/tci'])('persists, renames and revokes the exact approval across service instances: %s', async baseUrl => {
    await expect(service.resolve('', baseUrl)).rejects.toMatchObject({ status: 403 });
    await service.saveInstance({ ...input, baseUrl: `${baseUrl}/` });
    const replica = new TestcenterInstancesService(settings as never, new ConfigService(), http as never);
    await expect(replica.resolve('', baseUrl)).resolves.toBe(baseUrl);
    await expect(replica.resolve('', `${baseUrl}/other`)).rejects.toMatchObject({ status: 403 });
    await expect(replica.resolve('', baseUrl.replace(/^https?:/, baseUrl.startsWith('https:') ? 'http:' : 'https:'))).rejects.toMatchObject({ status: 403 });
    await replica.saveInstance({ label: 'Renamed study', baseUrl });
    expect(await service.getInstances()).toContainEqual({ label: 'Renamed study', baseUrl, source: 'administrator' });
    await service.deleteInstance(baseUrl);
    await expect(replica.resolve('', baseUrl)).rejects.toMatchObject({ status: 403 });
  });

  it('updates a name without duplicate approvals and keeps separately saved instances', async () => {
    await service.saveInstance(input);
    await service.saveInstance({ label: 'Other', baseUrl: 'https://other.example' });
    await service.saveInstance({ ...input, label: 'New name' });
    expect((await service.getInstances()).filter(entry => entry.source === 'administrator')).toHaveLength(2);
    expect(store.size).toBe(2);
  });

  it('keeps commas in approved installation paths without corrupting the global allowlist', async () => {
    const baseUrl = 'https://study.example/tci,study';
    await service.saveInstance({ ...input, baseUrl });
    await expect(service.resolve('', baseUrl)).resolves.toBe(baseUrl);
    await expect(service.resolve('1')).resolves.toBe('https://iqb-testcenter1.de');
  });

  it('uses one indexed setting lookup for a custom destination without listing all global settings', async () => {
    await service.saveInstance(input);
    settings.find.mockClear();
    settings.findOne.mockClear();
    await expect(service.resolve('', input.baseUrl)).resolves.toBe(input.baseUrl);
    expect(settings.find).not.toHaveBeenCalled();
    expect(settings.findOne).toHaveBeenCalledTimes(1);
    await service.resolve('1');
    expect(settings.findOne).toHaveBeenCalledTimes(2);
  });

  it.each(['https://user:secret@private.example', 'http://user:secret@private.example', 'https://private.example?token=secret', 'http://private.example#fragment', 'ftp://private.example', 'file:///etc/passwd'])('rejects unsafe UI approval %s', async baseUrl => {
    await expect(service.saveInstance({ ...input, baseUrl })).rejects.toMatchObject({ status: 400 });
    expect(settings.save).not.toHaveBeenCalled();
  });

  it('keeps explicit operator approvals immutable in the application UI', async () => {
    await expect(service.saveInstance({ ...input, baseUrl: 'http://127.0.0.1:8080/tci' })).rejects.toMatchObject({ response: { code: 'TESTCENTER_OPERATOR_MANAGED' } });
    await expect(service.deleteInstance('http://127.0.0.1:8080/tci')).rejects.toMatchObject({ status: 400 });
  });

  it.each(['', ...Array.from({ length: 10 }, (_, i) => String(i + 1))])('renames, revokes and reapproves IQB default %s across replicas and numbered/custom selection', async server => {
    const baseUrl = `https://iqb-testcenter${server}.de`;
    await service.saveInstance({ label: 'Renamed IQB', baseUrl });
    expect(await service.getInstances()).toContainEqual({ label: 'Renamed IQB', baseUrl, source: 'standard' });
    await service.deleteInstance(baseUrl);
    const replica = new TestcenterInstancesService(settings as never, new ConfigService(), http as never);
    await expect(replica.resolve(server)).rejects.toMatchObject({ status: 403 });
    await expect(replica.resolve('', baseUrl)).rejects.toMatchObject({ status: 403 });
    expect((await replica.getInstances()).some(instance => instance.baseUrl === baseUrl)).toBe(false);
    await replica.saveInstance({ label: 'Approved again', baseUrl });
    await expect(service.resolve(server)).resolves.toBe(baseUrl);
  });

  it('keeps an explicit operator setting authoritative for an IQB URL', async () => {
    const baseUrl = 'https://iqb-testcenter1.de';
    await service.deleteInstance(baseUrl);
    const operator = new TestcenterInstancesService(settings as never, new ConfigService({ TESTCENTER_ALLOWED_URLS: baseUrl }), http as never);
    await expect(operator.resolve('1')).resolves.toBe(baseUrl);
    expect(await operator.getInstances()).toContainEqual({ label: baseUrl, baseUrl, source: 'environment' });
    await expect(operator.deleteInstance(baseUrl)).rejects.toMatchObject({ response: { code: 'TESTCENTER_OPERATOR_MANAGED' } });
  });

  it('tests only approved targets and reports API availability separately from authenticated access', async () => {
    await expect(service.testConnection(input.baseUrl)).rejects.toMatchObject({ status: 403 });
    expect(http.axiosRef.get).not.toHaveBeenCalled();
    await service.saveInstance(input);
    http.axiosRef.get.mockResolvedValue({ data: { version: '19.0.1' } });
    await expect(service.testConnection(input.baseUrl)).resolves.toMatchObject({ version: '19.0.1', checkedAt: expect.any(String) });
    expect(http.axiosRef.get).toHaveBeenCalledWith(`${input.baseUrl}/api/version`, expect.objectContaining({ maxRedirects: 0, timeout: 10000, maxContentLength: 4096 }));
    http.axiosRef.get.mockResolvedValue({ data: '<html>SPA</html>' });
    await expect(service.testConnection(input.baseUrl)).rejects.toMatchObject({ status: 502 });
  });
});
