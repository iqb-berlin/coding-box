import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { WorkspaceSettingsService } from './workspace-settings.service';
import { SERVER_URL } from '../../injection-tokens';

describe('WorkspaceSettingsService', () => {
  let service: WorkspaceSettingsService;
  let httpMock: HttpTestingController;

  const mockServerUrl = 'http://localhost/api';

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        WorkspaceSettingsService,
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        { provide: SERVER_URL, useValue: mockServerUrl }
      ]
    });

    service = TestBed.inject(WorkspaceSettingsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('getWorkspaceSetting', () => {
    it('should fetch setting', () => {
      service.getWorkspaceSetting(1, 'k').subscribe();
      const req = httpMock.expectOne(`${mockServerUrl}/workspace/1/settings/k`);
      expect(req.request.method).toBe('GET');
      req.flush({});
    });
  });

  describe('setWorkspaceSetting', () => {
    it('should post setting', () => {
      service.setWorkspaceSetting(1, 'k', 'v').subscribe();
      const req = httpMock.expectOne(`${mockServerUrl}/workspace/1/settings`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ key: 'k', value: 'v', description: undefined });
      req.flush({});
    });
  });

  describe('getAutoFetchCodingStatistics', () => {
    it('should return parsed boolean', () => {
      service.getAutoFetchCodingStatistics(1).subscribe(val => {
        expect(val).toBe(true);
      });
      const req = httpMock.expectOne(`${mockServerUrl}/workspace/1/settings/auto-fetch-coding-statistics`);
      req.flush({ value: '{"enabled":true}' });
    });

    it('should return true on error', () => {
      service.getAutoFetchCodingStatistics(1).subscribe(val => {
        expect(val).toBe(true);
      });
      const req = httpMock.expectOne(`${mockServerUrl}/workspace/1/settings/auto-fetch-coding-statistics`);
      req.flush({}, { status: 404, statusText: 'Not Found' });
    });
  });
});
