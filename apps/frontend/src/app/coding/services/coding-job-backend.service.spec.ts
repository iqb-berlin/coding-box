import { TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import {
  provideHttpClient,
  withInterceptorsFromDi
} from '@angular/common/http';
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
        data: [
          {
            id: 1,
            name: 'Job1',
            created_at: '2023-01-01',
            assigned_coders: [1],
            job_definition_id: 99
          }
        ],
        total: 1
      };

      service.getCodingJobs(1).subscribe(res => {
        expect(res.data.length).toBe(1);
        expect(res.data[0].assignedCoders).toEqual([1]);
        expect(res.data[0].assignedVariables).toEqual([]);
        expect(res.data[0].jobDefinitionId).toBe(99);
      });

      const req = httpMock.expectOne(
        `${mockServerUrl}wsg-admin/workspace/1/coding-job`
      );
      expect(req.request.method).toBe('GET');
      req.flush(mockApiResponse);
    });

    it('should pass assignedTo=me when requesting own coding jobs', () => {
      service
        .getCodingJobs(1, undefined, undefined, { assignedTo: 'me' })
        .subscribe(res => {
          expect(res.data).toEqual([]);
        });

      const req = httpMock.expectOne(
        `${mockServerUrl}wsg-admin/workspace/1/coding-job?assignedTo=me`
      );
      expect(req.request.method).toBe('GET');
      req.flush({ data: [], total: 0, page: 1 });
    });

    it('should pass pagination and list filter options when requesting coding jobs', () => {
      service
        .getCodingJobs(1, 2, 25, {
          scope: 'productive',
          status: 'completed',
          excludeStatus: 'review',
          coderId: 7,
          jobName: 'Job 1',
          sortBy: 'updatedAt',
          sortDirection: 'asc',
          trainingId: 'none',
          includeIssueSummary: true
        })
        .subscribe(res => {
          expect(res.data).toEqual([]);
        });

      const req = httpMock.expectOne(
        request => request.url === `${mockServerUrl}wsg-admin/workspace/1/coding-job` &&
          request.params.get('page') === '2' &&
          request.params.get('limit') === '25' &&
          request.params.get('scope') === 'productive' &&
          request.params.get('status') === 'completed' &&
          request.params.get('excludeStatus') === 'review' &&
          request.params.get('coderId') === '7' &&
          request.params.get('jobName') === 'Job 1' &&
          request.params.get('sortBy') === 'updatedAt' &&
          request.params.get('sortDirection') === 'asc' &&
          request.params.get('trainingId') === 'none' &&
          request.params.get('includeIssueSummary') === 'true'
      );
      expect(req.request.method).toBe('GET');
      req.flush({
        data: [], total: 0, page: 2, limit: 25
      });
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
            distributionSnapshots: [
              expect.objectContaining({
                version: 1,
                source: 'initial_creation',
                distributionSeed: 'seed-7'
              })
            ],
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

      const req = httpMock.expectOne(
        `${mockServerUrl}admin/workspace/1/coding/job-definitions`
      );
      expect(req.request.method).toBe('GET');
      req.flush([
        {
          id: 7,
          status: 'approved',
          created_jobs_count: 3,
          blocking_created_jobs_count: 1,
          assigned_coder_configs: [{ coderId: 1, capacityPercent: 50 }],
          distribution_seed: 'seed-7',
          distribution_snapshots: [
            {
              version: 1,
              source: 'initial_creation',
              createdAt: '2026-06-01T00:00:00.000Z',
              distributionSeed: 'seed-7',
              selectedVariables: [],
              selectedVariableBundles: [],
              selectedCoders: [{ coderId: 1, capacityPercent: 50 }],
              settings: {},
              distributionByCoderId: {},
              doubleCodingInfo: {},
              aggregationInfo: {},
              matchingFlags: [],
              pairDistribution: {},
              tasksPerCoder: {},
              coderWeights: {},
              jobs: []
            }
          ],
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

      const req = httpMock.expectOne(
        `${mockServerUrl}admin/workspace/1/coding/job-definitions/42/create-job`
      );
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({});
      expect(req.request.headers.get('Authorization')).toBe(
        'Bearer mock-token'
      );
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

    it('should preview coding jobs through the dedicated job definition endpoint', () => {
      service.previewCodingJobFromDefinition(1, 42).subscribe(response => {
        expect(response.distribution).toEqual({ 'Unit::Var': { Ada: 1 } });
        expect(response.warnings).toEqual([]);
        expect(response.selectedVariables).toEqual([
          { unitName: 'Unit', variableId: 'Var', includeDeriveError: true }
        ]);
        expect(response.selectedVariableBundles).toEqual([]);
        expect(response.selectedCoders).toEqual([
          {
            id: 1,
            name: 'Ada',
            username: 'Ada',
            capacityPercent: 100
          }
        ]);
      });

      const req = httpMock.expectOne(
        `${mockServerUrl}admin/workspace/1/coding/job-definitions/42/create-job-preview`
      );
      expect(req.request.method).toBe('GET');
      expect(req.request.headers.get('Authorization')).toBe(
        'Bearer mock-token'
      );
      req.flush({
        distribution: { 'Unit::Var': { Ada: 1 } },
        distributionByCoderId: { 'Unit::Var': { 1: 1 } },
        doubleCodingInfo: {},
        aggregationInfo: {},
        matchingFlags: [],
        warnings: [],
        pairDistribution: {},
        tasksPerCoder: {},
        coderWeights: {},
        selectedVariables: [
          { unitName: 'Unit', variableId: 'Var', includeDeriveError: true }
        ],
        selectedVariableBundles: [],
        selectedCoders: [
          {
            id: 1,
            name: 'Ada',
            username: 'Ada',
            capacityPercent: 100
          }
        ]
      });
    });

    it('should export a job definition distribution as CSV', () => {
      const mockBlob = new Blob(['Jobdefinition-ID;Coder'], {
        type: 'text/csv'
      });

      service
        .exportJobDefinitionDistributionCsv(1, 42)
        .subscribe(response => {
          expect(response).toBe(mockBlob);
        });

      const req = httpMock.expectOne(
        `${mockServerUrl}admin/workspace/1/coding/job-definitions/42/distribution/csv`
      );
      expect(req.request.method).toBe('GET');
      expect(req.request.responseType).toBe('blob');
      expect(req.request.headers.get('Authorization')).toBe(
        'Bearer mock-token'
      );
      req.flush(mockBlob);
    });

    it('should preview a job definition refresh', () => {
      service.previewJobDefinitionRefresh(1, 42).subscribe(response => {
        expect(response.addedCases).toBe(2);
        expect(response.canApply).toBe(true);
      });

      const req = httpMock.expectOne(
        `${mockServerUrl}admin/workspace/1/coding/job-definitions/42/refresh-preview`
      );
      expect(req.request.method).toBe('GET');
      req.flush({
        jobDefinitionId: 42,
        existingJobsCount: 2,
        staleJobsCount: 1,
        existingCases: 5,
        plannedCases: 7,
        retainedCases: 5,
        addedCases: 2,
        removedCases: 0,
        addedCodingTasks: 2,
        removedCodingTasks: 0,
        canApply: true
      });
    });

    it('should apply a job definition refresh and invalidate validation state', () => {
      service.applyJobDefinitionRefresh(1, 42).subscribe(response => {
        expect(response.success).toBe(true);
        expect(response.jobsCreated).toBe(2);
      });

      const req = httpMock.expectOne(
        `${mockServerUrl}admin/workspace/1/coding/job-definitions/42/refresh-apply`
      );
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({});
      req.flush({
        success: true,
        message: 'updated',
        jobsCreated: 2,
        preview: {
          jobDefinitionId: 42,
          existingJobsCount: 2,
          staleJobsCount: 1,
          existingCases: 5,
          plannedCases: 7,
          retainedCases: 5,
          addedCases: 2,
          removedCases: 0,
          addedCodingTasks: 2,
          removedCodingTasks: 0,
          canApply: true
        }
      });
      expect(
        validationTaskStateServiceMock.invalidateWorkspace
      ).toHaveBeenCalledWith(1);
    });

    it('should preview a job definition update refresh with the proposed definition', () => {
      const update = { maxCodingCases: 4 };

      service.previewJobDefinitionUpdateRefresh(1, 42, update).subscribe(response => {
        expect(response.plannedCases).toBe(4);
        expect(response.canApply).toBe(true);
      });

      const req = httpMock.expectOne(
        `${mockServerUrl}admin/workspace/1/coding/job-definitions/42/update-refresh-preview`
      );
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(update);
      req.flush({
        jobDefinitionId: 42,
        existingJobsCount: 2,
        staleJobsCount: 1,
        existingCases: 5,
        plannedCases: 4,
        retainedCases: 4,
        addedCases: 0,
        removedCases: 1,
        addedCodingTasks: 0,
        removedCodingTasks: 1,
        canApply: true
      });
    });

    it('should apply a job definition update refresh and invalidate validation state', () => {
      const update = { maxCodingCases: 4 };

      service.applyJobDefinitionUpdateRefresh(1, 42, update).subscribe(response => {
        expect(response.success).toBe(true);
        expect(response.jobsCreated).toBe(2);
      });

      const req = httpMock.expectOne(
        `${mockServerUrl}admin/workspace/1/coding/job-definitions/42/update-refresh-apply`
      );
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(update);
      req.flush({
        success: true,
        message: 'updated',
        jobsCreated: 2,
        preview: {
          jobDefinitionId: 42,
          existingJobsCount: 2,
          staleJobsCount: 1,
          existingCases: 5,
          plannedCases: 4,
          retainedCases: 4,
          addedCases: 0,
          removedCases: 1,
          addedCodingTasks: 0,
          removedCodingTasks: 1,
          canApply: true
        }
      });
      expect(
        validationTaskStateServiceMock.invalidateWorkspace
      ).toHaveBeenCalledWith(1);
    });
  });

  describe('auth token override', () => {
    it('should use the supplied auth token when loading coding job units', () => {
      service.getCodingJobUnits(47, 123, 'url-token').subscribe();

      const req = httpMock.expectOne(
        `${mockServerUrl}wsg-admin/workspace/47/coding-job/123/units`
      );
      expect(req.request.method).toBe('GET');
      expect(req.request.headers.get('Authorization')).toBe('Bearer url-token');
      req.flush([]);
    });

    it('should request only open coding job units when requested', () => {
      service.getCodingJobUnits(47, 123, 'url-token', true).subscribe();

      const req = httpMock.expectOne(
        `${mockServerUrl}wsg-admin/workspace/47/coding-job/123/units?onlyOpen=true`
      );
      expect(req.request.method).toBe('GET');
      expect(req.request.headers.get('Authorization')).toBe('Bearer url-token');
      req.flush([]);
    });

    it('should prepare coding job reviews through the read-only endpoint', () => {
      service.prepareCodingJobReview(47, 123).subscribe();

      const req = httpMock.expectOne(
        `${mockServerUrl}wsg-admin/workspace/47/coding-job/123/review`
      );
      expect(req.request.method).toBe('GET');
      req.flush({ total: 1, firstReplayUrl: 'http://replay.url' });
    });

    it('should submit coding jobs for review through the coder endpoint', () => {
      service.submitCodingJobForReview(47, 123).subscribe(job => {
        expect(job).toEqual(
          expect.objectContaining({
            id: 123,
            workspace_id: 47,
            status: 'review'
          })
        );
      });

      const req = httpMock.expectOne(
        `${mockServerUrl}wsg-admin/workspace/47/coding-job/123/submit-review`
      );
      expect(req.request.method).toBe('POST');
      req.flush({
        id: 123,
        workspace_id: 47,
        status: 'review'
      });
    });

    it.each([
      ['pauseCodingJob', 'pause'],
      ['resumeCodingJob', 'resume'],
      ['submitCodingJob', 'submit']
    ] as const)('should use the %s endpoint with auth token override', (methodName, path) => {
      service[methodName](47, 123, 'url-token').subscribe();

      const req = httpMock.expectOne(
        `${mockServerUrl}wsg-admin/workspace/47/coding-job/123/${path}`
      );
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({});
      expect(req.request.headers.get('Authorization')).toBe('Bearer url-token');
      req.flush({});
    });

    it('should use the supplied auth token when saving coding progress', () => {
      service
        .saveCodingProgress(
          47,
          123,
          {
            testPerson: 'login@code@booklet',
            unitId: 'UNIT',
            variableId: 'VAR',
            selectedCode: { id: 1, code: '1', label: 'Code 1' }
          },
          'url-token'
        )
        .subscribe();

      const req = httpMock.expectOne(
        `${mockServerUrl}wsg-admin/workspace/47/coding-job/123/progress`
      );
      expect(req.request.method).toBe('POST');
      expect(req.request.headers.get('Authorization')).toBe('Bearer url-token');
      req.flush({});
    });
  });

  describe('createCodingJob', () => {
    it('should create coding job', () => {
      const job = { name: 'J', workspace_id: 1 } as unknown as Omit<
      CodingJob,
      'id' | 'createdAt' | 'updatedAt'
      >;
      service.createCodingJob(1, job).subscribe();
      const req = httpMock.expectOne(
        `${mockServerUrl}wsg-admin/workspace/1/coding-job`
      );
      expect(req.request.method).toBe('POST');
      req.flush({});
    });
  });

  describe('transferCodingCases', () => {
    it('should post transfer request for coder cases', () => {
      service.transferCodingCases(7, 11, 22).subscribe(response => {
        expect(response.affectedJobs).toBe(3);
      });

      const req = httpMock.expectOne(
        `${mockServerUrl}wsg-admin/workspace/7/coding-job/transfer-cases`
      );
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

      const req = httpMock.expectOne(
        `${mockServerUrl}admin/workspace/5/coding/response-analysis`
      );
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ threshold: 17 });
      req.flush(null);
    });

    it('should post an empty body when no threshold is supplied', () => {
      service.triggerResponseAnalysis(5).subscribe();

      const req = httpMock.expectOne(
        `${mockServerUrl}admin/workspace/5/coding/response-analysis`
      );
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({});
      req.flush(null);
    });
  });
});
