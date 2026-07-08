import { TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of, Subject, throwError } from 'rxjs';
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
      pauseCodingJob: jest.fn(),
      resumeCodingJob: jest.fn(),
      submitCodingJob: jest.fn(),
      getCodingProgress: jest.fn(),
      getCodingNotes: jest.fn(),
      getCodingJob: jest.fn(),
      saveCodingProgress: jest.fn(),
      saveCodingNotes: jest.fn(),
      updateCodingJobKeepalive: jest.fn(),
      pauseCodingJobKeepalive: jest.fn()
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
    it('should resume active status via dedicated backend endpoint', async () => {
      codingJobBackendServiceMock.resumeCodingJob.mockReturnValue(of({} as CodingJob));
      await service.updateCodingJobStatus(1, 100, 'active');
      expect(codingJobBackendServiceMock.resumeCodingJob).toHaveBeenCalledWith(1, 100);
    });

    it('should pass the replay auth token to backend status updates', async () => {
      codingJobBackendServiceMock.resumeCodingJob.mockReturnValue(of({} as CodingJob));
      service.setAuthToken('replay-token');

      await service.updateCodingJobStatus(1, 100, 'active');

      expect(codingJobBackendServiceMock.resumeCodingJob).toHaveBeenCalledWith(
        1,
        100,
        'replay-token'
      );
    });

    it('should pause and submit via dedicated backend endpoints', async () => {
      codingJobBackendServiceMock.pauseCodingJob.mockReturnValue(of({} as CodingJob));
      codingJobBackendServiceMock.submitCodingJob.mockReturnValue(of({} as CodingJob));

      await service.updateCodingJobStatus(1, 100, 'paused');
      await service.updateCodingJobStatus(1, 100, 'completed');

      expect(codingJobBackendServiceMock.pauseCodingJob).toHaveBeenCalledWith(1, 100);
      expect(codingJobBackendServiceMock.submitCodingJob).toHaveBeenCalledWith(1, 100);
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

    it('preserves coding issue options on regular codes loaded from saved progress', async () => {
      service.currentVariableId = 'VAR1';
      service.codingScheme = {
        id: 'scheme-1',
        label: 'Scheme',
        variableCodings: [
          {
            id: 'VAR1',
            alias: 'VAR1',
            sourceType: 'manual',
            codes: [
              {
                id: 7,
                code: '7',
                label: 'Regular',
                score: 1,
                type: 'manual'
              }
            ]
          }
        ]
      } as never;
      const key = service.generateCompositeKey('p1', 'u1', 'VAR1');

      codingJobBackendServiceMock.getCodingProgress.mockReturnValue(of({
        [key]: {
          id: 7,
          code: '7',
          label: 'Regular',
          score: 1,
          codingIssueOption: -1
        }
      }));
      codingJobBackendServiceMock.getCodingNotes.mockReturnValue(of({}));
      codingJobBackendServiceMock.getCodingJob.mockReturnValue(of({} as CodingJob));

      await service.loadSavedCodingProgress(1, 100);

      expect(service.selectedCodes.get(key)).toEqual({
        id: 7,
        code: '7',
        label: 'Regular',
        score: 1,
        codingIssueOption: -1
      });
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

    it('marks progress saves as issue reviews in coding issue review mode', async () => {
      codingJobBackendServiceMock.saveCodingProgress.mockReturnValue(of({} as CodingJob));
      service.isCodingIssueReviewMode = true;

      await service.saveCodingProgress(1, 100, 'p1', 'u1', 'v1', { id: 1, label: 'l' });

      expect(codingJobBackendServiceMock.saveCodingProgress).toHaveBeenCalledWith(
        1,
        100,
        expect.objectContaining({
          issueReview: true
        })
      );
    });

    it('includes locally edited notes when saving coding issue review progress', async () => {
      codingJobBackendServiceMock.saveCodingProgress.mockReturnValue(of({} as CodingJob));
      service.isCodingIssueReviewMode = true;
      const key = service.generateCompositeKey('p1', 'u1', 'v1');
      service.notes.set(key, ' manager note ');

      await service.saveCodingProgress(1, 100, 'p1', 'u1', 'v1', { id: 1, label: 'l' });

      expect(codingJobBackendServiceMock.saveCodingProgress).toHaveBeenCalledWith(
        1,
        100,
        expect.objectContaining({
          issueReview: true,
          notes: 'manager note'
        })
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

    it('persists clearing a selected code with null selectedCode', async () => {
      codingJobBackendServiceMock.saveCodingProgress.mockReturnValue(of({} as CodingJob));

      await service.saveCodingProgress(1, 100, 'p1', 'u1', 'v1', null);

      expect(codingJobBackendServiceMock.saveCodingProgress).toHaveBeenCalledWith(
        1,
        100,
        {
          testPerson: 'p1',
          unitId: 'u1',
          variableId: 'v1',
          selectedCode: null
        }
      );
    });

    it('uses the token captured before a queued progress save runs after switching jobs', async () => {
      const subjects: Subject<CodingJob>[] = [];
      codingJobBackendServiceMock.saveCodingProgress.mockImplementation(() => {
        const subject = new Subject<CodingJob>();
        subjects.push(subject);
        return subject.asObservable();
      });
      service.codingJobId = 100;
      service.setAuthToken('old-token');

      const firstSave = service.saveCodingProgress(1, 100, 'p1', 'u1', 'v1', { id: 1, label: 'one' });
      await Promise.resolve();
      expect(subjects).toHaveLength(1);

      const secondSave = service.saveCodingProgress(1, 100, 'p1', 'u1', 'v1', { id: 2, label: 'two' });
      service.resetCodingData();
      service.codingJobId = 200;
      service.setAuthToken('new-token');

      subjects[0].next({} as CodingJob);
      subjects[0].complete();
      await firstSave;
      await Promise.resolve();

      expect(subjects).toHaveLength(2);
      expect(codingJobBackendServiceMock.saveCodingProgress).toHaveBeenNthCalledWith(
        2,
        1,
        100,
        {
          testPerson: 'p1',
          unitId: 'u1',
          variableId: 'v1',
          selectedCode: {
            id: 2,
            code: '',
            label: 'two',
            score: null,
            codingIssueOption: null
          }
        },
        'old-token'
      );

      subjects[1].next({} as CodingJob);
      subjects[1].complete();
      await secondSave;
    });

    it('does not keep a save error from a stale queued progress save after switching jobs', async () => {
      const firstSubject = new Subject<CodingJob>();
      codingJobBackendServiceMock.saveCodingProgress
        .mockReturnValueOnce(firstSubject.asObservable())
        .mockReturnValueOnce(throwError(() => new Error('old save failed')));
      service.codingJobId = 100;
      service.setAuthToken('old-token');

      const firstSave = service.saveCodingProgress(1, 100, 'p1', 'u1', 'v1', { id: 1, label: 'one' });
      await Promise.resolve();
      const secondSave = service.saveCodingProgress(1, 100, 'p1', 'u1', 'v1', { id: 2, label: 'two' });
      service.resetCodingData();
      service.codingJobId = 200;
      service.setAuthToken('new-token');

      firstSubject.next({} as CodingJob);
      firstSubject.complete();
      await firstSave;
      await Promise.resolve();

      await expect(secondSave).rejects.toThrow('old save failed');
      expect(service.hasSaveError).toBe(false);
      expect(service.lastSaveError).toBeNull();
      expect(snackBarMock.open).not.toHaveBeenCalled();
    });

    it('waits for pending row mutations before resolving a flush', async () => {
      const pendingSave = new Subject<CodingJob>();
      codingJobBackendServiceMock.saveCodingProgress.mockReturnValueOnce(pendingSave.asObservable());
      service.codingJobId = 100;

      const savePromise = service.saveCodingProgress(1, 100, 'p1', 'u1', 'v1', { id: 1, label: 'one' });
      await Promise.resolve();
      let didFlush = false;
      const flushPromise = service.flushPendingRowMutations().then(() => {
        didFlush = true;
      });

      await Promise.resolve();
      expect(didFlush).toBe(false);

      pendingSave.next({} as CodingJob);
      pendingSave.complete();
      await savePromise;
      await flushPromise;

      expect(didFlush).toBe(true);
    });

    it('rejects a flush when a pending row mutation fails', async () => {
      const pendingSave = new Subject<CodingJob>();
      codingJobBackendServiceMock.saveCodingProgress.mockReturnValueOnce(pendingSave.asObservable());
      service.codingJobId = 100;

      const savePromise = service.saveCodingProgress(1, 100, 'p1', 'u1', 'v1', { id: 1, label: 'one' });
      await Promise.resolve();
      const flushPromise = service.flushPendingRowMutations();

      pendingSave.error(new Error('pending save failed'));

      await expect(savePromise).rejects.toThrow('pending save failed');
      await expect(flushPromise).rejects.toThrow('pending save failed');
      expect(service.hasSaveError).toBe(true);
    });
  });

  describe('findCodeById', () => {
    it('prefers variable aliases over colliding technical ids', () => {
      service.currentVariableId = '04';
      service.codingScheme = {
        version: '1.0',
        variableCodings: [
          {
            id: '04',
            alias: '02',
            codes: [{ id: 2, label: 'Code for visible 02', score: 2 }]
          },
          {
            id: '07',
            alias: '04',
            codes: [{ id: 4, label: 'Code for visible 04', score: 4 }]
          }
        ]
      } as never;

      expect(service.findCodeById(4)).toEqual(
        expect.objectContaining({ label: 'Code for visible 04' })
      );
      expect(service.findCodeById(2)).toBeNull();
    });
  });

  describe('handleCodeSelected', () => {
    it('persists deselection before clearing local progress', async () => {
      codingJobBackendServiceMock.saveCodingProgress.mockReturnValue(of({} as CodingJob));
      service.codingJobId = 100;
      const key = service.generateCompositeKey('p1', 'u1', 'v1');
      service.selectedCodes.set(key, { id: 1, label: 'l' });

      await service.handleCodeSelected(
        { variableId: 'v1', code: null, codingIssueOption: null },
        'p1',
        'u1',
        1,
        null
      );

      expect(codingJobBackendServiceMock.saveCodingProgress).toHaveBeenCalledWith(
        1,
        100,
        {
          testPerson: 'p1',
          unitId: 'u1',
          variableId: 'v1',
          selectedCode: null
        }
      );
      expect(service.selectedCodes.has(key)).toBe(false);
    });

    it('keeps the latest local selection when queued saves complete in order', async () => {
      const subjects: Subject<CodingJob>[] = [];
      codingJobBackendServiceMock.saveCodingProgress.mockImplementation(() => {
        const subject = new Subject<CodingJob>();
        subjects.push(subject);
        return subject.asObservable();
      });
      service.codingJobId = 100;

      const first = service.handleCodeSelected(
        { variableId: 'v1', code: { id: 1, label: 'one', score: 1 } as never },
        'p1',
        'u1',
        1,
        null
      );
      const second = service.handleCodeSelected(
        { variableId: 'v1', code: { id: 2, label: 'two', score: 2 } as never },
        'p1',
        'u1',
        1,
        null
      );

      await Promise.resolve();
      expect(subjects.length).toBe(1);
      subjects[0].next({} as CodingJob);
      subjects[0].complete();
      await expect(first).resolves.toBeNull();
      await Promise.resolve();
      expect(service.selectedCodes.size).toBe(0);
      await Promise.resolve();
      expect(subjects.length).toBe(2);

      subjects[1].next({} as CodingJob);
      subjects[1].complete();
      await expect(second).resolves.toMatchObject({ id: 2 });

      const key = service.generateCompositeKey('p1', 'u1', 'v1');
      expect(service.selectedCodes.get(key)?.id).toBe(2);
    });

    it('does not apply a stale queued local selection after switching jobs', async () => {
      const subjects: Subject<CodingJob>[] = [];
      codingJobBackendServiceMock.saveCodingProgress.mockImplementation(() => {
        const subject = new Subject<CodingJob>();
        subjects.push(subject);
        return subject.asObservable();
      });
      service.codingJobId = 100;
      service.setAuthToken('old-token');

      const first = service.handleCodeSelected(
        { variableId: 'v1', code: { id: 1, label: 'one', score: 1 } as never },
        'p1',
        'u1',
        1,
        null
      );
      await Promise.resolve();
      expect(subjects).toHaveLength(1);

      const second = service.handleCodeSelected(
        { variableId: 'v1', code: { id: 2, label: 'two', score: 2 } as never },
        'p1',
        'u1',
        1,
        null
      );
      service.resetCodingData();
      service.codingJobId = 200;
      service.setAuthToken('new-token');
      const key = service.generateCompositeKey('p1', 'u1', 'v1');
      service.selectedCodes.set(key, { id: 9, label: 'new job selection' });

      subjects[0].next({} as CodingJob);
      subjects[0].complete();
      await expect(first).resolves.toBeNull();
      await Promise.resolve();

      expect(subjects).toHaveLength(2);
      expect(codingJobBackendServiceMock.saveCodingProgress).toHaveBeenNthCalledWith(
        2,
        1,
        100,
        {
          testPerson: 'p1',
          unitId: 'u1',
          variableId: 'v1',
          selectedCode: {
            id: 2,
            code: '2',
            label: 'two',
            score: 2,
            codingIssueOption: null
          }
        },
        'old-token'
      );

      subjects[1].next({} as CodingJob);
      subjects[1].complete();
      await expect(second).resolves.toBeNull();
      expect(service.selectedCodes.get(key)?.id).toBe(9);
    });

    it('keeps new-code-needed without notes local and incomplete without persisting it', async () => {
      codingJobBackendServiceMock.saveCodingProgress.mockReturnValue(of({} as CodingJob));
      service.codingJobId = 100;
      const unitsData = {
        id: 1,
        name: 'job',
        currentUnitIndex: 0,
        units: [
          {
            id: 1,
            name: 'u1',
            alias: 'u1',
            bookletId: 0,
            testPerson: 'p1',
            variableId: 'v1'
          }
        ]
      };
      const key = service.generateCompositeKey('p1', 'u1', 'v1');
      service.openUnitKeys.add(key);

      await service.handleCodeSelected(
        {
          variableId: 'v1',
          code: null,
          codingIssueOption: {
            id: 'uncertain--2',
            label: 'New code needed',
            description: '',
            code: -2
          }
        },
        'p1',
        'u1',
        1,
        unitsData
      );

      expect(codingJobBackendServiceMock.saveCodingProgress).not.toHaveBeenCalled();
      expect(service.selectedCodes.get(key)?.id).toBe(-2);
      expect(service.openUnitKeys.has(key)).toBe(false);
      expect(service.getCompletedCount(unitsData)).toBe(0);
      expect(service.isCodingJobCompleted).toBe(false);
    });

    it('does not clear persisted regular progress when new-code-needed is selected without notes', async () => {
      codingJobBackendServiceMock.saveCodingProgress.mockReturnValue(of({} as CodingJob));
      service.codingJobId = 100;
      const key = service.generateCompositeKey('p1', 'u1', 'v1');
      service.selectedCodes.set(key, {
        id: 7,
        code: '7',
        label: 'Regular',
        score: 1
      });

      await service.handleCodeSelected(
        {
          variableId: 'v1',
          code: { id: 7, label: 'Regular', score: 1 } as never,
          codingIssueOption: {
            id: 'uncertain--2',
            label: 'New code needed',
            description: '',
            code: -2
          }
        },
        'p1',
        'u1',
        1,
        null
      );

      expect(codingJobBackendServiceMock.saveCodingProgress).not.toHaveBeenCalled();
      expect(service.selectedCodes.get(key)).toMatchObject({
        id: 7,
        code: '7',
        label: 'Regular',
        score: 1,
        codingIssueOption: -2
      });
    });
  });

  describe('resetCodingData', () => {
    it('clears transient coding job state', () => {
      service.isCodingJobPaused = true;
      service.isResumingJob = true;
      service.isCodingJobFinalized = true;
      service.isCompletedJobReview = true;
      service.isReviewMode = true;
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
      expect(service.isReviewMode).toBe(false);
      expect(service.hasSaveError).toBe(false);
      expect(service.lastSaveError).toBeNull();
      expect(service.showScore).toBe(false);
      expect(service.allowComments).toBe(true);
      expect(service.suppressGeneralInstructions).toBe(false);
    });
  });

  describe('setCodingJobMetadata', () => {
    it('keeps completed jobs editable and review jobs read-only', () => {
      service.setCodingJobMetadata({ status: 'completed' });

      expect(service.isCompletedJobReview).toBe(false);
      expect(service.isCodingJobFinalized).toBe(false);

      service.setCodingJobMetadata({ status: 'review' });

      expect(service.isCompletedJobReview).toBe(true);
      expect(service.isCodingJobFinalized).toBe(false);
    });
  });

  describe('pauseCodingJob', () => {
    it('does not pause completed review jobs', async () => {
      service.isCompletedJobReview = true;

      await service.pauseCodingJob(1, 100);

      expect(codingJobBackendServiceMock.updateCodingJob).not.toHaveBeenCalled();
    });

    it('uses keepalive status update for unload pauses', () => {
      service.setAuthToken('replay-token');

      service.pauseCodingJobOnUnload(1, 100);

      expect(codingJobBackendServiceMock.pauseCodingJobKeepalive).toHaveBeenCalledWith(
        1,
        100,
        'replay-token'
      );
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

    it('keeps decision replay notes locally when there is no coding job', async () => {
      await service.saveNotes(1, 'login@code@group@booklet', 'UNIT', 'VAR', 'note');

      expect(service.getNotes('login@code@group@booklet', 'UNIT', 'VAR')).toBe('note');
      expect(codingJobBackendServiceMock.saveCodingNotes).not.toHaveBeenCalled();

      await service.saveNotes(1, 'login@code@group@booklet', 'UNIT', 'VAR', '   ');

      expect(service.getNotes('login@code@group@booklet', 'UNIT', 'VAR')).toBe('');
      expect(codingJobBackendServiceMock.saveCodingNotes).not.toHaveBeenCalled();
    });

    it('marks note saves as issue reviews in coding issue review mode', async () => {
      codingJobBackendServiceMock.saveCodingNotes.mockReturnValue(of({} as CodingJob));
      service.codingJobId = 100;
      service.isCodingIssueReviewMode = true;

      await service.saveNotes(1, 'login@code@group@booklet', 'UNIT', 'VAR', 'note');

      expect(codingJobBackendServiceMock.saveCodingNotes).toHaveBeenCalledWith(
        1,
        100,
        expect.objectContaining({
          issueReview: true
        })
      );
    });

    it('uses the job id and token captured before a queued note save runs after switching jobs', async () => {
      const subjects: Subject<CodingJob>[] = [];
      codingJobBackendServiceMock.saveCodingNotes.mockImplementation(() => {
        const subject = new Subject<CodingJob>();
        subjects.push(subject);
        return subject.asObservable();
      });
      service.codingJobId = 100;
      service.setAuthToken('old-token');

      const firstSave = service.saveNotes(1, 'p1', 'u1', 'v1', 'first');
      await Promise.resolve();
      expect(subjects).toHaveLength(1);

      const secondSave = service.saveNotes(1, 'p1', 'u1', 'v1', 'second');
      service.resetCodingData();
      service.codingJobId = 200;
      service.setAuthToken('new-token');

      subjects[0].next({} as CodingJob);
      subjects[0].complete();
      await firstSave;
      await Promise.resolve();

      expect(subjects).toHaveLength(2);
      expect(codingJobBackendServiceMock.saveCodingNotes).toHaveBeenNthCalledWith(
        2,
        1,
        100,
        {
          testPerson: 'p1',
          unitId: 'u1',
          variableId: 'v1',
          notes: 'second'
        },
        'old-token'
      );

      subjects[1].next({} as CodingJob);
      subjects[1].complete();
      await secondSave;

      const noteKey = service.generateCompositeKey('p1', 'u1', 'v1');
      expect(service.notes.has(noteKey)).toBe(false);
    });

    it('keeps note save errors until the failed note saves successfully', async () => {
      codingJobBackendServiceMock.saveCodingNotes
        .mockReturnValueOnce(throwError(() => new Error('note save failed')))
        .mockReturnValueOnce(of({} as CodingJob));
      codingJobBackendServiceMock.saveCodingProgress.mockReturnValue(of({} as CodingJob));
      service.codingJobId = 100;

      await expect(service.saveNotes(1, 'p1', 'u1', 'v1', 'first'))
        .rejects.toThrow('note save failed');

      expect(service.hasSaveError).toBe(true);
      expect(service.lastSaveError).toBe('translated');
      expect(snackBarMock.open).toHaveBeenCalledWith(
        'translated',
        'translated',
        {
          duration: 5000,
          panelClass: ['snackbar-error']
        }
      );

      await service.saveCodingProgress(1, 100, 'p1', 'u1', 'v1', { id: 1, label: 'l' });
      expect(service.hasSaveError).toBe(true);

      await service.saveNotes(1, 'p1', 'u1', 'v1', 'second');

      expect(service.hasSaveError).toBe(false);
      expect(service.lastSaveError).toBeNull();
    });

    it('persists deferred new-code-needed progress after notes are added', async () => {
      codingJobBackendServiceMock.saveCodingNotes.mockReturnValue(of({} as CodingJob));
      codingJobBackendServiceMock.saveCodingProgress.mockReturnValue(of({} as CodingJob));
      service.codingJobId = 100;
      const key = service.generateCompositeKey('p1', 'u1', 'v1');
      service.selectedCodes.set(key, {
        id: -2,
        code: '-2',
        label: 'New code needed',
        codingIssueOption: -2
      });
      service.openUnitKeys.add(key);
      const unitsData = {
        id: 1,
        name: 'job',
        currentUnitIndex: 0,
        units: [
          {
            id: 1,
            name: 'u1',
            alias: 'u1',
            bookletId: 0,
            testPerson: 'p1',
            variableId: 'v1'
          }
        ]
      };

      await service.saveNotes(1, 'p1', 'u1', 'v1', 'needs a new code', unitsData);

      expect(codingJobBackendServiceMock.saveCodingProgress).toHaveBeenCalledWith(
        1,
        100,
        {
          testPerson: 'p1',
          unitId: 'u1',
          variableId: 'v1',
          selectedCode: {
            id: -2,
            code: '-2',
            label: 'New code needed',
            score: null,
            codingIssueOption: -2
          }
        }
      );
      expect(service.openUnitKeys.has(key)).toBe(false);
      expect(service.isCodingJobCompleted).toBe(true);
    });

    it('does not let deferred new-code-needed note sync overwrite newer selections', async () => {
      const noteSubject = new Subject<CodingJob>();
      const progressSubjects: Subject<CodingJob>[] = [];
      codingJobBackendServiceMock.saveCodingNotes.mockReturnValue(noteSubject.asObservable());
      codingJobBackendServiceMock.saveCodingProgress.mockImplementation(() => {
        const subject = new Subject<CodingJob>();
        progressSubjects.push(subject);
        return subject.asObservable();
      });
      service.codingJobId = 100;
      const key = service.generateCompositeKey('p1', 'u1', 'v1');
      service.selectedCodes.set(key, {
        id: -2,
        code: '-2',
        label: 'New code needed',
        codingIssueOption: -2
      });

      const noteSave = service.saveNotes(1, 'p1', 'u1', 'v1', 'needs a new code');
      await Promise.resolve();
      expect(codingJobBackendServiceMock.saveCodingNotes).toHaveBeenCalledTimes(1);

      const regularSave = service.handleCodeSelected(
        {
          variableId: 'v1',
          code: { id: 7, label: 'Regular', score: 1 } as never,
          codingIssueOption: null
        },
        'p1',
        'u1',
        1,
        null
      );
      await Promise.resolve();
      expect(codingJobBackendServiceMock.saveCodingProgress).not.toHaveBeenCalled();

      noteSubject.next({} as CodingJob);
      noteSubject.complete();
      await noteSave;
      await Promise.resolve();
      await Promise.resolve();

      expect(codingJobBackendServiceMock.saveCodingProgress).toHaveBeenCalledTimes(1);
      expect(codingJobBackendServiceMock.saveCodingProgress).toHaveBeenCalledWith(
        1,
        100,
        {
          testPerson: 'p1',
          unitId: 'u1',
          variableId: 'v1',
          selectedCode: {
            id: 7,
            code: '7',
            label: 'Regular',
            score: 1,
            codingIssueOption: null
          }
        }
      );

      progressSubjects[0].next({} as CodingJob);
      progressSubjects[0].complete();
      await regularSave;
      expect(service.selectedCodes.get(key)?.id).toBe(7);
    });

    it('persists latest new-code-needed selection when it is chosen during a note save', async () => {
      const noteSubject = new Subject<CodingJob>();
      const progressSubjects: Subject<CodingJob>[] = [];
      codingJobBackendServiceMock.saveCodingNotes.mockReturnValue(noteSubject.asObservable());
      codingJobBackendServiceMock.saveCodingProgress.mockImplementation(() => {
        const subject = new Subject<CodingJob>();
        progressSubjects.push(subject);
        return subject.asObservable();
      });
      service.codingJobId = 100;
      const key = service.generateCompositeKey('p1', 'u1', 'v1');

      const noteSave = service.saveNotes(1, 'p1', 'u1', 'v1', 'needs a new code');
      const newCodeNeededSelection = service.handleCodeSelected(
        {
          variableId: 'v1',
          code: null,
          codingIssueOption: {
            id: 'uncertain--2',
            label: 'New code needed',
            description: '',
            code: -2
          }
        },
        'p1',
        'u1',
        1,
        null
      );
      await newCodeNeededSelection;
      await Promise.resolve();
      expect(codingJobBackendServiceMock.saveCodingNotes).toHaveBeenCalledTimes(1);
      expect(codingJobBackendServiceMock.saveCodingProgress).not.toHaveBeenCalled();

      noteSubject.next({} as CodingJob);
      noteSubject.complete();
      await Promise.resolve();
      await Promise.resolve();

      expect(codingJobBackendServiceMock.saveCodingProgress).toHaveBeenCalledWith(
        1,
        100,
        {
          testPerson: 'p1',
          unitId: 'u1',
          variableId: 'v1',
          selectedCode: {
            id: -2,
            code: '-2',
            label: 'New code needed',
            score: null,
            description: '',
            codingIssueOption: -2
          }
        }
      );
      progressSubjects[0].next({} as CodingJob);
      progressSubjects[0].complete();
      await noteSave;
      expect(service.selectedCodes.get(key)?.id).toBe(-2);
    });

    it('clears persisted new-code-needed progress when required notes are deleted', async () => {
      codingJobBackendServiceMock.saveCodingNotes.mockReturnValue(of({} as CodingJob));
      codingJobBackendServiceMock.saveCodingProgress.mockReturnValue(of({} as CodingJob));
      service.codingJobId = 100;
      const key = service.generateCompositeKey('p1', 'u1', 'v1');
      service.notes.set(key, 'old note');
      service.selectedCodes.set(key, {
        id: -2,
        code: '-2',
        label: 'New code needed',
        codingIssueOption: -2
      });
      service.isCodingJobCompleted = true;
      const unitsData = {
        id: 1,
        name: 'job',
        currentUnitIndex: 0,
        units: [
          {
            id: 1,
            name: 'u1',
            alias: 'u1',
            bookletId: 0,
            testPerson: 'p1',
            variableId: 'v1'
          }
        ]
      };

      await service.saveNotes(1, 'p1', 'u1', 'v1', '   ', unitsData);

      expect(codingJobBackendServiceMock.saveCodingProgress).toHaveBeenCalledWith(
        1,
        100,
        {
          testPerson: 'p1',
          unitId: 'u1',
          variableId: 'v1',
          selectedCode: null
        }
      );
      expect(service.selectedCodes.get(key)?.id).toBe(-2);
      expect(service.notes.has(key)).toBe(false);
      expect(service.isCodingJobCompleted).toBe(false);
    });

    it('keeps regular progress when notes for attached new-code-needed are deleted', async () => {
      codingJobBackendServiceMock.saveCodingNotes.mockReturnValue(of({} as CodingJob));
      codingJobBackendServiceMock.saveCodingProgress.mockReturnValue(of({} as CodingJob));
      service.codingJobId = 100;
      const key = service.generateCompositeKey('p1', 'u1', 'v1');
      service.notes.set(key, 'old note');
      service.selectedCodes.set(key, {
        id: 7,
        code: '7',
        label: 'Regular',
        score: 1,
        codingIssueOption: -2
      });
      const unitsData = {
        id: 1,
        name: 'job',
        currentUnitIndex: 0,
        units: [
          {
            id: 1,
            name: 'u1',
            alias: 'u1',
            bookletId: 0,
            testPerson: 'p1',
            variableId: 'v1'
          }
        ]
      };

      await service.saveNotes(1, 'p1', 'u1', 'v1', '   ', unitsData);

      expect(codingJobBackendServiceMock.saveCodingProgress).toHaveBeenCalledWith(
        1,
        100,
        {
          testPerson: 'p1',
          unitId: 'u1',
          variableId: 'v1',
          selectedCode: {
            id: 7,
            code: '7',
            label: 'Regular',
            score: 1,
            codingIssueOption: null
          }
        }
      );
      expect(service.selectedCodes.get(key)).toEqual({
        id: 7,
        code: '7',
        label: 'Regular',
        score: 1
      });
      expect(service.notes.has(key)).toBe(false);
      expect(service.isCodingJobCompleted).toBe(true);
    });
  });

  describe('session recovery', () => {
    it('restores and re-saves recovered coding state', async () => {
      codingJobBackendServiceMock.saveCodingProgress.mockReturnValue(of({} as CodingJob));
      codingJobBackendServiceMock.saveCodingNotes.mockReturnValue(of({} as CodingJob));
      codingJobBackendServiceMock.updateCodingJob.mockReturnValue(of({} as CodingJob));
      service.codingJobId = 100;
      service.codingJobComment = 'comment';

      await service.handleCodeSelected(
        { variableId: 'v1', code: { id: 7, label: 'Seven', score: 2 } as never },
        'p1',
        'u1',
        1,
        null
      );
      await service.saveNotes(1, 'p1', 'u1', 'v1', 'note');

      const snapshot = service.createRecoverySnapshot();
      expect(snapshot).not.toBeNull();

      codingJobBackendServiceMock.saveCodingProgress.mockClear();
      codingJobBackendServiceMock.saveCodingNotes.mockClear();
      codingJobBackendServiceMock.updateCodingJob.mockClear();

      service.resetCodingData();
      service.codingJobId = 100;
      expect(service.restoreRecoverySnapshot(snapshot!)).toBe(true);
      await expect(service.saveRecoveredCodingState(1, null)).resolves.toBe(true);

      expect(codingJobBackendServiceMock.saveCodingProgress).toHaveBeenCalledWith(
        1,
        100,
        {
          testPerson: 'p1',
          unitId: 'u1',
          variableId: 'v1',
          selectedCode: {
            id: 7,
            code: '7',
            label: 'Seven',
            score: 2,
            codingIssueOption: null
          }
        }
      );
      expect(codingJobBackendServiceMock.saveCodingNotes).toHaveBeenCalledWith(
        1,
        100,
        {
          testPerson: 'p1',
          unitId: 'u1',
          variableId: 'v1',
          notes: 'note'
        }
      );
      expect(codingJobBackendServiceMock.updateCodingJob).toHaveBeenCalledWith(1, 100, { comment: 'comment' });
    });

    it('keeps recovered coding state unsaved when required context is missing', async () => {
      service.codingJobId = 100;

      await expect(service.saveRecoveredCodingState(0, null)).resolves.toBe(false);

      expect(codingJobBackendServiceMock.saveCodingProgress).not.toHaveBeenCalled();
      expect(codingJobBackendServiceMock.saveCodingNotes).not.toHaveBeenCalled();
      expect(codingJobBackendServiceMock.updateCodingJob).not.toHaveBeenCalled();
    });
  });

  describe('read-only review mode', () => {
    beforeEach(() => {
      service.isReviewMode = true;
      service.codingJobId = 100;
    });

    it('does not update status or persist coding changes', async () => {
      await service.updateCodingJobStatus(1, 100, 'active');
      await service.saveCodingProgress(1, 100, 'p1', 'u1', 'v1', { id: 1, label: 'l' });
      await service.saveNotes(1, 'p1', 'u1', 'v1', 'note');
      await service.saveCodingJobComment(1, 'comment');
      await service.pauseCodingJob(1, 100);
      await service.resumeCodingJob(1, 100);
      await service.submitCodingJob(1, 100);

      expect(codingJobBackendServiceMock.updateCodingJob).not.toHaveBeenCalled();
      expect(codingJobBackendServiceMock.pauseCodingJob).not.toHaveBeenCalled();
      expect(codingJobBackendServiceMock.resumeCodingJob).not.toHaveBeenCalled();
      expect(codingJobBackendServiceMock.submitCodingJob).not.toHaveBeenCalled();
      expect(codingJobBackendServiceMock.saveCodingProgress).not.toHaveBeenCalled();
      expect(codingJobBackendServiceMock.saveCodingNotes).not.toHaveBeenCalled();
      expect(codingJobBackendServiceMock.pauseCodingJobKeepalive).not.toHaveBeenCalled();
    });

    it('ignores code selections without changing local progress', async () => {
      const key = service.generateCompositeKey('p1', 'u1', 'v1');

      await expect(service.handleCodeSelected(
        { variableId: 'v1', code: { id: 1, label: 'one', score: 1 } as never },
        'p1',
        'u1',
        1,
        null
      )).resolves.toBeNull();

      expect(service.selectedCodes.has(key)).toBe(false);
      expect(codingJobBackendServiceMock.saveCodingProgress).not.toHaveBeenCalled();
    });
  });
});
