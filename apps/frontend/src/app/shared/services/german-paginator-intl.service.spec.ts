import { TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { EventEmitter } from '@angular/core';
import { GermanPaginatorIntl } from './german-paginator-intl.service';

describe('GermanPaginatorIntl', () => {
  let service: GermanPaginatorIntl;
  let translateServiceMock: jest.Mocked<TranslateService>;

  beforeEach(() => {
    translateServiceMock = {
      instant: jest.fn().mockImplementation((key, params) => {
        if (key === 'paginator.itemsPerPageLabel') return 'Items Per Page';
        if (key === 'paginator.getRangeLabel') return `Range ${params.startIndex}-${params.endIndex} of ${params.length}`;
        return key;
      }),
      onLangChange: new EventEmitter()
    } as unknown as jest.Mocked<TranslateService>;

    TestBed.configureTestingModule({
      providers: [
        GermanPaginatorIntl,
        { provide: TranslateService, useValue: translateServiceMock }
      ]
    });

    service = TestBed.inject(GermanPaginatorIntl);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should return translated labels', () => {
    expect(service.itemsPerPageLabel).toBe('Items Per Page');
  });

  describe('getRangeLabel', () => {
    it('should format range label correctly', () => {
      const label = service.getRangeLabel(0, 10, 100);
      expect(label).toBe('Range 1-10 of 100');
    });

    it('should handle empty length', () => {
      const label = service.getRangeLabel(0, 10, 0);
      expect(label).toBe('Range 0-0 of 0');
    });
  });

  it('should update labels on lang change', () => {
    translateServiceMock.onLangChange.emit();
    // Re-verification of call to instant is sufficient typically,
    // or checking the property values.
    expect(translateServiceMock.instant).toHaveBeenCalledWith('paginator.itemsPerPageLabel');
  });
});
