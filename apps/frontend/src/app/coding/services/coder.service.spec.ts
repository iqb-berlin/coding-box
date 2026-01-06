import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { CoderService } from './coder.service';
import { AppService } from '../../services/app.service';
import { SERVER_URL } from '../../injection-tokens';

describe('CoderService', () => {
  let service: CoderService;
  let httpMock: HttpTestingController;
  let appServiceMock: jest.Mocked<AppService>;

  const mockServerUrl = 'http://localhost/api';

  beforeEach(() => {
    appServiceMock = {
      selectedWorkspaceId: 1
    } as unknown as jest.Mocked<AppService>;

    TestBed.configureTestingModule({
      providers: [
        CoderService,
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        { provide: SERVER_URL, useValue: mockServerUrl },
        { provide: AppService, useValue: appServiceMock }
      ]
    });

    service = TestBed.inject(CoderService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('getCoders', () => {
    it('should fetch coders', () => {
      const mockResponse = { data: [{ userId: 1, username: 'Coder1' }], total: 1 };
      service.getCoders().subscribe(coders => {
        expect(coders.length).toBe(1);
        expect(coders[0].name).toBe('Coder1');
      });

      const req = httpMock.expectOne(`${mockServerUrl}/admin/workspace/1/coders`);
      expect(req.request.method).toBe('GET');
      req.flush(mockResponse);
    });
  });

  describe('getJobsByCoderId', () => {
    it('should fetch jobs for coder', () => {
      service.getJobsByCoderId(1).subscribe();
      const req = httpMock.expectOne(`${mockServerUrl}/admin/coding-jobs/1/coders`);
      expect(req.request.method).toBe('GET');
      req.flush({ data: [], total: 0 });
    });
  });
});
