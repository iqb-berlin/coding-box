import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormBuilder } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { of, Subject } from 'rxjs';
import { CodingJobDefinitionDialogComponent } from './coding-job-definition-dialog.component';
import { Variable } from '../../models/coding-job.model';
import { CodingJobBackendService } from '../../services/coding-job-backend.service';
import { DistributedCodingService, DistributionCalculationResponse } from '../../services/distributed-coding.service';
import { CoderService } from '../../services/coder.service';
import { CodingJobService } from '../../services/coding-job.service';
import { TestPersonCodingService } from '../../services/test-person-coding.service';
import { MissingsProfileService } from '../../services/missings-profile.service';
import { AppService } from '../../../core/services/app.service';
import { SessionRecoveryService } from '../../../core/services/session-recovery.service';
import { WorkspaceSettingsService } from '../../../ws-admin/services/workspace-settings.service';

describe('CodingJobDefinitionDialogComponent in zoneless mode', () => {
  let fixture: ComponentFixture<CodingJobDefinitionDialogComponent>;
  let preview: Subject<DistributionCalculationResponse>;
  let calculateDistribution: jest.Mock;

  beforeEach(async () => {
    preview = new Subject<DistributionCalculationResponse>();
    calculateDistribution = jest.fn().mockReturnValue(preview.asObservable());
    // Each of six people has a response to all three variables in the bundle.
    const variables: Variable[] = ['V1', 'V2', 'V3'].map(variableId => ({
      unitName: 'U1',
      variableId,
      responseCount: 6,
      availableCases: 6,
      uniqueCasesAfterAggregation: 6
    }));

    await TestBed.configureTestingModule({
      imports: [CodingJobDefinitionDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        FormBuilder,
        { provide: MAT_DIALOG_DATA, useValue: { isEdit: false, mode: 'definition' } },
        { provide: MatDialogRef, useValue: { close: jest.fn() } },
        { provide: MatDialog, useValue: { open: jest.fn() } },
        { provide: MatSnackBar, useValue: { open: jest.fn() } },
        { provide: TranslateService, useValue: { instant: (key: string) => key } },
        { provide: AppService, useValue: { selectedWorkspaceId: 1, needsReAuthentication: false } },
        {
          provide: CodingJobBackendService,
          useValue: {
            getJobDefinitions: () => of([]),
            getCodingIncompleteVariables: () => of(variables),
            getManualCodingScopeSummary: () => of(null),
            getVariableBundles: () => of([{ id: 1, name: 'Three variables per person', variables }])
          }
        },
        { provide: DistributedCodingService, useValue: { calculateDistribution } },
        { provide: CoderService, useValue: { getCoders: () => of([{ id: 1, name: 'Coder' }]) } },
        { provide: CodingJobService, useValue: { jobsCreatedEvent: new Subject<void>() } },
        { provide: TestPersonCodingService, useValue: { autoCodingCompleted$: new Subject<void>() } },
        { provide: MissingsProfileService, useValue: { getMissingsProfiles: () => of([]) } },
        { provide: WorkspaceSettingsService, useValue: { getIncludeDeriveErrorInManualCoding: () => of(false) } },
        {
          provide: SessionRecoveryService,
          useValue: {
            restore$: new Subject<void>(),
            registerProvider: () => () => undefined,
            peekDraft: () => null
          }
        }
      ]
    }).overrideComponent(CodingJobDefinitionDialogComponent, {
      set: {
        imports: [],
        template: `
          <button id="select-bundle" (click)="toggleBundleSelection(variableBundles()[0])">Select bundle</button>
          <button id="select-coder" (click)="masterCoderToggle()">Select coder</button>
          <span id="cases">{{ getTotalCodingCases() }}</span>
          <span id="total-time">{{ getFormattedTotalTime() }}</span>
          <span id="time-per-coder">{{ getFormattedTimePerCoder() }}</span>
        `
      }
    }).compileComponents();

    fixture = TestBed.createComponent(CodingJobDefinitionDialogComponent);
    fixture.autoDetectChanges();
    await fixture.whenStable();
  });

  afterEach(() => {
    fixture.destroy();
  });

  it('renders distinct bundle cases after a delayed preview without another interaction', async () => {
    const selectBundle: HTMLButtonElement = fixture.nativeElement.querySelector('#select-bundle');
    const selectCoder: HTMLButtonElement = fixture.nativeElement.querySelector('#select-coder');
    selectBundle.click();
    selectCoder.click();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('#cases').textContent).toBe('18');

    // Let the selection render and debounce finish before the backend replies.
    await new Promise(resolve => { setTimeout(resolve, 350); });
    await fixture.whenStable();
    expect(calculateDistribution).toHaveBeenCalledTimes(1);
    expect(calculateDistribution.mock.calls[0][5]).toEqual([
      expect.objectContaining({
        id: 1,
        variables: variablesForBundle()
      })
    ]);

    preview.next({
      distribution: { 'bundle:1': { Coder: 18 } },
      doubleCodingInfo: {
        'bundle:1': {
          totalCases: 18,
          distinctCases: 6,
          doubleCodedCases: 0,
          singleCodedCasesAssigned: 6,
          codingTasksTotal: 18,
          doubleCodedCasesPerCoder: {}
        }
      },
      aggregationInfo: { 'bundle:1': { uniqueCases: 6, totalResponses: 18 } },
      matchingFlags: [],
      warnings: [],
      tasksPerCoder: { 1: 18 }
    });
    preview.complete();
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('#cases').textContent).toBe('6');
    expect(fixture.nativeElement.querySelector('#total-time').textContent).toBe('0:18');
    expect(fixture.nativeElement.querySelector('#time-per-coder').textContent).toBe('0:18');
  });

  function variablesForBundle(): { unitName: string; variableId: string }[] {
    return ['V1', 'V2', 'V3'].map(variableId => ({ unitName: 'U1', variableId }));
  }
});
