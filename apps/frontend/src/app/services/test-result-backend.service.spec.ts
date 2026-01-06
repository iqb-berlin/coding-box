import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { TestResultBackendService } from './test-result-backend.service';
import { SERVER_URL } from '../injection-tokens';

describe('TestResultBackendService', () => {
  let service: TestResultBackendService;
  let httpMock: HttpTestingController;

  const mockServerUrl = 'http://localhost/api/';

  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: jest.fn().mockReturnValue('mock-token')
      },
      writable: true
    });

    TestBed.configureTestingModule({
      providers: [
        TestResultBackendService,
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        { provide: SERVER_URL, useValue: mockServerUrl }
      ]
    });

    service = TestBed.inject(TestResultBackendService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('getExportOptions', () => {
    it('should fetch options', () => {
      service.getExportOptions(1).subscribe();
      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/1/results/export/options`);
      expect(req.request.method).toBe('GET');
      req.flush({});
    });
  });

  describe('startExportTestResultsJob', () => {
    it('should post export filters', () => {
      service.startExportTestResultsJob(1, { groupNames: ['g1'] }).subscribe();
      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/1/results/export/job`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ groupNames: ['g1'] });
      req.flush({});
    });
  });
});
