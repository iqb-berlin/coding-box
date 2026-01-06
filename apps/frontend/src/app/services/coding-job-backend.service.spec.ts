import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { CodingJobBackendService } from './coding-job-backend.service';
import { SERVER_URL } from '../injection-tokens';
import { CodingJob } from '../coding/models/coding-job.model';

describe('CodingJobBackendService', () => {
  let service: CodingJobBackendService;
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
        CodingJobBackendService,
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        { provide: SERVER_URL, useValue: mockServerUrl }
      ]
    });

    service = TestBed.inject(CodingJobBackendService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('getCodingJobs', () => {
    it('should fetch jobs and map properties', () => {
      const mockApiResponse = {
        data: [{
          id: 1,
          name: 'Job1',
          created_at: '2023-01-01',
          assigned_coders: [1]
        }],
        total: 1
      };

      service.getCodingJobs(1).subscribe(res => {
        expect(res.data.length).toBe(1);
        expect(res.data[0].assignedCoders).toEqual([1]);
        expect(res.data[0].assignedVariables).toEqual([]);
      });

      const req = httpMock.expectOne(`${mockServerUrl}wsg-admin/workspace/1/coding-job`);
      expect(req.request.method).toBe('GET');
      req.flush(mockApiResponse);
    });
  });

  describe('createCodingJob', () => {
    it('should create coding job', () => {
      const job = { name: 'J', workspace_id: 1 } as unknown as Omit<CodingJob, 'id' | 'createdAt' | 'updatedAt'>;
      service.createCodingJob(1, job).subscribe();
      const req = httpMock.expectOne(`${mockServerUrl}wsg-admin/workspace/1/coding-job`);
      expect(req.request.method).toBe('POST');
      req.flush({});
    });
  });
});
