import { LegalNoticeController } from './legal-notice.controller';
import { LegalNoticeService } from './legal-notice.service';

describe('LegalNoticeController', () => {
  const service = {
    getLegalNotice: jest.fn(),
    updateLegalNotice: jest.fn(),
    resetLegalNotice: jest.fn()
  } as unknown as jest.Mocked<LegalNoticeService>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reads the legal notice through the service', async () => {
    service.getLegalNotice.mockResolvedValue({ html: '<p>Text</p>', isDefault: false });
    const controller = new LegalNoticeController(service);

    await expect(controller.getLegalNotice()).resolves.toEqual({
      html: '<p>Text</p>',
      isDefault: false
    });
  });

  it('updates the legal notice through the service', async () => {
    service.updateLegalNotice.mockResolvedValue({ html: '<p>Updated</p>', isDefault: false });
    const controller = new LegalNoticeController(service);

    await controller.updateLegalNotice({ html: '<p>Updated</p>' });

    expect(service.updateLegalNotice).toHaveBeenCalledWith({ html: '<p>Updated</p>' });
  });

  it('resets the legal notice through the service', async () => {
    service.resetLegalNotice.mockResolvedValue({ html: '<p>Default</p>', isDefault: true });
    const controller = new LegalNoticeController(service);

    await expect(controller.resetLegalNotice()).resolves.toEqual({
      html: '<p>Default</p>',
      isDefault: true
    });
  });
});
