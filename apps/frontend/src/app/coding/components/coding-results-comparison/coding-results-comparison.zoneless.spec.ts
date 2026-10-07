import { ChangeDetectorRef, provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateModule } from '@ngx-translate/core';
import { Observable, Subject } from 'rxjs';
import { CodingResultsComparisonComponent } from './coding-results-comparison.component';
import { CodingTrainingBackendService } from '../../services/coding-training-backend.service';
import { CodingStatisticsService } from '../../services/coding-statistics.service';
import { TestPersonCodingService } from '../../services/test-person-coding.service';
import { AppService } from '../../../core/services/app.service';
import { SessionRecoveryService } from '../../../core/services/session-recovery.service';
import { PostMessageService } from '../../../core/services/post-message.service';
import { WorkspaceSettingsService } from '../../../shared/services/workspace/workspace-settings.service';
import { CoderTraining } from '../../models/coder-training.model';
import type { TrainingKappaStatisticsDto } from '../../../../../../../api-dto/coding/training-kappa-statistics.dto';

type DiscussionSaveResult = ReturnType<CodingTrainingBackendService['saveDiscussionResult']> extends Observable<infer Result> ? Result : never;

describe('Coding comparison without Zone', () => {
  let fixture: ComponentFixture<CodingResultsComparisonComponent>;
  let trainings: Subject<CoderTraining[]>;
  let getCoderTrainings: jest.Mock;
  let snackBar: { open: jest.Mock };
  let kappaResponse: Subject<TrainingKappaStatisticsDto>;
  let saveResponse: Subject<DiscussionSaveResult>;
  let regexResponse: Subject<boolean>;

  const training = (id: number, label: string): CoderTraining => ({
    id,
    label,
    workspace_id: 1,
    created_at: new Date('2026-05-13T11:36:00'),
    updated_at: new Date('2026-05-13T11:36:00'),
    jobsCount: 0,
    assigned_coders: []
  });
  const choiceLabels = (): string[] => Array.from(
    fixture.nativeElement.querySelectorAll('.training-option-title') as NodeListOf<HTMLElement>
  ).map(element => element.textContent?.trim() || '');

  beforeEach(async () => {
    trainings = new Subject<CoderTraining[]>();
    kappaResponse = new Subject<TrainingKappaStatisticsDto>();
    saveResponse = new Subject<DiscussionSaveResult>();
    regexResponse = new Subject<boolean>();
    getCoderTrainings = jest.fn().mockReturnValue(trainings);
    snackBar = { open: jest.fn() };
    await TestBed.configureTestingModule({
      imports: [CodingResultsComparisonComponent, TranslateModule.forRoot()],
      providers: [
        provideZonelessChangeDetection(),
        { provide: MatDialogRef, useValue: { close: jest.fn() } },
        { provide: MatDialog, useValue: { open: jest.fn() } },
        { provide: MAT_DIALOG_DATA, useValue: { workspaceId: 1 } },
        { provide: MatSnackBar, useValue: snackBar },
        { provide: CodingTrainingBackendService, useValue: { getCoderTrainings, getTrainingCohensKappa: () => kappaResponse, saveDiscussionResult: () => saveResponse } },
        { provide: CodingStatisticsService, useValue: {} },
        { provide: TestPersonCodingService, useValue: {} },
        { provide: AppService, useValue: { authData: { userName: 'Manager' }, needsReAuthentication: false } },
        { provide: WorkspaceSettingsService, useValue: { getEnableRegexSearch: () => regexResponse } },
        { provide: PostMessageService, useValue: { getMessages: () => new Subject<void>() } },
        {
          provide: SessionRecoveryService,
          useValue: { restore$: new Subject<void>(), registerProvider: () => () => undefined, peekDraft: () => undefined }
        }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(CodingResultsComparisonComponent);
    fixture.autoDetectChanges();
    await fixture.whenStable();
    // Let initial Material scheduling finish before the delayed response arrives.
    await new Promise(resolve => { setTimeout(resolve, 50); });
    await fixture.whenStable();
  });

  it('renders a delayed training response in its original order without another interaction', async () => {
    expect(choiceLabels()).toEqual([]);
    trainings.next([training(2, 'Second training'), training(1, 'First training')]);
    await fixture.whenStable();

    expect(choiceLabels()).toEqual(['Second training · ID 2', 'First training · ID 1']);
    expect(fixture.nativeElement.querySelectorAll('.training-checkbox')).toHaveLength(2);
  });

  it('filters by label, id and metadata and clears the filter when changing mode', async () => {
    const first = { ...training(1, 'First training'), jobsCount: 2 };
    const second = { ...training(22, 'Second training'), jobsCount: 3 };
    trainings.next([first, second]);
    await fixture.whenStable();
    const input = fixture.nativeElement.querySelector('input[placeholder="Schulungen filtern..."]') as HTMLInputElement;
    for (const value of ['second', '22', '3 Kodierer']) {
      input.value = value;
      input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
      await fixture.whenStable();
      expect(choiceLabels()).toEqual(['Second training · ID 22']);
    }
    input.value = 'unknown';
    input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    await fixture.whenStable();
    expect(choiceLabels()).toEqual([]);

    fixture.componentInstance.onModeChange();
    await fixture.whenStable();
    expect(choiceLabels()).toEqual(['First training · ID 1', 'Second training · ID 22']);
  });

  it('renders choices when retrying after an empty response', async () => {
    trainings.next([]);
    await fixture.whenStable();
    expect(choiceLabels()).toEqual([]);
    const retry = new Subject<CoderTraining[]>();
    getCoderTrainings.mockReturnValue(retry);
    const loaded = fixture.componentInstance.loadCoderTrainings();
    retry.next([training(3, 'Retry training')]);
    await loaded;
    await fixture.whenStable();
    expect(choiceLabels()).toEqual(['Retry training · ID 3']);
  });

  it('handles a failed initial load and renders a subsequent successful retry', async () => {
    trainings.error(new Error('training list unavailable'));
    await fixture.whenStable();
    expect(choiceLabels()).toEqual([]);
    expect(snackBar.open).toHaveBeenCalledWith(
      'coding.trainings.loading.error', 'common.close', { duration: 3000 }
    );
    const retry = new Subject<CoderTraining[]>();
    getCoderTrainings.mockReturnValue(retry);
    const loaded = fixture.componentInstance.loadCoderTrainings();
    retry.next([training(4, 'Recovered training')]);
    await loaded;
    await fixture.whenStable();
    expect(choiceLabels()).toEqual(['Recovered training · ID 4']);
  });

  it('ignores an older response after a newer request has loaded the choices', async () => {
    const newer = new Subject<CoderTraining[]>();
    getCoderTrainings.mockReturnValue(newer);
    const loaded = fixture.componentInstance.loadCoderTrainings();
    newer.next([training(5, 'Current training')]);
    await loaded;
    await fixture.whenStable();
    trainings.next([training(1, 'Old training')]);
    await fixture.whenStable();
    expect(choiceLabels()).toEqual(['Current training · ID 5']);
  });

  async function prepareWithinTraining(): Promise<CodingResultsComparisonComponent> {
    const c = fixture.componentInstance;
    c.comparisonMode = 'within-training';
    c.selectedTrainingForWithin = 5;
    c.displayedColumns = ['index', 'discussion'];
    c.totalItems = 1;
    c.totalComparisons = 1;
    c.availableCoders = [{ jobId: 1, coderName: 'A' }, { jobId: 2, coderName: 'B' }];
    c.codersFormControl.setValue([1, 2]);
    c.selectedCoderIds.setSelection(1, 2);
    c.withinTrainingData = [{
      responseId: 1,
      unitName: 'U1',
      variableId: 'V1',
      testperson: 'T1',
      coders: [{
        jobId: 1, coderName: 'A', code: '1', score: 1
      }, {
        jobId: 2, coderName: 'B', code: '1', score: 1
      }]
    }];
    c.dataSource.data = c.withinTrainingData;
    fixture.debugElement.injector.get(ChangeDetectorRef).markForCheck();
    await fixture.whenStable();
    return c;
  }

  async function startDiscussionSave(): Promise<CodingResultsComparisonComponent> {
    const c = await prepareWithinTraining();
    const input = fixture.nativeElement.querySelector('.discussion-input input') as HTMLInputElement;
    input.value = '1';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true }));
    await fixture.whenStable();
    await new Promise(resolve => { setTimeout(resolve, 50); });
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.discussion-saving')).not.toBeNull();
    return c;
  }

  it('renders invalid regex feedback when the workspace setting arrives after the filter', async () => {
    const c = await prepareWithinTraining();
    c.tableFilters.unitName = '[';
    fixture.debugElement.injector.get(ChangeDetectorRef).markForCheck();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.table-filters input')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.regex-filter-invalid')).toBeNull();

    regexResponse.next(true);
    await fixture.whenStable();

    expect(c.isTableRegexFilterInvalid('unitName')).toBe(true);
    expect(fixture.nativeElement.querySelector('.regex-filter-invalid')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.regex-filter-error')?.textContent)
      .toContain('search-filter.invalid-regex');
  });

  it('renders a delayed Kappa result after the header click without another interaction', async () => {
    const c = await prepareWithinTraining();
    (fixture.nativeElement.querySelector('.kappa-header') as HTMLElement).click();
    await fixture.whenStable();
    await new Promise(resolve => { setTimeout(resolve, 50); });
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Berechne Interrater-Reliabilität');
    kappaResponse.next({
      variables: [],
      workspaceSummary: {
        totalDoubleCodedResponses: 1,
        totalCoderPairs: 1,
        averageKappa: 0.8,
        averageBrennanPredigerKappa: 0.9,
        variablesIncluded: 1,
        codersIncluded: 2,
        weightingMethod: 'weighted',
        calculationLevel: 'code'
      }
    });
    await fixture.whenStable();
    expect(c.kappaStatistics()?.workspaceSummary.averageKappa).toBe(0.8);
    expect(fixture.nativeElement.querySelector('.kappa-statistics')).not.toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Berechne Interrater-Reliabilität');
  });
  it('clears the saving indication after a delayed discussion save', async () => {
    const c = await startDiscussionSave();
    const savingSnapshot = c.isSavingDiscussionByResponseId();
    saveResponse.next({
      success: true, code: 1, score: 1, notes: null, managerUserId: 1, managerName: 'Manager', source: 'manual'
    });
    await fixture.whenStable();
    expect(c.isSavingDiscussionByResponseId()[1]).toBe(false);
    expect(savingSnapshot[1]).toBe(true);
    expect(c.isSavingDiscussionByResponseId()).not.toBe(savingSnapshot);
    expect(fixture.nativeElement.querySelector('.discussion-saving')).toBeNull();
  });

  it('ends the Kappa loading indication after a delayed failure', async () => {
    const c = await prepareWithinTraining();
    (fixture.nativeElement.querySelector('.kappa-header') as HTMLElement).click();
    await fixture.whenStable();
    await new Promise(resolve => { setTimeout(resolve, 50); });
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Berechne Interrater-Reliabilität');

    kappaResponse.error(new Error('Kappa unavailable'));
    await fixture.whenStable();

    expect(c.isLoadingKappa()).toBe(false);
    expect(c.kappaStatistics()).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Berechne Interrater-Reliabilität');
    expect(snackBar.open).toHaveBeenCalledWith('coding.trainings.kappa.error', 'common.close', { duration: 3000 });
  });

  it('shows a delayed discussion save error and clears the saving indication', async () => {
    const c = await startDiscussionSave();

    saveResponse.error(new Error('Save unavailable'));
    await fixture.whenStable();

    expect(c.isSavingDiscussionByResponseId()[1]).toBe(false);
    expect(fixture.nativeElement.querySelector('.discussion-saving')).toBeNull();
    expect(fixture.nativeElement.querySelector('.discussion-error')?.textContent)
      .toContain('Diskussionsergebnis konnte nicht gespeichert werden.');
  });
});
