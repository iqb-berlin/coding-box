import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { CodingTrainingBackendService } from './coding-training-backend.service';
import { SERVER_URL } from '../../injection-tokens';

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

  describe('getCoderTrainings', () => {
    const coderTrainings = [{
      id: 10,
      workspace_id: 1,
      label: 'Training A',
      created_at: new Date('2026-01-01T00:00:00.000Z'),
      updated_at: new Date('2026-01-01T00:00:00.000Z'),
      jobsCount: 2
    }];

    it('should share an in-flight coder training request', () => {
      const received: unknown[] = [];

      service.getCoderTrainings(1).subscribe(trainings => received.push(trainings));
      service.getCoderTrainings(1).subscribe(trainings => received.push(trainings));

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/1/coding/coder-trainings`);
      expect(req.request.method).toBe('GET');
      req.flush(coderTrainings);

      expect(received).toEqual([coderTrainings, coderTrainings]);
      httpMock.expectNone(`${mockServerUrl}admin/workspace/1/coding/coder-trainings`);
    });

    it('should reuse cached coder trainings after the first request', () => {
      const received: unknown[] = [];

      service.getCoderTrainings(1).subscribe(trainings => received.push(trainings));

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/1/coding/coder-trainings`);
      req.flush(coderTrainings);

      service.getCoderTrainings(1).subscribe(trainings => received.push(trainings));

      expect(received).toEqual([coderTrainings, coderTrainings]);
      httpMock.expectNone(`${mockServerUrl}admin/workspace/1/coding/coder-trainings`);
    });

    it('should invalidate cached coder trainings after a training mutation', () => {
      service.getCoderTrainings(1).subscribe();
      httpMock
        .expectOne(`${mockServerUrl}admin/workspace/1/coding/coder-trainings`)
        .flush(coderTrainings);

      service.updateCoderTrainingLabel(1, 10, 'Training B').subscribe();
      const updateReq = httpMock.expectOne(`${mockServerUrl}admin/workspace/1/coding/coder-trainings/10/label`);
      expect(updateReq.request.method).toBe('PUT');
      updateReq.flush({});

      service.getCoderTrainings(1).subscribe();
      httpMock
        .expectOne(`${mockServerUrl}admin/workspace/1/coding/coder-trainings`)
        .flush([{ ...coderTrainings[0], label: 'Training B' }]);
    });

    it('should not cache a stale in-flight response after invalidation', () => {
      service.getCoderTrainings(1).subscribe();
      const staleListReq = httpMock.expectOne(`${mockServerUrl}admin/workspace/1/coding/coder-trainings`);

      service.updateCoderTrainingLabel(1, 10, 'Training B').subscribe();
      httpMock
        .expectOne(`${mockServerUrl}admin/workspace/1/coding/coder-trainings/10/label`)
        .flush({});

      staleListReq.flush(coderTrainings);

      service.getCoderTrainings(1).subscribe();
      httpMock
        .expectOne(`${mockServerUrl}admin/workspace/1/coding/coder-trainings`)
        .flush([{ ...coderTrainings[0], label: 'Training B' }]);
    });
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
        missingsProfileId: undefined,
        assignedVariables: undefined,
        assignedVariableBundles: undefined,
        caseOrderingMode: undefined,
        caseSelectionMode: undefined,
        referenceTrainingIds: undefined,
        referenceMode: undefined,
        showScore: undefined,
        allowComments: undefined,
        suppressGeneralInstructions: undefined
      });
      req.flush({});
    });

    it('should include case selection and reference options', () => {
      service.createCoderTrainingJobs(
        1,
        [{ id: 2, name: 'Coder' }],
        [{
          variableId: 'v1',
          unitId: 'u1',
          sampleCount: 3,
          includeDeriveError: true
        }],
        'With Options',
        99,
        [{
          unitName: 'Unit',
          variableId: 'v1',
          sampleCount: 5,
          includeDeriveError: true
        }],
        [{
          id: 7,
          name: 'Bundle',
          caseOrderingMode: 'alternating',
          variables: [{ unitName: 'Unit', variableId: 'v2', includeDeriveError: true }]
        }],
        'alternating',
        'random',
        [10, 11],
        'same',
        true,
        false,
        true
      ).subscribe();

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/1/coding/coder-training-jobs`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({
        trainingLabel: 'With Options',
        selectedCoders: [{ id: 2, name: 'Coder' }],
        variableConfigs: [{
          variableId: 'v1',
          unitId: 'u1',
          sampleCount: 3,
          includeDeriveError: true
        }],
        missingsProfileId: 99,
        assignedVariables: [{
          unitName: 'Unit',
          variableId: 'v1',
          sampleCount: 5,
          includeDeriveError: true
        }],
        assignedVariableBundles: [{
          id: 7,
          name: 'Bundle',
          caseOrderingMode: 'alternating',
          variables: [{ unitName: 'Unit', variableId: 'v2', includeDeriveError: true }]
        }],
        caseOrderingMode: 'alternating',
        caseSelectionMode: 'random',
        referenceTrainingIds: [10, 11],
        referenceMode: 'same',
        showScore: true,
        allowComments: false,
        suppressGeneralInstructions: true
      });
      req.flush({});
    });
  });

  describe('updateCoderTrainingLabel', () => {
    it('should update label', () => {
      service.updateCoderTrainingLabel(1, 10, 'New').subscribe();
      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/1/coding/coder-trainings/10/label`);
      expect(req.request.method).toBe('PUT');
      req.flush({});
    });
  });

  describe('updateCoderTraining', () => {
    it('should include case selection and reference options', () => {
      service.updateCoderTraining(
        1,
        10,
        'Updated',
        [{ id: 3, name: 'Coder 2' }],
        [{ variableId: 'v2', unitId: 'u2', sampleCount: 2 }],
        42,
        undefined,
        undefined,
        'continuous',
        'newest_first',
        [5],
        'different',
        true,
        false,
        true
      ).subscribe();

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/1/coding/coder-trainings/10`);
      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toEqual({
        label: 'Updated',
        selectedCoders: [{ id: 3, name: 'Coder 2' }],
        variableConfigs: [{ variableId: 'v2', unitId: 'u2', sampleCount: 2 }],
        missingsProfileId: 42,
        assignedVariables: undefined,
        assignedVariableBundles: undefined,
        caseOrderingMode: 'continuous',
        caseSelectionMode: 'newest_first',
        referenceTrainingIds: [5],
        referenceMode: 'different',
        showScore: true,
        allowComments: false,
        suppressGeneralInstructions: true
      });
      req.flush({});
    });
  });

  describe('saveDiscussionResult', () => {
    it('should include discussion notes', () => {
      service.saveDiscussionResult(1, 5, 99, 7, 2, 'Replay note').subscribe();

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/1/coding/coder-trainings/5/discussion-result`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({
        responseId: 99,
        code: 7,
        score: 2,
        notes: 'Replay note'
      });
      req.flush({});
    });
  });

  describe('getTrainingComparisonFreshness', () => {
    it('should request the training comparison freshness token', () => {
      service.getTrainingComparisonFreshness(1, 5).subscribe(result => {
        expect(result.version).toBe('v1');
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/1/coding/coder-trainings/5/comparison-freshness`);
      expect(req.request.method).toBe('GET');
      req.flush({
        workspaceId: 1,
        trainingId: 5,
        version: 'v1',
        jobCount: 2,
        unitCount: 4,
        responseCount: 2,
        discussionResultCount: 0,
        latestTrainingChange: null,
        latestJobChange: null,
        latestUnitChange: null,
        latestDiscussionChange: null
      });
    });
  });

  describe('getCachedWithinTrainingCodingResults', () => {
    const freshness = (version: string) => ({
      workspaceId: 1,
      trainingId: 5,
      version,
      jobCount: 2,
      unitCount: 4,
      responseCount: 2,
      discussionResultCount: 0,
      latestTrainingChange: null,
      latestJobChange: null,
      latestUnitChange: null,
      latestDiscussionChange: null
    });

    const comparisonData = [{
      responseId: 1,
      unitName: 'Unit',
      variableId: 'Var',
      personCode: 'P1',
      personLogin: 'login',
      personGroup: 'group',
      bookletName: 'booklet',
      testPerson: 'login (group) - booklet',
      givenAnswer: 'answer',
      replayCode: null,
      replayScore: null,
      discussionCode: null,
      discussionScore: null,
      discussionNotes: null,
      discussionManagerUserId: null,
      discussionManagerName: null,
      discussionSource: null,
      coders: []
    }];
    const comparisonPage = (data = comparisonData) => ({
      data,
      total: data.length,
      page: 1,
      limit: 50,
      totalPages: data.length > 0 ? 1 : 0,
      summary: {
        visibleRows: data.length,
        comparableRows: 0,
        matchingRows: 0,
        matchingPercentage: 0,
        incompleteRows: 0,
        notComparableRows: data.length,
        deviationRows: 0,
        completionRate: 0
      },
      availableCoders: []
    });

    it('should reuse cached comparison data while freshness is unchanged', () => {
      const firstResults: unknown[] = [];
      service.getCachedWithinTrainingCodingResults(1, 5).subscribe(result => firstResults.push(result));

      httpMock.expectOne(`${mockServerUrl}admin/workspace/1/coding/coder-trainings/5/comparison-freshness`)
        .flush(freshness('v1'));
      httpMock.expectOne(`${mockServerUrl}admin/workspace/1/coding/compare-within-training?trainingId=5`)
        .flush(comparisonPage());
      expect(firstResults).toEqual([comparisonPage()]);

      const secondResults: unknown[] = [];
      service.getCachedWithinTrainingCodingResults(1, 5).subscribe(result => secondResults.push(result));

      httpMock.expectOne(`${mockServerUrl}admin/workspace/1/coding/coder-trainings/5/comparison-freshness`)
        .flush(freshness('v1'));
      httpMock.expectNone(`${mockServerUrl}admin/workspace/1/coding/compare-within-training?trainingId=5`);
      expect(secondResults).toEqual([comparisonPage()]);
    });

    it('should reload comparison data when freshness changes', () => {
      service.getCachedWithinTrainingCodingResults(1, 5).subscribe();
      httpMock.expectOne(`${mockServerUrl}admin/workspace/1/coding/coder-trainings/5/comparison-freshness`)
        .flush(freshness('v1'));
      httpMock.expectOne(`${mockServerUrl}admin/workspace/1/coding/compare-within-training?trainingId=5`)
        .flush(comparisonPage());

      const updatedData = [{ ...comparisonData[0], responseId: 2 }];
      const results: unknown[] = [];
      service.getCachedWithinTrainingCodingResults(1, 5).subscribe(result => results.push(result));

      httpMock.expectOne(`${mockServerUrl}admin/workspace/1/coding/coder-trainings/5/comparison-freshness`)
        .flush(freshness('v2'));
      httpMock.expectOne(`${mockServerUrl}admin/workspace/1/coding/compare-within-training?trainingId=5`)
        .flush(comparisonPage(updatedData));
      expect(results).toEqual([comparisonPage(updatedData)]);
    });

    it('should invalidate cached comparison data after saving a discussion result', () => {
      service.getCachedWithinTrainingCodingResults(1, 5).subscribe();
      httpMock.expectOne(`${mockServerUrl}admin/workspace/1/coding/coder-trainings/5/comparison-freshness`)
        .flush(freshness('v1'));
      httpMock.expectOne(`${mockServerUrl}admin/workspace/1/coding/compare-within-training?trainingId=5`)
        .flush(comparisonPage());

      service.saveDiscussionResult(1, 5, 99, 7, 2, 'Replay note').subscribe();
      httpMock.expectOne(`${mockServerUrl}admin/workspace/1/coding/coder-trainings/5/discussion-result`)
        .flush({
          success: true,
          code: 7,
          score: 2,
          notes: 'Replay note',
          source: 'manual',
          managerUserId: 1,
          managerName: 'Manager'
        });

      service.getCachedWithinTrainingCodingResults(1, 5).subscribe();
      httpMock.expectOne(`${mockServerUrl}admin/workspace/1/coding/coder-trainings/5/comparison-freshness`)
        .flush(freshness('v1'));
      httpMock.expectOne(`${mockServerUrl}admin/workspace/1/coding/compare-within-training?trainingId=5`)
        .flush(comparisonPage());
    });
  });

  describe('discussion result apply', () => {
    it('should request an apply preview', () => {
      service.previewApplyDiscussionResults(1, 5, 'manual').subscribe();

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/1/coding/coder-trainings/5/apply-discussion-results-preview`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ source: 'manual' });
      req.flush({});
    });

    it('should apply discussion results with conflict strategies', () => {
      service.applyDiscussionResults(1, 5, {
        source: 'auto_agreement',
        existingResultStrategy: 'overwrite',
        jobConflictStrategy: 'removeFromJobs'
      }).subscribe();

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/1/coding/coder-trainings/5/apply-discussion-results`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({
        source: 'auto_agreement',
        existingResultStrategy: 'overwrite',
        jobConflictStrategy: 'removeFromJobs'
      });
      req.flush({});
    });
  });
});
