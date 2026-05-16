import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { CodingJobBackendService } from './coding-job-backend.service';
import { SERVER_URL } from '../../injection-tokens';
import { CodingJob } from '../models/coding-job.model';
import { ValidationTaskStateService } from '../../shared/services/validation/validation-task-state.service';

describe('CodingJobBackendService', () => {
  let service: CodingJobBackendService;
  let httpMock: HttpTestingController;
  let validationTaskStateServiceMock: { invalidateWorkspace: jest.Mock };

  const mockServerUrl = 'http://localhost/api/';

  beforeEach(() => {
    validationTaskStateServiceMock = {
      invalidateWorkspace: jest.fn()
    };

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
        {
          provide: ValidationTaskStateService,
          useValue: validationTaskStateServiceMock
        },
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
          assigned_coders: [1],
          job_definition_id: 99
        }],
        total: 1
      };

      service.getCodingJobs(1).subscribe(res => {
        expect(res.data.length).toBe(1);
        expect(res.data[0].assignedCoders).toEqual([1]);
        expect(res.data[0].assignedVariables).toEqual([]);
        expect(res.data[0].jobDefinitionId).toBe(99);
      });

      const req = httpMock.expectOne(`${mockServerUrl}wsg-admin/workspace/1/coding-job`);
      expect(req.request.method).toBe('GET');
      req.flush(mockApiResponse);
    });
  });

  describe('getJobDefinitions', () => {
    it('should map created coding job counts from API responses', () => {
      service.getJobDefinitions(1).subscribe(definitions => {
        expect(definitions).toEqual([
          expect.objectContaining({
            id: 7,
            createdJobsCount: 3,
            blockingCreatedJobsCount: 1,
            showScore: true,
            allowComments: false,
            suppressGeneralInstructions: true,
            assignedCoderConfigs: [{ coderId: 1, capacityPercent: 50 }],
            distributionSeed: 'seed-7',
            plannedVariableUsage: { 'Unit 1::Var 1': 2 }
          }),
          expect.objectContaining({
            id: 8,
            createdJobsCount: 0,
            blockingCreatedJobsCount: 0,
            showScore: false,
            allowComments: true,
            suppressGeneralInstructions: false
          })
        ]);
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/1/coding/job-definitions`);
      expect(req.request.method).toBe('GET');
      req.flush([
        {
          id: 7,
          status: 'approved',
          created_jobs_count: 3,
          blocking_created_jobs_count: 1,
          assigned_coder_configs: [{ coderId: 1, capacityPercent: 50 }],
          distribution_seed: 'seed-7',
          planned_variable_usage: { 'Unit 1::Var 1': 2 },
          show_score: true,
          allow_comments: false,
          suppress_general_instructions: true
        },
        {
          id: 8,
          status: 'draft',
          createdJobsCount: 0,
          blockingCreatedJobsCount: 0,
          showScore: false,
          allowComments: true,
          suppressGeneralInstructions: false
        }
      ]);
    });

    it('should create coding jobs through the dedicated job definition endpoint', () => {
      service.createCodingJobFromDefinition(1, 42).subscribe(response => {
        expect(response.success).toBe(true);
        expect(response.jobsCreated).toBe(3);
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/1/coding/job-definitions/42/create-job`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({});
      expect(req.request.headers.get('Authorization')).toBe('Bearer mock-token');
      req.flush({
        success: true,
        jobsCreated: 3,
        message: 'created',
        distribution: {},
        doubleCodingInfo: {},
        aggregationInfo: {},
        matchingFlags: [],
        jobs: []
      });
    });
  });

  describe('auth token override', () => {
    it('should use the supplied auth token when loading coding job units', () => {
      service.getCodingJobUnits(47, 123, 'url-token').subscribe();

      const req = httpMock.expectOne(`${mockServerUrl}wsg-admin/workspace/47/coding-job/123/units`);
      expect(req.request.method).toBe('GET');
      expect(req.request.headers.get('Authorization')).toBe('Bearer url-token');
      req.flush([]);
    });

    it('should request only open coding job units when requested', () => {
      service.getCodingJobUnits(47, 123, 'url-token', true).subscribe();

      const req = httpMock.expectOne(`${mockServerUrl}wsg-admin/workspace/47/coding-job/123/units?onlyOpen=true`);
      expect(req.request.method).toBe('GET');
      expect(req.request.headers.get('Authorization')).toBe('Bearer url-token');
      req.flush([]);
    });

    it('should use the supplied auth token when saving coding progress', () => {
      service.saveCodingProgress(47, 123, {
        testPerson: 'login@code@booklet',
        unitId: 'UNIT',
        variableId: 'VAR',
        selectedCode: { id: 1, code: '1', label: 'Code 1' }
      }, 'url-token').subscribe();

      const req = httpMock.expectOne(`${mockServerUrl}wsg-admin/workspace/47/coding-job/123/progress`);
      expect(req.request.method).toBe('POST');
      expect(req.request.headers.get('Authorization')).toBe('Bearer url-token');
      req.flush({});
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

  describe('transferCodingCases', () => {
    it('should post transfer request for coder cases', () => {
      service.transferCodingCases(7, 11, 22).subscribe(response => {
        expect(response.affectedJobs).toBe(3);
      });

      const req = httpMock.expectOne(`${mockServerUrl}wsg-admin/workspace/7/coding-job/transfer-cases`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({
        sourceCoderId: 11,
        targetCoderId: 22
      });
      req.flush({
        sourceCoderId: 11,
        targetCoderId: 22,
        affectedJobs: 3,
        updatedAssignments: 3,
        removedDuplicateAssignments: 0,
        transferredCases: 42
      });
    });
  });

  describe('triggerResponseAnalysis', () => {
    it('should post the selected threshold when restarting response analysis', () => {
      service.triggerResponseAnalysis(5, 17).subscribe();

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/5/coding/response-analysis`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ threshold: 17 });
      req.flush(null);
    });

    it('should post an empty body when no threshold is supplied', () => {
      service.triggerResponseAnalysis(5).subscribe();

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/5/coding/response-analysis`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({});
      req.flush(null);
    });
  });
});
