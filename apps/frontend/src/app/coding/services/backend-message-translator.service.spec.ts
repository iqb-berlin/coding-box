import { TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { BackendMessageTranslatorService } from './backend-message-translator.service';

describe('BackendMessageTranslatorService', () => {
  let service: BackendMessageTranslatorService;
  let translateServiceMock: jest.Mocked<TranslateService>;

  beforeEach(() => {
    translateServiceMock = {
      instant: jest.fn().mockImplementation((key, params) => {
        if (key === 'backend-messages.success') return 'Success Translated';
        if (key === 'test-person-coding.job-cancelled-by-id') return `Job ${params.id} cancelled`;
        return key;
      })
    } as unknown as jest.Mocked<TranslateService>;

    TestBed.configureTestingModule({
      providers: [
        BackendMessageTranslatorService,
        { provide: TranslateService, useValue: translateServiceMock }
      ]
    });

    service = TestBed.inject(BackendMessageTranslatorService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('translateMessage', () => {
    it('should translate static messages', () => {
      const msg = 'Success';
      const result = service.translateMessage(msg);
      expect(translateServiceMock.instant).toHaveBeenCalledWith('backend-messages.success');
      expect(result).toBe('Success Translated');
    });

    it('should translate dynamic messages', () => {
      const msg = 'Job 123 cancelled successfully';
      const result = service.translateMessage(msg);
      expect(translateServiceMock.instant).toHaveBeenCalledWith('test-person-coding.job-cancelled-by-id', { id: '123' });
      expect(result).toBe('Job 123 cancelled');
    });

    it('should translate training creation success message', () => {
      const msg = 'Successfully created 5 coder training jobs';
      service.translateMessage(msg);
      expect(translateServiceMock.instant).toHaveBeenCalledWith('coding.trainings.create.success', { count: '5' });
    });

    it('should return original message if no translation found', () => {
      const msg = 'Unknown Error';
      const result = service.translateMessage(msg);
      expect(result).toBe(msg);
    });
  });
});
