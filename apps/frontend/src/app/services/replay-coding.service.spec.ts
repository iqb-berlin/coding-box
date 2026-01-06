import { TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of } from 'rxjs';
import { BackendService } from './backend.service';
import { ReplayCodingService } from './replay-coding.service';
import { CodingJob } from '../coding/models/coding-job.model';

describe('ReplayCodingService', () => {
  let service: ReplayCodingService;
  let backendServiceMock: jest.Mocked<BackendService>;
  let translateServiceMock: jest.Mocked<TranslateService>;
  let snackBarMock: jest.Mocked<MatSnackBar>;

  beforeEach(() => {
    backendServiceMock = {
      updateCodingJob: jest.fn(),
      getCodingProgress: jest.fn(),
      getCodingNotes: jest.fn(),
      getCodingJob: jest.fn(),
      saveCodingProgress: jest.fn()
    } as unknown as jest.Mocked<BackendService>;

    translateServiceMock = {
      instant: jest.fn().mockReturnValue('translated')
    } as unknown as jest.Mocked<TranslateService>;

    snackBarMock = {
      open: jest.fn()
    } as unknown as jest.Mocked<MatSnackBar>;

    TestBed.configureTestingModule({
      providers: [
        ReplayCodingService,
        { provide: BackendService, useValue: backendServiceMock },
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
      backendServiceMock.updateCodingJob.mockReturnValue(of({} as CodingJob));
      await service.updateCodingJobStatus(1, 100, 'active');
      expect(backendServiceMock.updateCodingJob).toHaveBeenCalledWith(1, 100, { status: 'active' });
    });
  });

  describe('loadSavedCodingProgress', () => {
    it('should load progress, notes, and job details', async () => {
      const mockProgress = { k1: { id: 1, label: 'L' } };
      const mockNotes = { k1: 'Note' };
      const mockJob = { comment: 'Comm', showScore: true };

      backendServiceMock.getCodingProgress.mockReturnValue(of(mockProgress));
      backendServiceMock.getCodingNotes.mockReturnValue(of(mockNotes));
      backendServiceMock.getCodingJob.mockReturnValue(of(mockJob as CodingJob));

      await service.loadSavedCodingProgress(1, 100);

      expect(service.selectedCodes.size).toBe(1);
      expect(service.notes.get('k1')).toBe('Note');
      expect(service.codingJobComment).toBe('Comm');
      expect(service.showScore).toBe(true);
    });

    it('should handle errors gracefully', async () => {
      backendServiceMock.getCodingProgress.mockReturnValue(of({}));
      await service.loadSavedCodingProgress(1, 100);
      expect(service.selectedCodes.size).toBe(0);
    });
  });

  describe('saveCodingProgress', () => {
    it('should save progress via backend', async () => {
      backendServiceMock.saveCodingProgress.mockReturnValue(of({} as CodingJob));
      await service.saveCodingProgress(1, 100, 'p1', 'u1', 'v1', { id: 1, label: 'l' });
      expect(backendServiceMock.saveCodingProgress).toHaveBeenCalled();
    });
  });
});
