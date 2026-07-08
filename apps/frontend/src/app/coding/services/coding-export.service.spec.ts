import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { CodingExportService } from './coding-export.service';
import { AppService, WorkspaceTokenPolicy } from '../../core/services/app.service';
import { SERVER_URL } from '../../injection-tokens';
import { CodeBookContentSetting } from '../../../../../../api-dto/coding/codebook-content-setting';
import {
  API_SPECIAL_TOKEN_DURATION_DAYS,
  DEFAULT_EXTERNAL_REPLAY_TOKEN_DURATION_DAYS,
  EXTERNAL_REPLAY_WORKSPACE_TOKEN_SCOPES
} from '../../core/services/auth-session.config';
import { WorkspaceSettingsService } from '../../ws-admin/services/workspace-settings.service';

describe('CodingExportService', () => {
  let service: CodingExportService;
  let httpMock: HttpTestingController;
  let appServiceMock: jest.Mocked<AppService>;
  let workspaceSettingsServiceMock: jest.Mocked<WorkspaceSettingsService>;
  const mockServerUrl = 'http://localhost/api/';
  const workspaceTokenPolicy: WorkspaceTokenPolicy = {
    scopes: {
      'replay:read': { maxDurationDays: DEFAULT_EXTERNAL_REPLAY_TOKEN_DURATION_DAYS },
      'replay-statistics:write': { maxDurationDays: API_SPECIAL_TOKEN_DURATION_DAYS },
      'coding-job:operate': { maxDurationDays: API_SPECIAL_TOKEN_DURATION_DAYS }
    }
  };

  beforeEach(() => {
    appServiceMock = {
      loggedUser: { sub: 'user' },
      createOwnToken: jest.fn().mockReturnValue(of('auth-token')),
      getWorkspaceTokenPolicy: jest.fn().mockReturnValue(of(workspaceTokenPolicy))
    } as unknown as jest.Mocked<AppService>;
    workspaceSettingsServiceMock = {
      getReplayUrlExportMode: jest.fn().mockReturnValue(of('auth')),
      getReplayUrlExportTokenDurationDays: jest.fn((_: number, maxDurationDays: number) => of(maxDurationDays))
    } as unknown as jest.Mocked<WorkspaceSettingsService>;

    TestBed.configureTestingModule({
      providers: [
        CodingExportService,
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        { provide: AppService, useValue: appServiceMock },
        { provide: WorkspaceSettingsService, useValue: workspaceSettingsServiceMock },
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

    expect(appServiceMock.getWorkspaceTokenPolicy).toHaveBeenCalled();
    expect(appServiceMock.createOwnToken).toHaveBeenCalledWith(
      1,
      DEFAULT_EXTERNAL_REPLAY_TOKEN_DURATION_DAYS,
      EXTERNAL_REPLAY_WORKSPACE_TOKEN_SCOPES
    );
    expect(workspaceSettingsServiceMock.getReplayUrlExportTokenDurationDays).toHaveBeenCalledWith(
      1,
      DEFAULT_EXTERNAL_REPLAY_TOKEN_DURATION_DAYS
    );
    const req = httpMock.expectOne(request => request.url === `${mockServerUrl}admin/workspace/1/coding/coding-list` &&
      request.params.get('authToken') === 'auth-token'
    );
    expect(req.request.method).toBe('GET');
    req.flush(new Blob());
  });

  it('should use the backend policy duration for coding list CSV tokens', () => {
    appServiceMock.getWorkspaceTokenPolicy.mockReturnValueOnce(of({
      scopes: {
        'replay:read': { maxDurationDays: 60 },
        'replay-statistics:write': { maxDurationDays: 1 },
        'coding-job:operate': { maxDurationDays: 1 }
      }
    }));

    service.getCodingListAsCsv(1).subscribe(res => {
      expect(res).toBeDefined();
    });

    expect(appServiceMock.createOwnToken).toHaveBeenCalledWith(
      1,
      60,
      EXTERNAL_REPLAY_WORKSPACE_TOKEN_SCOPES
    );
    const req = httpMock.expectOne(request => request.url === `${mockServerUrl}admin/workspace/1/coding/coding-list` &&
      request.params.get('authToken') === 'auth-token'
    );
    expect(req.request.params.get('authToken')).toBe('auth-token');
    req.flush(new Blob());
  });

  it('should not export coding list CSV with an empty token when token creation fails', () => {
    appServiceMock.createOwnToken.mockReturnValueOnce(
      throwError(() => new Error('token failed'))
    );
    const nextSpy = jest.fn();

    service.getCodingListAsCsv(1).subscribe({
      next: nextSpy,
      error: error => {
        expect(error).toBeInstanceOf(Error);
      }
    });

    expect(nextSpy).not.toHaveBeenCalled();
    httpMock.expectNone(`${mockServerUrl}admin/workspace/1/coding/coding-list`);
  });

  it('should export coding list CSV with workspace login links in workspaceId mode', () => {
    workspaceSettingsServiceMock.getReplayUrlExportMode.mockReturnValueOnce(of('workspaceId'));

    service.getCodingListAsCsv(1).subscribe(res => {
      expect(res).toBeDefined();
    });

    expect(appServiceMock.createOwnToken).not.toHaveBeenCalled();
    const req = httpMock.expectOne(request => request.url === `${mockServerUrl}admin/workspace/1/coding/coding-list`);
    expect(req.request.params.get('authToken')).toBe('');
    expect(req.request.params.get('serverUrl')).toBe(window.location.origin);
    req.flush(new Blob());
  });

  it('should get coding list as Excel', () => {
    service.getCodingListAsExcel(1).subscribe(res => {
      expect(res).toBeDefined();
    });

    expect(appServiceMock.getWorkspaceTokenPolicy).toHaveBeenCalled();
    expect(appServiceMock.createOwnToken).toHaveBeenCalledWith(
      1,
      DEFAULT_EXTERNAL_REPLAY_TOKEN_DURATION_DAYS,
      EXTERNAL_REPLAY_WORKSPACE_TOKEN_SCOPES
    );
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

    expect(appServiceMock.createOwnToken).toHaveBeenCalledWith(
      1,
      DEFAULT_EXTERNAL_REPLAY_TOKEN_DURATION_DAYS,
      EXTERNAL_REPLAY_WORKSPACE_TOKEN_SCOPES
    );
    const req = httpMock.expectOne(request => request.url === `${mockServerUrl}admin/workspace/1/coding/results-by-version` &&
      request.params.get('authToken') === 'auth-token' &&
      request.params.get('version') === 'v2' &&
      request.params.get('includeReplayUrls') === 'true' &&
      request.params.get('includeResponseValues') === 'false' &&
      request.params.get('includeGeoGebraResponseValues') === 'false'
    );
    expect(req.request.method).toBe('GET');
    req.flush(new Blob());
  });

  it('should use the configured export replay token duration for coding results by version', () => {
    workspaceSettingsServiceMock.getReplayUrlExportTokenDurationDays.mockReturnValueOnce(of(30));

    service.getCodingResultsByVersion(1, 'v2', true, false).subscribe(res => {
      expect(res).toBeDefined();
    });

    expect(appServiceMock.createOwnToken).toHaveBeenCalledWith(
      1,
      30,
      EXTERNAL_REPLAY_WORKSPACE_TOKEN_SCOPES
    );
    const req = httpMock.expectOne(request => request.url === `${mockServerUrl}admin/workspace/1/coding/results-by-version` &&
      request.params.get('authToken') === 'auth-token'
    );
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

    expect(appServiceMock.createOwnToken).not.toHaveBeenCalled();
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
      authToken: ''
    });
    req.flush({ jobId: 'job-1', message: 'started' });
  });

  it('should use external replay tokens for result export jobs with replay URLs', () => {
    service.startExportJob(1, 'results-by-version', 'v1', 'csv', true).subscribe(res => {
      expect(res).toBeDefined();
    });

    expect(appServiceMock.createOwnToken).toHaveBeenCalledWith(
      1,
      DEFAULT_EXTERNAL_REPLAY_TOKEN_DURATION_DAYS,
      EXTERNAL_REPLAY_WORKSPACE_TOKEN_SCOPES
    );
    const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/1/coding/export/start`);
    expect(req.request.body).toMatchObject({
      exportType: 'results-by-version',
      includeReplayUrl: true,
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
      authToken: ''
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
      authToken: ''
    });
    req.flush({ jobId: 'job-1', message: 'started' });
  });

  it('should pass trainingRequired to coding-list export jobs', () => {
    service.startExportJob(1, 'coding-list', undefined, 'json', false, true).subscribe(res => {
      expect(res).toBeDefined();
    });

    expect(appServiceMock.getWorkspaceTokenPolicy).toHaveBeenCalled();
    expect(appServiceMock.createOwnToken).toHaveBeenCalledWith(
      1,
      DEFAULT_EXTERNAL_REPLAY_TOKEN_DURATION_DAYS,
      EXTERNAL_REPLAY_WORKSPACE_TOKEN_SCOPES
    );
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

  it('should use the backend policy duration for coding-list export jobs', () => {
    appServiceMock.getWorkspaceTokenPolicy.mockReturnValueOnce(of({
      scopes: {
        'replay:read': { maxDurationDays: 60 },
        'replay-statistics:write': { maxDurationDays: 1 },
        'coding-job:operate': { maxDurationDays: 1 }
      }
    }));

    service.startExportJob(1, 'coding-list', undefined, 'csv').subscribe(res => {
      expect(res).toBeDefined();
    });

    expect(appServiceMock.createOwnToken).toHaveBeenCalledWith(
      1,
      60,
      EXTERNAL_REPLAY_WORKSPACE_TOKEN_SCOPES
    );
    const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/1/coding/export/start`);
    expect(req.request.body).toMatchObject({
      exportType: 'coding-list',
      format: 'csv',
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
