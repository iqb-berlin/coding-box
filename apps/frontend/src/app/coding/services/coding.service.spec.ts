import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { of } from 'rxjs';
import { CodingService } from './coding.service';
import { AppService } from '../../core/services/app.service';
import { SERVER_URL } from '../../injection-tokens';

describe('CodingService', () => {
  let service: CodingService;
  let httpMock: HttpTestingController;
  let appServiceMock: jest.Mocked<AppService>;

  const mockServerUrl = 'http://localhost/api/';

  beforeEach(() => {
    appServiceMock = {
      loggedUser: { sub: 'user' },
      createToken: jest.fn().mockReturnValue(of('auth-token'))
    } as unknown as jest.Mocked<AppService>;

    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: jest.fn().mockReturnValue('mock-token')
      },
      writable: true
    });

    TestBed.configureTestingModule({
      providers: [
        CodingService,
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        { provide: AppService, useValue: appServiceMock },
        { provide: SERVER_URL, useValue: mockServerUrl }
      ]
    });

    service = TestBed.inject(CodingService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('codeTestPersons', () => {
    it('should fetch status counts', () => {
      const mockRes = { totalResponses: 1, statusCounts: {} };
      service.codeTestPersons(1, [10]).subscribe(res => {
        expect(res).toEqual(mockRes);
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/1/coding?testPersons=10`);
      expect(req.request.method).toBe('GET');
      req.flush(mockRes);
    });
  });

  describe('getCodingListAsCsv', () => {
    it('should fetch blob', () => {
      service.getCodingListAsCsv(1).subscribe(res => {
        expect(res).toBeDefined();
      });

      const req = httpMock.expectOne(request => request.url === `${mockServerUrl}admin/workspace/1/coding/coding-list` &&
        request.params.get('authToken') === 'auth-token'
      );
      expect(req.request.method).toBe('GET');
      req.flush(new Blob());
    });
  });
});
