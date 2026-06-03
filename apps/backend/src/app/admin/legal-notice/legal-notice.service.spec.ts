import { BadRequestException } from '@nestjs/common';
import { LegalNoticeService } from './legal-notice.service';
import { Setting } from '../../database/entities/setting.entity';

type SettingRepositoryMock = {
  findOne: jest.Mock;
  save: jest.Mock;
  create: jest.Mock;
  delete: jest.Mock;
};

function createSettingRepositoryMock(setting: Setting | null = null): SettingRepositoryMock {
  return {
    findOne: jest.fn().mockResolvedValue(setting),
    save: jest.fn().mockImplementation(value => Promise.resolve(value)),
    create: jest.fn().mockImplementation(value => value),
    delete: jest.fn().mockResolvedValue({ affected: setting ? 1 : 0 })
  };
}

describe('LegalNoticeService', () => {
  it('returns the built-in default text when no setting exists', async () => {
    const repository = createSettingRepositoryMock();
    const service = new LegalNoticeService(repository as never);

    const result = await service.getLegalNotice();

    expect(result.isDefault).toBe(true);
    expect(result.html).toContain('https://www.iqb.hu-berlin.de/de/datenschutz/');
  });

  it('returns stored text when a setting exists', async () => {
    const repository = createSettingRepositoryMock({
      key: 'system-legal-notice-html',
      content: '<p>Stored</p>'
    });
    const service = new LegalNoticeService(repository as never);

    await expect(service.getLegalNotice()).resolves.toEqual({
      html: '<p>Stored</p>',
      isDefault: false
    });
  });

  it('creates a new setting when saving custom text for the first time', async () => {
    const repository = createSettingRepositoryMock();
    const service = new LegalNoticeService(repository as never);

    const result = await service.updateLegalNotice({ html: ' <p>Custom</p> ' });

    expect(repository.create).toHaveBeenCalledWith({
      key: 'system-legal-notice-html',
      content: '<p>Custom</p>'
    });
    expect(repository.save).toHaveBeenCalledWith({
      key: 'system-legal-notice-html',
      content: '<p>Custom</p>'
    });
    expect(result).toEqual({
      html: '<p>Custom</p>',
      isDefault: false
    });
  });

  it('rejects empty custom text', async () => {
    const service = new LegalNoticeService(createSettingRepositoryMock() as never);

    await expect(service.updateLegalNotice({ html: '   ' }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects missing request bodies', async () => {
    const service = new LegalNoticeService(createSettingRepositoryMock() as never);

    await expect(service.updateLegalNotice(undefined))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('resets custom text by deleting the setting', async () => {
    const repository = createSettingRepositoryMock({
      key: 'system-legal-notice-html',
      content: '<p>Stored</p>'
    });
    const service = new LegalNoticeService(repository as never);

    const result = await service.resetLegalNotice();

    expect(repository.delete).toHaveBeenCalledWith({ key: 'system-legal-notice-html' });
    expect(result.isDefault).toBe(true);
    expect(result.html).toContain('https://www.iqb.hu-berlin.de/de/datenschutz/');
  });
});
