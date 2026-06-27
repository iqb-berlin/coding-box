import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { of } from 'rxjs';
import { CodingExportService } from './coding-export.service';
import { AppService } from '../../core/services/app.service';
import { SERVER_URL } from '../../injection-tokens';
import { CodeBookContentSetting } from '../../../../../../api-dto/coding/codebook-content-setting';

describe('CodingExportService', () => {
  let service: CodingExportService;
  let httpMock: HttpTestingController;
  let appServiceMock: jest.Mocked<AppService>;
  const mockServerUrl = 'http://localhost/api/';

  beforeEach(() => {
    appServiceMock = {
      loggedUser: { sub: 'user' },
      createOwnToken: jest.fn().mockReturnValue(of('auth-token'))
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
    service.getCodingResultsByVersion(1, 'v2', true, false).subscribe(res => {
      expect(res).toBeDefined();
    });

    const req = httpMock.expectOne(request => request.url === `${mockServerUrl}admin/workspace/1/coding/results-by-version` &&
      request.params.get('version') === 'v2' &&
      request.params.get('includeReplayUrls') === 'true' &&
      request.params.get('includeResponseValues') === 'false' &&
      request.params.get('includeGeoGebraResponseValues') === 'false'
    );
    expect(req.request.method).toBe('GET');
    req.flush(new Blob());
  });

  it('should pass GeoGebra response value option to direct result exports', () => {
    service.getCodingResultsByVersion(1, 'v2', false, true, true).subscribe(res => {
      expect(res).toBeDefined();
    });

    const req = httpMock.expectOne(request => request.url === `${mockServerUrl}admin/workspace/1/coding/results-by-version` &&
      request.params.get('includeResponseValues') === 'true' &&
      request.params.get('includeGeoGebraResponseValues') === 'true'
    );
    expect(req.request.method).toBe('GET');
    req.flush(new Blob());
  });

  it('should pass response value option to export jobs', () => {
    service.startExportJob(1, 'results-by-version', 'v1', 'csv', false, undefined, false).subscribe(res => {
      expect(res).toBeDefined();
    });

    const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/1/coding/export/start`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toMatchObject({
      exportType: 'results-by-version',
      version: 'v1',
      format: 'csv',
      includeReplayUrl: false,
      includeResponseValues: false,
      includeGeoGebraFiles: false,
      includeGeoGebraResponseValues: false,
      authToken: 'auth-token'
    });
    req.flush({ jobId: 'job-1', message: 'started' });
  });

  it('should pass GeoGebra package option to Excel result export jobs', () => {
    service.startExportJob(1, 'results-by-version', 'v2', 'excel', false, undefined, true, true).subscribe(res => {
      expect(res).toBeDefined();
    });

    const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/1/coding/export/start`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toMatchObject({
      exportType: 'results-by-version',
      version: 'v2',
      format: 'excel',
      includeResponseValues: true,
      includeGeoGebraFiles: true,
      includeGeoGebraResponseValues: false,
      authToken: 'auth-token'
    });
    req.flush({ jobId: 'job-1', message: 'started' });
  });

  it('should pass raw GeoGebra response value option to export jobs', () => {
    service.startExportJob(
      1,
      'results-by-version',
      'v2',
      'csv',
      false,
      undefined,
      true,
      false,
      true
    ).subscribe(res => {
      expect(res).toBeDefined();
    });

    const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/1/coding/export/start`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toMatchObject({
      exportType: 'results-by-version',
      version: 'v2',
      format: 'csv',
      includeResponseValues: true,
      includeGeoGebraFiles: false,
      includeGeoGebraResponseValues: true,
      authToken: 'auth-token'
    });
    req.flush({ jobId: 'job-1', message: 'started' });
  });

  it('should pass trainingRequired to coding-list export jobs', () => {
    service.startExportJob(1, 'coding-list', undefined, 'json', false, true).subscribe(res => {
      expect(res).toBeDefined();
    });

    const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/1/coding/export/start`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toMatchObject({
      exportType: 'coding-list',
      format: 'json',
      includeReplayUrl: false,
      includeResponseValues: true,
      trainingRequired: true,
      authToken: 'auth-token'
    });
    req.flush({ jobId: 'job-1', message: 'started' });
  });

  it('should cancel export jobs', () => {
    service.cancelExportJob(1, 'job-1').subscribe(res => {
      expect(res.success).toBe(true);
    });

    const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/1/coding/export/job/job-1/cancel`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    req.flush({ success: true, message: 'cancelled' });
  });

  it('should get coding book', () => {
    const mockContent = {
      unitName: true, variableId: true, variableLabel: true, variableDescription: true, value: true, valueLabel: true, valueDescription: true
    } as unknown as CodeBookContentSetting;
    service.getCodingBook(1, 'profile1', mockContent, [1, 2]).subscribe(res => {
      expect(res).toBeDefined();
    });

    const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/1/coding/codebook`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body.missingsProfile).toBe('profile1');
    req.flush(new Blob());
  });
});
