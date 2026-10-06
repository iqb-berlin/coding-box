import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LogoController } from './logo.controller';
import { LogoService } from './logo.service';
import { LogoUploadInterceptor } from './logo-upload.interceptor';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { AdminGuard } from '../admin.guard';

describe('Logo controller and filesystem service', () => {
  let app: INestApplication;
  let service: LogoService;
  let root: string;
  let url: string;
  let assets: string;

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'logo-test-'));
    assets = path.join(root, 'apps/frontend/src/assets');
    const cwd = jest.spyOn(process, 'cwd').mockReturnValue(root);
    service = new LogoService();
    cwd.mockRestore();
    const module = await Test.createTestingModule({
      controllers: [LogoController],
      providers: [{ provide: LogoService, useValue: service }, LogoUploadInterceptor]
    }).overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    await app.listen(0, '127.0.0.1');
    url = `${await app.getUrl()}/admin/logo`;
  });

  beforeEach(async () => {
    await fs.rm(assets, { recursive: true, force: true });
  });

  afterAll(async () => {
    await app?.close();
    await fs.rm(root, { recursive: true, force: true });
  });

  function upload(contents: string, type: string, name: string) {
    const form = new FormData();
    form.append('logo', new Blob([contents], { type }), name);
    return fetch(`${url}/upload`, { method: 'POST', body: form });
  }

  it('uses the injected service for multipart storage and preserves the upload response', async () => {
    const response = await upload('<svg/>', 'image/svg+xml', 'custom.svg');
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ path: 'assets/images/logo.svg' });
    expect(await fs.readFile(path.join(assets, 'images/logo.svg'), 'utf8')).toBe('<svg/>');
  });

  it('preserves file type, size and missing file validation', async () => {
    expect((await upload('text', 'text/plain', 'file.txt')).status).toBe(400);
    expect((await upload('x'.repeat(4 * 1024 * 1024 + 1), 'image/png', 'large.png')).status).toBe(413);
    expect((await fetch(`${url}/upload`, { method: 'POST', body: new FormData() })).status).toBe(400);
  });

  it('saves and reads settings through the controller and restores defaults on deletion', async () => {
    const settings = { data: 'assets/images/logo.png', alt: 'Custom', boxBackground: 'red' };
    const saved = await fetch(`${url}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings)
    });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ success: true });
    expect(await (await fetch(`${url}/settings`)).json()).toEqual(settings);
    await fs.mkdir(path.join(assets, 'images'), { recursive: true });
    await fs.writeFile(path.join(assets, 'images/logo.png'), 'custom');
    await fs.writeFile(path.join(assets, 'images/IQB-LogoA.png'), 'default');
    const deleted = await fetch(url, { method: 'DELETE' });
    expect(await deleted.json()).toEqual({ success: true });
    expect(await fs.readdir(path.join(assets, 'images'))).toEqual(['IQB-LogoA.png']);
    expect(await service.getLogoSettings()).toMatchObject({ data: 'assets/images/IQB-LogoA.png' });
    expect(await fs.readdir(path.join(assets, 'data'))).toEqual([]);
  });

  it('keeps JSON complete during concurrent saves and removes temporary files', async () => {
    const settings = Array.from({ length: 8 }, (_, i) => ({ data: `logo-${i}.png`, alt: 'x'.repeat(4096 + i) }));
    await Promise.all(settings.map(value => service.saveLogoSettings(value)));
    expect(settings).toContainEqual(await service.getLogoSettings());
    expect(await fs.readdir(path.join(assets, 'data'))).toEqual(['logo-settings.json']);
  });

  it('propagates corrupted settings instead of silently replacing them with defaults', async () => {
    await fs.mkdir(path.join(assets, 'data'), { recursive: true });
    await fs.writeFile(path.join(assets, 'data/logo-settings.json'), '{');
    await expect(service.getLogoSettings()).rejects.toBeInstanceOf(SyntaxError);
  });
});
