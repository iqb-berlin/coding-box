import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { DistributedCodingService } from './distributed-coding.service';
import { SERVER_URL } from '../../injection-tokens';

describe('DistributedCodingService', () => {
  let service: DistributedCodingService;
  let httpMock: HttpTestingController;
  const mockServerUrl = 'http://localhost/api/';

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        DistributedCodingService,
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        { provide: SERVER_URL, useValue: mockServerUrl }
      ]
    });

    service = TestBed.inject(DistributedCodingService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should calculate distribution', () => {
    const mockRes = {
      distribution: {},
      doubleCodingInfo: {},
      aggregationInfo: {},
      matchingFlags: [],
      warnings: []
    };

    service.calculateDistribution(1, [], []).subscribe(res => {
      expect(res).toEqual(mockRes);
    });

    const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/1/coding/calculate-distribution`);
    expect(req.request.method).toBe('POST');
    req.flush(mockRes);
  });

  it('should create distributed coding jobs', () => {
    const mockRes = {
      success: true,
      jobsCreated: 5,
      message: 'Jobs created',
      distribution: {},
      doubleCodingInfo: {},
      aggregationInfo: {},
      matchingFlags: [],
      jobs: []
    };

    service.createDistributedCodingJobs(1, [], []).subscribe(res => {
      expect(res).toEqual(mockRes);
    });

    const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/1/coding/create-distributed-jobs`);
    expect(req.request.method).toBe('POST');
    req.flush(mockRes);
  });
});
