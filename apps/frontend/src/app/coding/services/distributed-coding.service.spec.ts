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

  it('should include case ordering mode in distribution calculation payload', () => {
    const mockRes = {
      distribution: {},
      doubleCodingInfo: {},
      aggregationInfo: {},
      matchingFlags: [],
      warnings: []
    };

    service.calculateDistribution(
      1,
      [{ unitName: 'UNIT', variableId: 'VAR' }],
      [{ id: 7, name: 'Coder', username: 'Coder' }],
      2,
      undefined,
      [],
      'alternating',
      20
    ).subscribe(res => {
      expect(res).toEqual(mockRes);
    });

    const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/1/coding/calculate-distribution`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(expect.objectContaining({
      caseOrderingMode: 'alternating',
      maxCodingCases: 20
    }));
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
    expect(req.request.body).not.toHaveProperty('jobDefinitionId');
    req.flush(mockRes);
  });

  it('should propagate backend error messages for distribution calculation', done => {
    service.calculateDistribution(1, [], []).subscribe({
      next: () => done(new Error('Expected request to fail')),
      error: error => {
        expect(error.message).toBe('Double coding requires at least 2 selected coders.');
        done();
      }
    });

    const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/1/coding/calculate-distribution`);
    req.flush(
      { message: 'Double coding requires at least 2 selected coders.' },
      { status: 400, statusText: 'Bad Request' }
    );
  });
});
