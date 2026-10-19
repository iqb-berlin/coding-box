import { promises as fs } from 'fs';
import { LogoService } from './logo.service';
import { LogoController } from './logo.controller';

describe('LogoController error propagation', () => {
  const controller = new LogoController(new LogoService());
  const error = new Error('EACCES: synthetic private path');

  afterEach(() => jest.restoreAllMocks());

  it('preserves a settings write failure for the global exception filter', async () => {
    jest.spyOn(fs, 'mkdir').mockResolvedValue(undefined);
    jest.spyOn(fs, 'writeFile').mockRejectedValue(error);
    jest.spyOn(fs, 'unlink').mockResolvedValue(undefined);
    await expect(controller.saveLogoSettings({ bodyBackground: '#ffffff' })).rejects.toBe(error);
  });

  it('preserves a settings read failure', async () => {
    jest.spyOn(fs, 'mkdir').mockResolvedValue(undefined);
    jest.spyOn(fs, 'readFile').mockRejectedValue(error);
    await expect(controller.getLogoSettings()).rejects.toBe(error);
  });

  it('preserves a logo deletion failure without removing files', async () => {
    jest.spyOn(fs, 'readdir').mockRejectedValue(error);
    const remove = jest.spyOn(fs, 'unlink').mockResolvedValue(undefined);
    await expect(controller.deleteLogo()).rejects.toBe(error);
    expect(remove).not.toHaveBeenCalled();
  });
});
