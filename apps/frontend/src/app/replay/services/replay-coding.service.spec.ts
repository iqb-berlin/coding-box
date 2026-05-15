import { TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of, throwError } from 'rxjs';
import { CodingJobBackendService } from '../../coding/services/coding-job-backend.service';
import { ReplayCodingService } from './replay-coding.service';
import { CodingJob } from '../../coding/models/coding-job.model';

describe('ReplayCodingService', () => {
  let service: ReplayCodingService;
  let codingJobBackendServiceMock: jest.Mocked<CodingJobBackendService>;
  let translateServiceMock: jest.Mocked<TranslateService>;
  let snackBarMock: jest.Mocked<MatSnackBar>;

  beforeEach(() => {
    codingJobBackendServiceMock = {
      updateCodingJob: jest.fn(),
      getCodingProgress: jest.fn(),
      getCodingNotes: jest.fn(),
      getCodingJob: jest.fn(),
      saveCodingProgress: jest.fn(),
      saveCodingNotes: jest.fn()
    } as unknown as jest.Mocked<CodingJobBackendService>;

    translateServiceMock = {
      instant: jest.fn().mockReturnValue('translated')
    } as unknown as jest.Mocked<TranslateService>;

    snackBarMock = {
      open: jest.fn()
    } as unknown as jest.Mocked<MatSnackBar>;

    TestBed.configureTestingModule({
      providers: [
        ReplayCodingService,
        { provide: CodingJobBackendService, useValue: codingJobBackendServiceMock },
        { provide: TranslateService, useValue: translateServiceMock },
        { provide: MatSnackBar, useValue: snackBarMock }
      ]
    });

    service = TestBed.inject(ReplayCodingService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('updateCodingJobStatus', () => {
    it('should update status via backend', async () => {
      codingJobBackendServiceMock.updateCodingJob.mockReturnValue(of({} as CodingJob));
      await service.updateCodingJobStatus(1, 100, 'active');
      expect(codingJobBackendServiceMock.updateCodingJob).toHaveBeenCalledWith(1, 100, { status: 'active' });
    });

    it('should pass the replay auth token to backend status updates', async () => {
      codingJobBackendServiceMock.updateCodingJob.mockReturnValue(of({} as CodingJob));
      service.setAuthToken('replay-token');

      await service.updateCodingJobStatus(1, 100, 'active');

      expect(codingJobBackendServiceMock.updateCodingJob).toHaveBeenCalledWith(
        1,
        100,
        { status: 'active' },
        'replay-token'
      );
    });
  });

  describe('loadSavedCodingProgress', () => {
    it('should load progress, notes, and job details', async () => {
      const mockProgress = { k1: { id: 1, label: 'L' } };
      const mockNotes = { k1: 'Note' };
      const mockJob = { comment: 'Comm', showScore: true };

      codingJobBackendServiceMock.getCodingProgress.mockReturnValue(of(mockProgress));
      codingJobBackendServiceMock.getCodingNotes.mockReturnValue(of(mockNotes));
      codingJobBackendServiceMock.getCodingJob.mockReturnValue(of(mockJob as CodingJob));

      await service.loadSavedCodingProgress(1, 100);

      expect(service.selectedCodes.size).toBe(1);
      expect(service.notes.get('k1')).toBe('Note');
      expect(service.codingJobComment).toBe('Comm');
      expect(service.showScore).toBe(true);
    });

    it('should pass the replay auth token while loading progress, notes, and job details', async () => {
      codingJobBackendServiceMock.getCodingProgress.mockReturnValue(of({}));
      codingJobBackendServiceMock.getCodingNotes.mockReturnValue(of({}));
      codingJobBackendServiceMock.getCodingJob.mockReturnValue(of({} as CodingJob));
      service.setAuthToken('replay-token');

      await service.loadSavedCodingProgress(1, 100);

      expect(codingJobBackendServiceMock.getCodingProgress).toHaveBeenCalledWith(1, 100, 'replay-token');
      expect(codingJobBackendServiceMock.getCodingNotes).toHaveBeenCalledWith(1, 100, 'replay-token');
      expect(codingJobBackendServiceMock.getCodingJob).toHaveBeenCalledWith(1, 100, 'replay-token');
    });

    it('should handle errors gracefully', async () => {
      codingJobBackendServiceMock.getCodingProgress.mockReturnValue(of({}));
      await service.loadSavedCodingProgress(1, 100);
      expect(service.selectedCodes.size).toBe(0);
    });
  });

  describe('saveCodingProgress', () => {
    it('should save progress via backend', async () => {
      codingJobBackendServiceMock.saveCodingProgress.mockReturnValue(of({} as CodingJob));
      await service.saveCodingProgress(1, 100, 'p1', 'u1', 'v1', { id: 1, label: 'l' });
      expect(codingJobBackendServiceMock.saveCodingProgress).toHaveBeenCalled();
    });

    it('should pass the replay auth token when saving progress', async () => {
      codingJobBackendServiceMock.saveCodingProgress.mockReturnValue(of({} as CodingJob));
      service.setAuthToken('replay-token');

      await service.saveCodingProgress(1, 100, 'p1', 'u1', 'v1', { id: 1, label: 'l' });

      expect(codingJobBackendServiceMock.saveCodingProgress).toHaveBeenCalledWith(
        1,
        100,
        {
          testPerson: 'p1',
          unitId: 'u1',
          variableId: 'v1',
          selectedCode: {
            id: 1,
            code: '',
            label: 'l',
            score: null,
            codingIssueOption: null
          }
        },
        'replay-token'
      );
    });

    it('keeps save errors until the failed coding case saves successfully', async () => {
      codingJobBackendServiceMock.saveCodingProgress
        .mockReturnValueOnce(throwError(() => new Error('save failed')))
        .mockReturnValueOnce(of({} as CodingJob))
        .mockReturnValueOnce(of({} as CodingJob));

      await expect(service.saveCodingProgress(1, 100, 'p1', 'u1', 'v1', { id: 1, label: 'l' }))
        .rejects.toThrow('save failed');
      expect(service.hasSaveError).toBe(true);

      await service.saveCodingProgress(1, 100, 'p1', 'u2', 'v1', { id: 2, label: 'm' });
      expect(service.hasSaveError).toBe(true);

      await service.saveCodingProgress(1, 100, 'p1', 'u1', 'v1', { id: 1, label: 'l' });
      expect(service.hasSaveError).toBe(false);
    });
  });

  describe('resetCodingData', () => {
    it('clears transient coding job state', () => {
      service.isCodingJobPaused = true;
      service.isResumingJob = true;
      service.isCodingJobFinalized = true;
      service.isCompletedJobReview = true;
      service.hasSaveError = true;
      service.lastSaveError = 'failed';
      service.showScore = true;
      service.allowComments = false;
      service.suppressGeneralInstructions = true;

      service.resetCodingData();

      expect(service.isCodingJobPaused).toBe(false);
      expect(service.isResumingJob).toBe(false);
      expect(service.isCodingJobFinalized).toBe(false);
      expect(service.isCompletedJobReview).toBe(false);
      expect(service.hasSaveError).toBe(false);
      expect(service.lastSaveError).toBeNull();
      expect(service.showScore).toBe(false);
      expect(service.allowComments).toBe(true);
      expect(service.suppressGeneralInstructions).toBe(false);
    });
  });

  describe('pauseCodingJob', () => {
    it('does not pause completed review jobs', async () => {
      service.isCompletedJobReview = true;

      await service.pauseCodingJob(1, 100);

      expect(codingJobBackendServiceMock.updateCodingJob).not.toHaveBeenCalled();
    });
  });

  describe('generateCompositeKey', () => {
    it('keeps the group segment and uses the booklet segment for grouped test persons', () => {
      expect(service.generateCompositeKey('login@code@group@booklet', 'UNIT', 'VAR')).toBe(
        'login@code@group@booklet::booklet::UNIT::VAR'
      );
    });

    it('normalizes empty group segments to the ungrouped backend key format', () => {
      expect(service.generateCompositeKey('login@code@@booklet', 'UNIT', 'VAR')).toBe(
        'login@code@booklet::booklet::UNIT::VAR'
      );
    });
  });

  describe('saveNotes', () => {
    it('saves notes without sending a dummy selected code', async () => {
      codingJobBackendServiceMock.saveCodingNotes.mockReturnValue(of({} as CodingJob));
      service.codingJobId = 100;

      await service.saveNotes(1, 'login@code@group@booklet', 'UNIT', 'VAR', 'note');

      expect(codingJobBackendServiceMock.saveCodingNotes).toHaveBeenCalledWith(
        1,
        100,
        {
          testPerson: 'login@code@group@booklet',
          unitId: 'UNIT',
          variableId: 'VAR',
          notes: 'note'
        }
      );
      expect(codingJobBackendServiceMock.saveCodingProgress).not.toHaveBeenCalled();
    });
  });
});
