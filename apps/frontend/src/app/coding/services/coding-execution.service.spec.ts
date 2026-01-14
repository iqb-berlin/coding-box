import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { CodingExecutionService } from './coding-execution.service';
import { SERVER_URL } from '../../injection-tokens';

describe('CodingExecutionService', () => {
  let service: CodingExecutionService;
  let httpMock: HttpTestingController;
  const mockServerUrl = 'http://localhost/api/';

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        CodingExecutionService,
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        { provide: SERVER_URL, useValue: mockServerUrl }
      ]
    });

    service = TestBed.inject(CodingExecutionService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should code test persons', () => {
    const mockRes = { totalResponses: 1, statusCounts: {} };
    service.codeTestPersons(1, [10]).subscribe(res => {
      expect(res).toEqual(mockRes);
    });

    const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/1/coding?testPersons=10`);
    expect(req.request.method).toBe('GET');
    req.flush(mockRes);
  });

  it('should get coding job status', () => {
    const mockRes = { status: 'completed' as const, progress: 100 };
    service.getCodingJobStatus(1, 'job1').subscribe(res => {
      expect(res.status).toBe('completed');
    });

    const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/1/coding/job/job1`);
    expect(req.request.method).toBe('GET');
    req.flush(mockRes);
  });

  it('should create coding statistics job', () => {
    const mockRes = { jobId: 'job1', message: 'started' };
    service.createCodingStatisticsJob(1).subscribe(res => {
      expect(res.jobId).toBe('job1');
    });

    const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/1/coding/statistics/job`);
    expect(req.request.method).toBe('POST');
    req.flush(mockRes);
  });
});
