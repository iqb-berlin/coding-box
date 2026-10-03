import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateModule } from '@ngx-translate/core';
import { Subject } from 'rxjs';
import { AppService } from '../../../core/services/app.service';
import {
  CohensKappaStatisticsResponse,
  TestPersonCodingService
} from '../../services/test-person-coding.service';
import {
  CohensKappaStatisticsComponent,
  CohensKappaStatisticsDialogData
} from './cohens-kappa-statistics.component';

describe('Cohen kappa delayed responses without Zone', () => {
  let fixture: ComponentFixture<CohensKappaStatisticsComponent>;
  let statistics: Subject<CohensKappaStatisticsResponse>;
  let download: Subject<Blob>;
  let service: {
    getCohensKappaStatistics: jest.Mock;
    exportCohensKappaSummaryAsCsv: jest.Mock;
    exportCohensKappaStatisticsAsXlsx: jest.Mock;
    exportCohensKappaStatisticsAsCsv: jest.Mock;
  };
  let snackBar: { open: jest.Mock };
  const createObjectURL = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
  const revokeObjectURL = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
  const response: CohensKappaStatisticsResponse = {
    variables: [{
      unitName: 'UNIT',
      variableId: 'VAR',
      caseCount: 3,
      doubleCodedCount: 2,
      doubleCodedRate: 2 / 3,
      validPairCount: 2,
      coderPairCount: 1,
      meanKappa: 0.5,
      meanAgreement: 0.75,
      coderPairs: [{
        coder1Id: 1,
        coder1Name: 'Coder 1',
        coder2Id: 2,
        coder2Name: 'Coder 2',
        kappa: 0.5,
        agreement: 0.75,
        totalItems: 3,
        validPairs: 2,
        interpretation: 'kappa.moderate'
      }]
    }],
    workspaceSummary: {
      totalCodedResponses: 3,
      totalDoubleCodedResponses: 2,
      totalCoderPairs: 1,
      averageKappa: 0.5,
      meanAgreement: 0.75,
      variablesIncluded: 1,
      codersIncluded: 2,
      weightingMethod: 'weighted'
    }
  };

  beforeAll(() => {
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: jest.fn(() => 'blob:kappa') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: jest.fn() });
  });

  afterAll(() => {
    if (createObjectURL) Object.defineProperty(URL, 'createObjectURL', createObjectURL);
    else Reflect.deleteProperty(URL, 'createObjectURL');
    if (revokeObjectURL) Object.defineProperty(URL, 'revokeObjectURL', revokeObjectURL);
    else Reflect.deleteProperty(URL, 'revokeObjectURL');
  });

  beforeEach(() => {
    statistics = new Subject();
    download = new Subject();
    snackBar = { open: jest.fn() };
    service = {
      getCohensKappaStatistics: jest.fn(() => statistics),
      exportCohensKappaSummaryAsCsv: jest.fn(() => download),
      exportCohensKappaStatisticsAsXlsx: jest.fn(() => download),
      exportCohensKappaStatisticsAsCsv: jest.fn(() => download)
    };
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation();
  });

  afterEach(() => {
    fixture?.destroy();
    jest.restoreAllMocks();
  });

  async function createComponent(data: CohensKappaStatisticsDialogData = {}): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [CohensKappaStatisticsComponent, TranslateModule.forRoot()],
      providers: [
        provideZonelessChangeDetection(),
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: { close: jest.fn() } },
        { provide: MatSnackBar, useValue: snackBar },
        { provide: AppService, useValue: { selectedWorkspaceId: 1 } },
        { provide: TestPersonCodingService, useValue: service }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(CohensKappaStatisticsComponent);
    fixture.autoDetectChanges();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('mat-spinner')).not.toBeNull();
  }

  async function deliver(callback: () => void): Promise<void> {
    await new Promise<void>(resolve => {
      setTimeout(() => { callback(); resolve(); }, 0);
    });
    await fixture.whenStable();
  }

  function exportButtons(): HTMLButtonElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('.kappa-detail-actions button'));
  }

  it('renders delayed statistics, summary and coder selection and ends loading', async () => {
    await createComponent();
    await deliver(() => statistics.next(response));

    expect(fixture.nativeElement.querySelector('mat-spinner')).toBeNull();
    expect(fixture.nativeElement.querySelector('.kappa-stats .kappa').textContent).toContain('0.500');
    expect(fixture.nativeElement.querySelector('.kappa-summary-table').textContent).toContain('UNIT - VAR');
    expect(fixture.nativeElement.querySelector('.coder-selection')).not.toBeNull();
    expect(exportButtons().every(button => !button.disabled)).toBe(true);
  });

  it('shows the empty state after a delayed empty response', async () => {
    await createComponent();
    await deliver(() => statistics.next({
      variables: [],
      workspaceSummary: {
        totalCodedResponses: 0,
        totalDoubleCodedResponses: 0,
        totalCoderPairs: 0,
        averageKappa: null,
        meanAgreement: null,
        variablesIncluded: 0,
        codersIncluded: 0,
        weightingMethod: 'weighted'
      }
    }));

    expect(fixture.nativeElement.querySelector('mat-spinner')).toBeNull();
    expect(fixture.nativeElement.querySelector('.no-kappa-data').textContent).toContain('cohens-kappa-statistics.no-data');
    expect(exportButtons().every(button => button.disabled)).toBe(true);
  });

  it('ends loading and renders the empty state after a delayed error', async () => {
    await createComponent();
    await deliver(() => statistics.error(new Error('Statistics failed')));

    expect(fixture.nativeElement.querySelector('mat-spinner')).toBeNull();
    expect(fixture.nativeElement.querySelector('.no-kappa-data')).not.toBeNull();
    expect(exportButtons().every(button => button.disabled)).toBe(true);
  });

  it('renders the current training response and ignores an older response', async () => {
    const date = new Date('2026-10-02T08:00:00Z');
    await createComponent({
      availableCoderTrainings: [
        {
          id: 7, label: 'First', workspace_id: 1, created_at: date, updated_at: date
        },
        {
          id: 9, label: 'Second', workspace_id: 1, created_at: date, updated_at: date
        }
      ],
      selectedCoderTrainingId: 7
    });
    const current = new Subject<CohensKappaStatisticsResponse>();
    service.getCohensKappaStatistics.mockReturnValueOnce(current);
    fixture.componentInstance.selectedCoderTrainingId.set(9);
    fixture.componentInstance.onCoderTrainingSelectionChange();
    await fixture.whenStable();
    await deliver(() => current.next({
      ...response, variables: [{ ...response.variables[0], variableId: 'CURRENT' }]
    }));
    await deliver(() => statistics.next({
      ...response, variables: [{ ...response.variables[0], variableId: 'STALE' }]
    }));

    expect(fixture.nativeElement.querySelector('mat-spinner')).toBeNull();
    const table = fixture.nativeElement.querySelector('.kappa-summary-table');
    expect(table.textContent).toContain('UNIT - CURRENT');
    expect(table.textContent).not.toContain('STALE');
    expect(service.getCohensKappaStatistics).toHaveBeenLastCalledWith(
      1, true, false, undefined, undefined, { coderTrainingIds: [9] }, 'code'
    );
  });

  it('reloads through the bound weighting toggle and renders the delayed result', async () => {
    await createComponent();
    await deliver(() => statistics.next(response));
    const nextResponse = new Subject<CohensKappaStatisticsResponse>();
    service.getCohensKappaStatistics.mockReturnValueOnce(nextResponse);
    const toggle = Array.from(fixture.nativeElement.querySelectorAll('mat-slide-toggle'))
      .find(element => (element as HTMLElement).textContent?.includes('cohens-kappa-statistics.weighted-mean')) as HTMLElement;
    toggle.querySelector('button')?.click();
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('mat-spinner')).not.toBeNull();
    expect(service.getCohensKappaStatistics).toHaveBeenLastCalledWith(
      1, false, true, undefined, undefined, { coderIds: [1, 2] }, 'code'
    );
    await deliver(() => nextResponse.next({
      ...response, workspaceSummary: { ...response.workspaceSummary, averageKappa: 0.75, weightingMethod: 'unweighted' }
    }));
    expect(fixture.nativeElement.querySelector('mat-spinner')).toBeNull();
    expect(fixture.nativeElement.querySelector('.kappa-stats .kappa').textContent).toContain('0.750');
  });

  const exports = [
    { format: 'xlsx', index: 0, method: 'exportCohensKappaStatisticsAsXlsx' },
    { format: 'summary', index: 1, method: 'exportCohensKappaSummaryAsCsv' },
    { format: 'details', index: 2, method: 'exportCohensKappaStatisticsAsCsv' }
  ] as const;

  it.each(exports)('reenables export buttons after a delayed $format download', async ({ index, method }) => {
    await createComponent();
    await deliver(() => statistics.next(response));
    exportButtons()[index].click();
    await fixture.whenStable();
    expect(exportButtons().every(button => button.disabled)).toBe(true);
    expect(exportButtons()[index].textContent).toContain('cohens-kappa-statistics.export-running');
    expect(service[method]).toHaveBeenCalledWith(
      1, true, true, undefined, undefined, { coderIds: [1, 2] }, 'code'
    );

    await deliver(() => { download.next(new Blob(['Synthetic export'])); download.complete(); });
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
    expect(exportButtons().every(button => !button.disabled)).toBe(true);
    expect(exportButtons()[index].textContent).not.toContain('cohens-kappa-statistics.export-running');
  });

  it.each(exports)('reenables export buttons after a delayed $format failure', async ({ index }) => {
    await createComponent();
    await deliver(() => statistics.next(response));
    exportButtons()[index].click();
    await fixture.whenStable();
    expect(exportButtons().every(button => button.disabled)).toBe(true);

    await deliver(() => download.error(new Error('Download failed')));
    expect(snackBar.open).toHaveBeenCalled();
    expect(exportButtons().every(button => !button.disabled)).toBe(true);
    expect(exportButtons()[index].textContent).not.toContain('cohens-kappa-statistics.export-running');
  });
});
