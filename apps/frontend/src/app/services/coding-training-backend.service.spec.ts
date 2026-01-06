import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { CodingTrainingBackendService } from './coding-training-backend.service';
import { SERVER_URL } from '../injection-tokens';

describe('CodingTrainingBackendService', () => {
  let service: CodingTrainingBackendService;
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
        CodingTrainingBackendService,
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        { provide: SERVER_URL, useValue: mockServerUrl }
      ]
    });

    service = TestBed.inject(CodingTrainingBackendService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('createCoderTrainingJobs', () => {
    it('should create jobs', () => {
      service.createCoderTrainingJobs(1, [], [], 'Label').subscribe();

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/1/coding/coder-training-jobs`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({
        trainingLabel: 'Label',
        selectedCoders: [],
        variableConfigs: [],
        missingsProfileId: undefined
      });
      req.flush({});
    });
  });

  describe('updateCoderTrainingLabel', () => {
    it('should update label', () => {
      service.updateCoderTrainingLabel(1, 10, 'New').subscribe();
      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/1/coding/coder-trainings/10`);
      expect(req.request.method).toBe('PUT');
      req.flush({});
    });
  });
});
