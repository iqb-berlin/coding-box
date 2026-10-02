import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { of, Subject } from 'rxjs';
import { CodingResultsComparisonComponent } from './coding-results-comparison.component';
import { CodingTrainingBackendService } from '../../services/coding-training-backend.service';
import { CodingStatisticsService } from '../../services/coding-statistics.service';
import { TestPersonCodingService } from '../../services/test-person-coding.service';
import { AppService } from '../../../core/services/app.service';
import { SessionRecoveryService } from '../../../core/services/session-recovery.service';
import { PostMessageService } from '../../../core/services/post-message.service';
import { WorkspaceSettingsService } from '../../../ws-admin/services/workspace-settings.service';
import { CoderTraining } from '../../models/coder-training.model';

describe('Coding comparison training choices without Zone', () => {
  let fixture: ComponentFixture<CodingResultsComparisonComponent>;
  let trainings: Subject<CoderTraining[]>;
  let getCoderTrainings: jest.Mock;
  let snackBar: { open: jest.Mock };

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
    getCoderTrainings = jest.fn().mockReturnValue(trainings);
    snackBar = { open: jest.fn() };
    await TestBed.configureTestingModule({
      imports: [CodingResultsComparisonComponent, TranslateModule.forRoot(), NoopAnimationsModule],
      providers: [
        provideZonelessChangeDetection(),
        { provide: MatDialogRef, useValue: { close: jest.fn() } },
        { provide: MatDialog, useValue: { open: jest.fn() } },
        { provide: MAT_DIALOG_DATA, useValue: { workspaceId: 1 } },
        { provide: MatSnackBar, useValue: snackBar },
        { provide: CodingTrainingBackendService, useValue: { getCoderTrainings } },
        { provide: CodingStatisticsService, useValue: {} },
        { provide: TestPersonCodingService, useValue: {} },
        { provide: AppService, useValue: { authData: { userName: 'Manager' }, needsReAuthentication: false } },
        { provide: WorkspaceSettingsService, useValue: { getEnableRegexSearch: () => of(false) } },
        { provide: PostMessageService, useValue: { getMessages: () => new Subject<void>() } },
        {
          provide: SessionRecoveryService,
          useValue: { restore$: new Subject<void>(), registerProvider: () => () => undefined }
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
});
