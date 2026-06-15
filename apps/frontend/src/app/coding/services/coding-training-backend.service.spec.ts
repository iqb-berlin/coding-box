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
