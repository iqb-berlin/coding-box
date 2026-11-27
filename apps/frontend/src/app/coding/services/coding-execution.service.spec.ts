import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { GermanTranslationsTestingModule } from '../../../testing/german-translations';
import { CodingExecutionService } from './coding-execution.service';
import { pollCodingStatisticsStatus } from './coding-statistics-job-polling';
import { SERVER_URL } from '../../injection-tokens';

describe('CodingExecutionService', () => {
  let service: CodingExecutionService;
  let httpMock: HttpTestingController;
  const mockServerUrl = 'http://localhost/api/';

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [GermanTranslationsTestingModule],
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
    service.codeTestPersons(1, [10], 2).subscribe(res => {
      expect(res).toEqual(mockRes);
    });

    const req = httpMock.expectOne(
      `${mockServerUrl}admin/workspace/1/coding`
    );
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ selection: { personIds: [10] }, autoCoderRun: 2 });
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

  it('should not request coding job status without a job id', () => {
    service.getCodingJobStatus(1, '').subscribe(res => {
      expect(res).toEqual({
        status: 'failed',
        progress: 0,
        error: 'Fehlende Job-ID für Statusabfrage'
      });
    });

    httpMock.expectNone(`${mockServerUrl}admin/workspace/1/coding/job/`);
  });

  it('should get coding statistics job status', () => {
    const mockRes = { status: 'completed' as const, progress: 100 };
    service.getCodingStatisticsJobStatus(1, 'job1').subscribe(res => {
      expect(res.status).toBe('completed');
    });

    const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/1/coding/statistics/job/job1`);
    expect(req.request.method).toBe('GET');
    req.flush(mockRes);
  });

  it('propagates an HTTP error from the statistics status request', () => {
    const error = jest.fn();
    service.getCodingStatisticsJobStatus(1, 'job1').subscribe({ error });
    httpMock.expectOne(`${mockServerUrl}admin/workspace/1/coding/statistics/job/job1`)
      .flush({ message: 'Request failed' }, { status: 404, statusText: 'Not Found' });
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ status: 404 }));
  });

  it('keeps polling after an HTTP 503 and delivers the completed statistics', () => {
    jest.useFakeTimers();
    try {
      const jobUrl = `${mockServerUrl}admin/workspace/1/coding/statistics/job/job1`;
      const reportStatusError = jest.fn();
      const next = jest.fn();
      const completed = { status: 'completed', progress: 100, result: { totalResponses: 42, statusCounts: {} } };
      const subscription = pollCodingStatisticsStatus(
        () => service.getCodingStatisticsJobStatus(1, 'job1'),
        reportStatusError
      ).subscribe(next);

      jest.advanceTimersByTime(0);
      httpMock.expectOne(jobUrl).flush(null, { status: 503, statusText: 'Service Unavailable' });
      expect(next).not.toHaveBeenCalled();
      jest.advanceTimersByTime(2000);
      httpMock.expectOne(jobUrl).flush(completed);
      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith(completed);
      expect(reportStatusError).not.toHaveBeenCalled();
      expect(subscription.closed).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('should create coding statistics job', () => {
    const mockRes = { jobId: 'job1', message: 'started' };
    service.createCodingStatisticsJob(1, 'v1').subscribe(res => {
      expect(res.jobId).toBe('job1');
    });

    const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/1/coding/statistics/job?version=v1`);
    expect(req.request.method).toBe('POST');
    req.flush(mockRes);
  });
});
