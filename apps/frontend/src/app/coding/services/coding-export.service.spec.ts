import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { of } from 'rxjs';
import { CodingExportService } from './coding-export.service';
import { AppService } from '../../core/services/app.service';
import { SERVER_URL } from '../../injection-tokens';

describe('CodingExportService', () => {
  let service: CodingExportService;
  let httpMock: HttpTestingController;
  let appServiceMock: jest.Mocked<AppService>;
  const mockServerUrl = 'http://localhost/api/';

  beforeEach(() => {
    appServiceMock = {
      loggedUser: { sub: 'user' },
      createToken: jest.fn().mockReturnValue(of('auth-token'))
    } as unknown as jest.Mocked<AppService>;

    TestBed.configureTestingModule({
      providers: [
        CodingExportService,
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        { provide: AppService, useValue: appServiceMock },
        { provide: SERVER_URL, useValue: mockServerUrl }
      ]
    });

    service = TestBed.inject(CodingExportService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should get coding list as CSV', () => {
    service.getCodingListAsCsv(1).subscribe(res => {
      expect(res).toBeDefined();
    });

    const req = httpMock.expectOne(request => request.url === `${mockServerUrl}admin/workspace/1/coding/coding-list` &&
      request.params.get('authToken') === 'auth-token'
    );
    expect(req.request.method).toBe('GET');
    req.flush(new Blob());
  });

  it('should get coding list as Excel', () => {
    service.getCodingListAsExcel(1).subscribe(res => {
      expect(res).toBeDefined();
    });

    const req = httpMock.expectOne(request => request.url === `${mockServerUrl}admin/workspace/1/coding/coding-list/excel` &&
      request.params.get('authToken') === 'auth-token'
    );
    expect(req.request.method).toBe('GET');
    req.flush(new Blob());
  });

  it('should get coding results by version', () => {
    service.getCodingResultsByVersion(1, 'v2', true).subscribe(res => {
      expect(res).toBeDefined();
    });

    const req = httpMock.expectOne(request => request.url === `${mockServerUrl}admin/workspace/1/coding/results-by-version` &&
      request.params.get('version') === 'v2' &&
      request.params.get('includeReplayUrls') === 'true'
    );
    expect(req.request.method).toBe('GET');
    req.flush(new Blob());
  });

  it('should get coding book', () => {
    const mockContent: any = {
      unitName: true, variableId: true, variableLabel: true, variableDescription: true, value: true, valueLabel: true, valueDescription: true
    };
    service.getCodingBook(1, 'profile1', mockContent, [1, 2]).subscribe(res => {
      expect(res).toBeDefined();
    });

    const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/1/coding/codebook`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body.missingsProfile).toBe('profile1');
    req.flush(new Blob());
  });
});
