import * as fs from 'fs';
import { LogoController } from './logo.controller';

describe('LogoController error propagation', () => {
  const controller = new LogoController();
  const error = new Error('EACCES: synthetic private path');

  afterEach(() => jest.restoreAllMocks());

  it('preserves a settings write failure for the global exception filter', async () => {
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    jest.spyOn(fs, 'writeFileSync').mockImplementation(() => { throw error; });
    await expect(controller.saveLogoSettings({ bodyBackground: '#ffffff' })).rejects.toBe(error);
  });

  it('preserves a settings read failure', async () => {
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    jest.spyOn(fs, 'readFileSync').mockImplementation(() => { throw error; });
    await expect(controller.getLogoSettings()).rejects.toBe(error);
  });

  it('preserves a logo deletion failure without removing files', async () => {
    jest.spyOn(fs, 'readdirSync').mockImplementation(() => { throw error; });
    const remove = jest.spyOn(fs, 'unlinkSync').mockImplementation(() => undefined);
    await expect(controller.deleteLogo()).rejects.toBe(error);
    expect(remove).not.toHaveBeenCalled();
  });
});
