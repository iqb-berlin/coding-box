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

  it('should delete missings profile', () => {
    service.deleteMissingsProfile(1, 'test label').subscribe(res => {
      expect(res).toBe(true);
    });

    const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/1/missings-profiles/test%20label`);
    expect(req.request.method).toBe('DELETE');
    req.flush(true);
  });
});
