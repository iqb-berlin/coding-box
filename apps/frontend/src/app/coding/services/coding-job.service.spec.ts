import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { CodingJobService } from './coding-job.service';
import { AppService } from '../../core/services/app.service';
import { SERVER_URL } from '../../injection-tokens';
import { CodingJob } from '../models/coding-job.model';
import { ResponseEntity } from '../../shared/models/response-entity.model';

describe('CodingJobService', () => {
  let service: CodingJobService;
  let httpMock: HttpTestingController;
  let appServiceMock: jest.Mocked<AppService>;

  const mockServerUrl = 'http://localhost/api/';
  const mockWorkspaceId = 123;

  beforeEach(() => {
    appServiceMock = {
      selectedWorkspaceId: mockWorkspaceId
    } as unknown as jest.Mocked<AppService>;

    TestBed.configureTestingModule({
      providers: [
        CodingJobService,
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        { provide: AppService, useValue: appServiceMock },
        { provide: SERVER_URL, useValue: mockServerUrl }
      ]
    });

    service = TestBed.inject(CodingJobService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('assignCoder', () => {
    const mockCodingJob = {
      id: 1,
      name: 'Job 1',
      created_at: new Date('2023-01-01').toISOString(), // Service expects string from backend
      updated_at: new Date('2023-01-02').toISOString()
    } as unknown as CodingJob; // Use partial/unknown if full interface is complex

    it('should assign coder and update local state', () => {
      const coderId = 99;

      // Since assignCoder updates the subject, we should verify the subject emits.

      service.assignCoder(1, coderId).subscribe(updatedJob => {
        expect(updatedJob).toBeTruthy();
        expect(updatedJob!.id).toBe(1);
        expect(updatedJob!.created_at).toBeInstanceOf(Date);
        expect(updatedJob!.updated_at).toBeInstanceOf(Date);
      });

      // Note: The service code has inconsistent slash usage.
      // Line 29: `${this.serverUrl}/admin...` -> 'http://localhost/api//admin...'
      const expectedUrl = `${mockServerUrl}/admin/workspace/${mockWorkspaceId}/coding-jobs/1/assign/${coderId}`;

      const req = httpMock.expectOne(expectedUrl);
      expect(req.request.method).toBe('POST');
      req.flush(mockCodingJob);
    });

    it('should return undefined if no workspace selected', () => {
      Object.defineProperty(appServiceMock, 'selectedWorkspaceId', { get: () => null });
      service.assignCoder(1, 99).subscribe(res => {
        expect(res).toBeUndefined();
      });
      httpMock.expectNone(() => true);
    });

    it('should handle error and return undefined', () => {
      service.assignCoder(1, 99).subscribe(res => {
        expect(res).toBeUndefined();
      });

      const expectedUrl = `${mockServerUrl}/admin/workspace/${mockWorkspaceId}/coding-jobs/1/assign/99`;
      const req = httpMock.expectOne(expectedUrl);
      req.flush('Error', { status: 500, statusText: 'Server Error' });
    });
  });

  describe('getResponsesForCodingJob', () => {
    it('should fetch responses', () => {
      const mockResponses = [{ id: 1 }, { id: 2 }] as unknown as ResponseEntity[];
      const jobId = 5;

      service.getResponsesForCodingJob(jobId).subscribe(res => {
        expect(res).toEqual(mockResponses);
      });

      // Line 53: `${this.serverUrl}admin...` -> 'http://localhost/api/admin...'
      const expectedUrl = `${mockServerUrl}admin/coding-jobs/${jobId}/responses`;

      const req = httpMock.expectOne(expectedUrl);
      expect(req.request.method).toBe('GET');
      req.flush({ data: mockResponses });
    });
  });
});
