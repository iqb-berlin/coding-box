import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { MissingsProfileService } from './missings-profile.service';
import { SERVER_URL } from '../../injection-tokens';

describe('MissingsProfileService', () => {
  let service: MissingsProfileService;
  let httpMock: HttpTestingController;
  const mockServerUrl = 'http://localhost/api/';

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        MissingsProfileService,
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        { provide: SERVER_URL, useValue: mockServerUrl }
      ]
    });

    service = TestBed.inject(MissingsProfileService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should get missings profiles', () => {
    const mockRes = [{ label: 'test', id: 1 }];
    service.getMissingsProfiles(1).subscribe(res => {
      expect(res).toEqual(mockRes);
    });

    const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/1/coding/missings-profiles`);
    expect(req.request.method).toBe('GET');
    req.flush(mockRes);
  });

  it('should expose missing-profile request errors to strict callers', () => {
    const onError = jest.fn();
    service.getMissingsProfilesOrThrow(1).subscribe({ error: onError });

    const req = httpMock.expectOne(
      `${mockServerUrl}admin/workspace/1/coding/missings-profiles`
    );
    req.flush('failed', {
      status: 500,
      statusText: 'Server Error'
    });

    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('should load export profiles from the read-only endpoint', () => {
    const mockRes = [{ label: 'IQB-Standard', id: 4 }];

    service.getExportMissingsProfilesOrThrow(1).subscribe(res => {
      expect(res).toEqual(mockRes);
    });

    const req = httpMock.expectOne(
      `${mockServerUrl}admin/workspace/1/coding/export-missings-profiles`
    );
    expect(req.request.method).toBe('GET');
    req.flush(mockRes);
  });

  it('should delete missings profile', () => {
    service.deleteMissingsProfile(1, 'test label').subscribe(res => {
      expect(res).toBe(true);
    });

    const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/1/missings-profiles/test%20label`);
    expect(req.request.method).toBe('DELETE');
    req.flush(true);
  });
});
