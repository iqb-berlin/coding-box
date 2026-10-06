import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateModule } from '@ngx-translate/core';
import { Subject } from 'rxjs';
import { BulkCreationData, CodingJobBulkCreationDialogComponent } from './coding-job-bulk-creation-dialog.component';
import { DistributedCodingService, DistributionCalculationResponse } from '../../services/distributed-coding.service';
import { AppService } from '../../../core/services/app.service';

describe('CodingJobBulkCreationDialogComponent in zoneless mode', () => {
  let fixture: ComponentFixture<CodingJobBulkCreationDialogComponent>;
  let distribution: Subject<DistributionCalculationResponse>;
  let close: jest.Mock;
  let snackBarOpen: jest.Mock;

  const createData = (): BulkCreationData => ({
    selectedVariables: [{ unitName: 'Unit 1', variableId: 'Var 1', responseCount: 4 }],
    selectedVariableBundles: [],
    selectedCoders: [{ id: 1, name: 'Ada' }]
  });

  const createDistribution = (): DistributionCalculationResponse => ({
    distribution: { 'Unit 1::Var 1': { Ada: 4 } },
    distributionByCoderId: { 'Unit 1::Var 1': { 1: 4 } },
    doubleCodingInfo: {
      'Unit 1::Var 1': {
        totalCases: 4,
        doubleCodedCases: 0,
        singleCodedCasesAssigned: 4,
        doubleCodedCasesPerCoder: { Ada: 0 }
      }
    },
    aggregationInfo: {},
    matchingFlags: [],
    warnings: []
  });

  const createComponent = async (data = createData()): Promise<void> => {
    TestBed.overrideProvider(MAT_DIALOG_DATA, { useValue: data });
    fixture = TestBed.createComponent(CodingJobBulkCreationDialogComponent);
    fixture.autoDetectChanges();
    await fixture.whenStable();
  };

  const confirmButton = (): HTMLButtonElement => fixture.nativeElement.querySelector('.dialog-actions button:last-child');

  const waitForDistribution = async (): Promise<void> => {
    // The mocked HTTP Subject has no Angular pending task. Let firstValueFrom
    // resume the component before waiting for its signal-driven render.
    await Promise.resolve();
    await fixture.whenStable();
  };

  beforeEach(async () => {
    distribution = new Subject<DistributionCalculationResponse>();
    close = jest.fn();
    snackBarOpen = jest.fn();
    await TestBed.configureTestingModule({
      imports: [CodingJobBulkCreationDialogComponent, TranslateModule.forRoot()],
      providers: [
        provideZonelessChangeDetection(),
        { provide: MatDialogRef, useValue: { close } },
        { provide: MAT_DIALOG_DATA, useValue: createData() },
        { provide: DistributedCodingService, useValue: { calculateDistribution: () => distribution } },
        { provide: AppService, useValue: { selectedWorkspaceId: 1 } },
        { provide: MatSnackBar, useValue: { open: snackBarOpen } }
      ]
    }).compileComponents();
  });

  afterEach(() => fixture?.destroy());

  it('renders a delayed distribution and enables confirmation without another interaction', async () => {
    await createComponent();
    expect(fixture.nativeElement.querySelector('.loading-container')).not.toBeNull();
    expect(confirmButton().disabled).toBe(true);

    distribution.next(createDistribution());
    await waitForDistribution();

    expect(fixture.componentInstance.isLoading()).toBe(false);
    expect(fixture.componentInstance.jobPreviews()).toHaveLength(1);
    expect(fixture.nativeElement.querySelector('.loading-container')).toBeNull();
    expect(fixture.nativeElement.querySelector('.job-name').textContent).toContain('Ada');
    expect(fixture.nativeElement.querySelector('.double-coding-summary')).not.toBeNull();
    expect(confirmButton().disabled).toBe(false);
    confirmButton().click();
    expect(close).toHaveBeenCalledWith({
      confirmed: true, showScore: true, allowComments: true, suppressGeneralInstructions: false
    });
  });

  it('renders delayed warnings and requires confirmation before closing', async () => {
    await createComponent();
    distribution.next({
      ...createDistribution(),
      warnings: [{
        unitName: 'Unit 1', variableId: 'Var 1', message: 'Already assigned', casesInJobs: 1, availableCases: 4
      }]
    });
    await waitForDistribution();

    expect(fixture.nativeElement.querySelector('.warnings-panel').textContent).toContain('Already assigned');
    expect(confirmButton().textContent).toContain('coding-job-bulk-creation-dialog.buttons.continue');
    confirmButton().click();
    await fixture.whenStable();
    expect(close).not.toHaveBeenCalled();
    expect(confirmButton().textContent).toContain('coding-job-bulk-creation-dialog.buttons.confirm');
    confirmButton().click();
    expect(close).toHaveBeenCalledWith(expect.objectContaining({ confirmed: true }));
  });

  it('removes the loading indicator after a delayed empty distribution', async () => {
    await createComponent({ ...createData(), selectedVariables: [] });
    distribution.next({
      distribution: {}, doubleCodingInfo: {}, aggregationInfo: {}, matchingFlags: [], warnings: []
    });
    await waitForDistribution();

    expect(fixture.nativeElement.querySelector('.loading-container')).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('.job-preview-item')).toHaveLength(0);
    expect(confirmButton().disabled).toBe(true);
    expect(snackBarOpen).toHaveBeenCalledWith('No distribution calculated', 'Close', { duration: 3000 });
  });

  it('removes the loading indicator after a delayed request error', async () => {
    await createComponent();
    distribution.error(new Error('Network failed'));
    await waitForDistribution();

    expect(fixture.componentInstance.isLoading()).toBe(false);
    expect(fixture.nativeElement.querySelector('.loading-container')).toBeNull();
    expect(confirmButton().disabled).toBe(true);
    expect(snackBarOpen).toHaveBeenCalledWith('Failed to calculate distribution: Network failed', 'Close', { duration: 5000 });
  });
});
