import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { provideHttpClient } from '@angular/common/http';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { OverlayContainer } from '@angular/cdk/overlay';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of, throwError } from 'rxjs';

import { CodingJobDefinitionsComponent } from './coding-job-definitions.component';
import { CodingJobBackendService } from '../../services/coding-job-backend.service';
import { CoderService } from '../../services/coder.service';
import { DistributedCodingService } from '../../services/distributed-coding.service';
import { CodingJobService } from '../../services/coding-job.service';
import { AppService } from '../../../core/services/app.service';
import { SERVER_URL } from '../../../injection-tokens';
import { environment } from '../../../../environments/environment';
import { JobDefinitionRefreshPreviewDto } from '../../../../../../../api-dto/coding/job-refresh.dto';
import { JobDefinitionRefreshDialogComponent } from './job-definition-refresh-dialog.component';
import {
  JobDefinitionDistributionSummaryDialogComponent
} from './job-definition-distribution-summary-dialog.component';

describe('CodingJobDefinitionsComponent', () => {
  let component: CodingJobDefinitionsComponent;
  let fixture: ComponentFixture<CodingJobDefinitionsComponent>;
  let overlayContainer: OverlayContainer;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [
        provideNoopAnimations(),
        { provide: SERVER_URL, useValue: environment.backendUrl },
        { provide: MatSnackBar, useValue: { open: jest.fn() } },
        {
          provide: CodingJobBackendService,
          useValue: {
            getJobDefinitions: jest.fn().mockReturnValue(of([])),
            updateJobDefinition: jest.fn().mockReturnValue(of({})),
            approveJobDefinition: jest.fn().mockReturnValue(of({})),
            deleteJobDefinition: jest.fn().mockReturnValue(of({})),
            createCodingJobFromDefinition: jest.fn().mockReturnValue(of({ success: true, jobsCreated: 1, jobs: [] })),
            previewCodingJobFromDefinition: jest.fn().mockReturnValue(of({
              distribution: {},
              distributionByCoderId: {},
              doubleCodingInfo: {},
              aggregationInfo: {},
              matchingFlags: [],
              warnings: [],
              pairDistribution: {},
              tasksPerCoder: {},
              coderWeights: {},
              selectedVariables: [],
              selectedVariableBundles: [],
              selectedCoders: []
            })),
            exportJobDefinitionDistributionCsv: jest.fn().mockReturnValue(of(new Blob(['csv'], { type: 'text/csv' }))),
            previewJobDefinitionRefresh: jest.fn().mockReturnValue(of({
              jobDefinitionId: 42,
              existingJobsCount: 1,
              staleJobsCount: 1,
              existingCases: 5,
              plannedCases: 5,
              retainedCases: 5,
              addedCases: 0,
              removedCases: 0,
              addedCodingTasks: 0,
              removedCodingTasks: 0,
              canApply: true
            })),
            applyJobDefinitionRefresh: jest.fn().mockReturnValue(of({ success: true, jobsCreated: 1 })),
            updateCodingJob: jest.fn().mockReturnValue(of({}))
          }
        },
        {
          provide: CoderService,
          useValue: { getCoders: jest.fn().mockReturnValue(of([])) }
        },
        {
          provide: DistributedCodingService,
          useValue: { createDistributedCodingJobs: jest.fn().mockReturnValue(of({ success: true, jobs: [] })) }
        },
        {
          provide: CodingJobService,
          useValue: { jobsCreatedEvent: { emit: jest.fn() } }
        },
        { provide: AppService, useValue: { selectedWorkspaceId: 1 } },
        provideHttpClient()
      ],
      imports: [CodingJobDefinitionsComponent, TranslateModule.forRoot()]
    }).compileComponents();

    fixture = TestBed.createComponent(CodingJobDefinitionsComponent);
    component = fixture.componentInstance;
    overlayContainer = TestBed.inject(OverlayContainer);
    fixture.detectChanges();
  });

  afterEach(() => {
    overlayContainer.ngOnDestroy();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('shows explicit loading and empty states', () => {
    component.isLoading = true;
    component.jobDefinitions = [];
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.loading-container')).toBeTruthy();

    component.isLoading = false;
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.empty-state')).toBeTruthy();
  });

  it('separates delete from regular definition actions', async () => {
    component.isLoading = false;
    component.selectionMode = false;
    component.jobDefinitions = [{
      id: 6,
      status: 'approved',
      assignedVariables: [{ unitName: 'UNIT', variableId: 'VAR' }],
      assignedCoders: [1],
      createdJobsCount: 0,
      blockingCreatedJobsCount: 0
    }];
    fixture.detectChanges();
    await fixture.whenStable();

    const trigger = fixture.nativeElement.querySelector(
      '.more-actions-button'
    ) as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();
    await fixture.whenStable();

    const overlayElement = overlayContainer.getContainerElement();

    expect(overlayElement.querySelector('.menu-section-divider')).toBeTruthy();
    expect(overlayElement.querySelector('.danger-menu-item')).toBeTruthy();
  });

  it('does not offer job creation again once jobs exist for a definition', () => {
    component.isLoading = false;
    component.selectionMode = false;
    component.jobDefinitions = [{
      id: 6,
      status: 'approved',
      assignedVariables: [{ unitName: 'UNIT', variableId: 'VAR' }],
      assignedCoders: [1],
      createdJobsCount: 2
    }];
    fixture.detectChanges();

    const rowAction = fixture.nativeElement.querySelector('.primary-row-action') as HTMLButtonElement;

    expect(rowAction.disabled).toBe(true);
    expect(component.getCreatedJobsCount(component.jobDefinitions[0])).toBe(2);
    expect(component.canCreateCodingJobs(component.jobDefinitions[0])).toBe(false);
    expect(component.getDefinitionsReadyForJobsCount()).toBe(0);
  });

  it('opens locked definitions read-only and blocks delete while jobs still block deletion', async () => {
    component.isLoading = false;
    component.selectionMode = false;
    const definition = {
      id: 6,
      status: 'approved' as const,
      assignedVariables: [{ unitName: 'UNIT', variableId: 'VAR' }],
      assignedCoders: [1],
      createdJobsCount: 2,
      blockingCreatedJobsCount: 1
    };
    component.jobDefinitions = [definition];
    fixture.detectChanges();
    await fixture.whenStable();

    const trigger = fixture.nativeElement.querySelector(
      '.more-actions-button'
    ) as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();
    await fixture.whenStable();

    const overlayElement = overlayContainer.getContainerElement();
    const menuButtons = Array.from(
      overlayElement.querySelectorAll('button')
    ) as HTMLButtonElement[];
    const deleteButton = overlayElement.querySelector('.danger-menu-item') as HTMLButtonElement;
    const matDialog = TestBed.inject(MatDialog);
    const dialogOpenSpy = jest.spyOn(matDialog, 'open');
    const codingJobBackendService = TestBed.inject(CodingJobBackendService) as unknown as {
      deleteJobDefinition: jest.Mock;
    };

    expect(component.canModifyDefinition(definition)).toBe(false);
    expect(component.canDeleteDefinition(definition)).toBe(false);
    expect(menuButtons[0].disabled).toBe(false);
    expect(deleteButton.disabled).toBe(false);

    component.editDefinition(definition);
    component.deleteDefinition(definition);

    expect(dialogOpenSpy).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({
      data: expect.objectContaining({
        readOnly: true
      })
    }));
    expect(codingJobBackendService.deleteJobDefinition).not.toHaveBeenCalled();
  });

  it('allows deleting definitions once all created jobs no longer block deletion', () => {
    const codingJobBackendService = TestBed.inject(CodingJobBackendService) as unknown as {
      deleteJobDefinition: jest.Mock;
    };
    const definition = {
      id: 6,
      status: 'approved' as const,
      assignedVariables: [{ unitName: 'UNIT', variableId: 'VAR' }],
      assignedCoders: [1],
      createdJobsCount: 2,
      blockingCreatedJobsCount: 0
    };

    component.deleteDefinition(definition);

    expect(codingJobBackendService.deleteJobDefinition).toHaveBeenCalledWith(1, 6);
  });

  it('blocks job creation when the created jobs count is missing', () => {
    component.isLoading = false;
    component.selectionMode = false;
    component.jobDefinitions = [{
      id: 6,
      status: 'approved',
      assignedVariables: [{ unitName: 'UNIT', variableId: 'VAR' }],
      assignedCoders: [1]
    }];
    fixture.detectChanges();

    const rowAction = fixture.nativeElement.querySelector('.primary-row-action') as HTMLButtonElement;

    expect(rowAction.disabled).toBe(true);
    expect(component.getCreatedJobsCount(component.jobDefinitions[0])).toBeUndefined();
    expect(component.canCreateCodingJobs(component.jobDefinitions[0])).toBe(false);
    expect(component.getDefinitionsReadyForJobsCount()).toBe(0);
  });

  it('opens the latest stored distribution snapshot read-only', () => {
    const matDialog = TestBed.inject(MatDialog);
    const dialogRefMock = { afterClosed: () => of(false) };
    jest.spyOn(matDialog, 'open').mockReturnValue(dialogRefMock as never);
    component.coders = [
      { id: 1, name: 'Ada' },
      { id: 2, name: 'Bea' }
    ];
    const firstSnapshot = {
      version: 1 as const,
      source: 'initial_creation' as const,
      createdAt: '2026-01-01T00:00:00.000Z',
      distributionSeed: 'seed-1',
      selectedVariables: [{ unitName: 'Unit 1', variableId: 'Var 1' }],
      selectedVariableBundles: [],
      selectedCoders: [{ coderId: 1, capacityPercent: 100 }],
      settings: { caseOrderingMode: 'continuous' as const },
      distributionByCoderId: { 'Unit 1::Var 1': { 1: 3 } },
      doubleCodingInfo: {
        'Unit 1::Var 1': {
          totalCases: 3,
          distinctCases: 3,
          codingTasksTotal: 3,
          doubleCodedCases: 0,
          singleCodedCasesAssigned: 3,
          doubleCodedCasesPerCoderId: { 1: 0 }
        }
      },
      aggregationInfo: {},
      matchingFlags: [],
      pairDistribution: {},
      tasksPerCoder: { 1: 3 },
      coderWeights: { 1: 1 },
      jobs: []
    };
    const latestSnapshot = {
      ...firstSnapshot,
      source: 'refresh' as const,
      createdAt: '2026-01-02T00:00:00.000Z',
      distributionByCoderId: { 'Unit 1::Var 1': { 1: 2, 2: 1 } },
      selectedCoders: [
        { coderId: 1, capacityPercent: 100 },
        { coderId: 2, capacityPercent: 100 }
      ]
    };

    component.viewDistributionSummary({
      id: 42,
      status: 'approved',
      assignedVariables: [{ unitName: 'Unit 1', variableId: 'Var 1' }],
      assignedCoders: [1, 2],
      createdJobsCount: 2,
      distributionSnapshots: [firstSnapshot, latestSnapshot]
    });

    expect(matDialog.open).toHaveBeenCalledWith(
      JobDefinitionDistributionSummaryDialogComponent,
      expect.objectContaining({
        data: expect.objectContaining({
          definitionId: 42,
          snapshot: latestSnapshot,
          coders: component.coders,
          createdJobsCount: 2
        })
      })
    );
  });

  it('opens a clear missing-history dialog for old definitions without snapshots', () => {
    const matDialog = TestBed.inject(MatDialog);
    const dialogRefMock = { afterClosed: () => of(false) };
    jest.spyOn(matDialog, 'open').mockReturnValue(dialogRefMock as never);

    component.viewDistributionSummary({
      id: 43,
      status: 'approved',
      assignedVariables: [{ unitName: 'Unit 1', variableId: 'Var 1' }],
      assignedCoders: [1],
      createdJobsCount: 1
    });

    expect(matDialog.open).toHaveBeenCalledWith(
      JobDefinitionDistributionSummaryDialogComponent,
      expect.objectContaining({
        data: expect.objectContaining({
          definitionId: 43,
          snapshot: undefined,
          createdJobsCount: 1
        })
      })
    );
  });

  it('exports the latest distribution snapshot as CSV', () => {
    const blob = new Blob(['csv'], { type: 'text/csv' });
    const codingJobBackendService = TestBed.inject(CodingJobBackendService) as unknown as {
      exportJobDefinitionDistributionCsv: jest.Mock;
    };
    const createObjectUrl = jest.fn().mockReturnValue('blob:distribution');
    const revokeObjectUrl = jest.fn();
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation();

    Object.defineProperty(window.URL, 'createObjectURL', {
      value: createObjectUrl,
      configurable: true
    });
    Object.defineProperty(window.URL, 'revokeObjectURL', {
      value: revokeObjectUrl,
      configurable: true
    });
    codingJobBackendService.exportJobDefinitionDistributionCsv.mockReturnValue(of(blob));

    component.exportDistributionCsv({
      id: 42,
      status: 'approved',
      assignedVariables: [{ unitName: 'Unit 1', variableId: 'Var 1' }],
      assignedCoders: [1],
      createdJobsCount: 2,
      distributionSnapshots: [{
        version: 1,
        source: 'initial_creation',
        createdAt: '2026-01-01T00:00:00.000Z',
        distributionSeed: 'seed',
        selectedVariables: [],
        selectedVariableBundles: [],
        selectedCoders: [{ coderId: 1, capacityPercent: 100 }],
        settings: {},
        distributionByCoderId: { 'Unit 1::Var 1': { 1: 2 } },
        doubleCodingInfo: {},
        aggregationInfo: {},
        matchingFlags: [],
        pairDistribution: {},
        tasksPerCoder: {},
        coderWeights: {},
        jobs: []
      }]
    });

    expect(codingJobBackendService.exportJobDefinitionDistributionCsv).toHaveBeenCalledWith(1, 42);
    expect(createObjectUrl).toHaveBeenCalledWith(blob);
    expect(click).toHaveBeenCalled();
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:distribution');

    click.mockRestore();
  });

  it('shows a clear message instead of exporting old definitions without snapshots', () => {
    const codingJobBackendService = TestBed.inject(CodingJobBackendService) as unknown as {
      exportJobDefinitionDistributionCsv: jest.Mock;
    };
    const snackBar = TestBed.inject(MatSnackBar) as unknown as { open: jest.Mock };

    component.exportDistributionCsv({
      id: 43,
      status: 'approved',
      assignedVariables: [{ unitName: 'Unit 1', variableId: 'Var 1' }],
      assignedCoders: [1],
      createdJobsCount: 1
    });

    expect(codingJobBackendService.exportJobDefinitionDistributionCsv).not.toHaveBeenCalled();
    expect(snackBar.open).toHaveBeenCalledWith(
      'coding-job-definitions.messages.snackbar.distribution-export-missing',
      'common.close',
      { duration: 5000 }
    );
  });

  it('opens a redistribution preview and applies it after confirmation', async () => {
    const preview: JobDefinitionRefreshPreviewDto = {
      jobDefinitionId: 42,
      existingJobsCount: 2,
      staleJobsCount: 1,
      existingCases: 5,
      plannedCases: 6,
      retainedCases: 5,
      addedCases: 1,
      removedCases: 0,
      addedCodingTasks: 1,
      removedCodingTasks: 2,
      canApply: true
    };
    const codingJobBackendService = TestBed.inject(CodingJobBackendService) as unknown as {
      previewJobDefinitionRefresh: jest.Mock;
      applyJobDefinitionRefresh: jest.Mock;
    };
    const matDialog = TestBed.inject(MatDialog);
    const dialogRefMock = { afterClosed: () => of(true) };

    codingJobBackendService.previewJobDefinitionRefresh.mockReturnValue(of(preview));
    codingJobBackendService.applyJobDefinitionRefresh.mockReturnValue(of({
      success: true,
      message: 'ok',
      preview,
      jobsCreated: 2
    }));
    jest.spyOn(matDialog, 'open').mockReturnValue(dialogRefMock as never);

    await component.refreshDefinition({
      id: 42,
      status: 'approved',
      assignedVariables: [{ unitName: 'UNIT', variableId: 'VAR' }],
      assignedCoders: [1],
      createdJobsCount: 2
    });

    expect(codingJobBackendService.previewJobDefinitionRefresh).toHaveBeenCalledWith(1, 42);
    expect(matDialog.open).toHaveBeenCalledWith(
      JobDefinitionRefreshDialogComponent,
      expect.objectContaining({
        data: {
          definitionId: 42,
          preview
        }
      })
    );
    expect(codingJobBackendService.applyJobDefinitionRefresh).toHaveBeenCalledWith(1, 42);
  });

  it('does not apply redistribution when the preview is blocked', async () => {
    const preview: JobDefinitionRefreshPreviewDto = {
      jobDefinitionId: 42,
      existingJobsCount: 2,
      staleJobsCount: 0,
      existingCases: 5,
      plannedCases: 6,
      retainedCases: 5,
      addedCases: 1,
      removedCases: 0,
      addedCodingTasks: 1,
      removedCodingTasks: 0,
      canApply: false,
      blockingReason: 'Bereits bearbeitet'
    };
    const codingJobBackendService = TestBed.inject(CodingJobBackendService) as unknown as {
      previewJobDefinitionRefresh: jest.Mock;
      applyJobDefinitionRefresh: jest.Mock;
    };
    const matDialog = TestBed.inject(MatDialog);
    const dialogRefMock = { afterClosed: () => of(false) };

    codingJobBackendService.previewJobDefinitionRefresh.mockReturnValue(of(preview));
    jest.spyOn(matDialog, 'open').mockReturnValue(dialogRefMock as never);

    await component.refreshDefinition({
      id: 42,
      status: 'approved',
      assignedVariables: [{ unitName: 'UNIT', variableId: 'VAR' }],
      assignedCoders: [1],
      createdJobsCount: 2
    });

    expect(matDialog.open).toHaveBeenCalledWith(
      JobDefinitionRefreshDialogComponent,
      expect.objectContaining({
        data: {
          definitionId: 42,
          preview
        }
      })
    );
    expect(codingJobBackendService.applyJobDefinitionRefresh).not.toHaveBeenCalled();
  });

  it('creates distributed jobs from an approved definition with all definition settings', async () => {
    const coderService = TestBed.inject(CoderService) as unknown as { getCoders: jest.Mock };
    const codingJobBackendService = TestBed.inject(CodingJobBackendService) as unknown as {
      createCodingJobFromDefinition: jest.Mock;
      previewCodingJobFromDefinition: jest.Mock;
      updateCodingJob: jest.Mock;
    };
    const matDialog = TestBed.inject(MatDialog);
    const assignedVariables = [{ unitName: 'Unit 1', variableId: 'Var 1' }];
    const previewVariables = [{ unitName: 'Unit 1', variableId: 'Var 1', includeDeriveError: true }];
    const assignedVariableBundles = [{
      id: 9,
      name: 'Bundle A',
      caseOrderingMode: 'alternating' as const,
      variables: [{ unitName: 'Unit 2', variableId: 'Var 2' }],
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z')
    }];

    coderService.getCoders.mockClear();
    coderService.getCoders.mockReturnValue(throwError(() => new Error('coder loading failed')));
    codingJobBackendService.createCodingJobFromDefinition.mockReturnValue(of({
      success: true,
      jobsCreated: 1,
      message: 'created',
      jobs: [{ jobId: 111 }]
    }));
    codingJobBackendService.previewCodingJobFromDefinition.mockReturnValue(of({
      distribution: { 'bundle:9': { Ada: 4, Bea: 3 } },
      distributionByCoderId: { 'bundle:9': { 1: 4, 2: 3 } },
      doubleCodingInfo: {
        'bundle:9': {
          totalCases: 7,
          distinctCases: 7,
          codingTasksTotal: 7,
          doubleCodedCases: 0,
          singleCodedCasesAssigned: 7,
          doubleCodedCasesPerCoder: { Ada: 0, Bea: 0 }
        }
      },
      aggregationInfo: {},
      matchingFlags: [],
      warnings: [],
      pairDistribution: {},
      tasksPerCoder: { 1: 4, 2: 3 },
      coderWeights: { 1: 1.5, 2: 0.5 },
      selectedVariables: previewVariables,
      selectedVariableBundles: [{
        id: 9,
        name: 'Bundle A',
        caseOrderingMode: 'alternating' as const,
        variables: [{ unitName: 'Unit 2', variableId: 'Var 2', includeDeriveError: true }]
      }],
      selectedCoders: [
        {
          id: 2,
          name: 'Bea',
          username: 'Bea',
          capacityPercent: 50
        },
        {
          id: 1,
          name: 'Ada',
          username: 'Ada',
          capacityPercent: 150
        }
      ]
    }));
    const dialogRefMock = {
      afterClosed: () => of({
        confirmed: true,
        showScore: false,
        allowComments: true,
        suppressGeneralInstructions: true
      })
    };
    jest.spyOn(matDialog, 'open').mockReturnValue(dialogRefMock as never);

    await component.createCodingJobFromDefinition({
      id: 42,
      status: 'approved',
      assignedVariables,
      assignedVariableBundles,
      assignedCoders: [2, 1],
      assignedCoderConfigs: [
        { coderId: 2, capacityPercent: 50 },
        { coderId: 1, capacityPercent: 150 }
      ],
      doubleCodingAbsolute: 1,
      caseOrderingMode: 'continuous',
      maxCodingCases: 7,
      distributionSeed: 'seed-42',
      showScore: false,
      allowComments: false,
      suppressGeneralInstructions: true,
      createdJobsCount: 0
    });

    expect(matDialog.open).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({
      data: expect.objectContaining({
        selectedVariables: previewVariables,
        selectedVariableBundles: [{
          id: 9,
          name: 'Bundle A',
          caseOrderingMode: 'alternating',
          variables: [{ unitName: 'Unit 2', variableId: 'Var 2', includeDeriveError: true }]
        }],
        selectedCoders: [
          { id: 1, name: 'Ada', capacityPercent: 150 },
          { id: 2, name: 'Bea', capacityPercent: 50 }
        ],
        doubleCodingAbsolute: 1,
        caseOrderingMode: 'continuous',
        maxCodingCases: 7,
        distributionSeed: 'seed-42',
        distribution: { 'bundle:9': { Ada: 4, Bea: 3 } },
        distributionByCoderId: { 'bundle:9': { 1: 4, 2: 3 } },
        doubleCodingInfo: {
          'bundle:9': {
            totalCases: 7,
            distinctCases: 7,
            codingTasksTotal: 7,
            doubleCodedCases: 0,
            singleCodedCasesAssigned: 7,
            doubleCodedCasesPerCoder: { Ada: 0, Bea: 0 }
          }
        },
        warnings: [],
        displayOptions: {
          showScore: false,
          allowComments: false,
          suppressGeneralInstructions: true
        },
        displayOptionsLocked: true
      })
    }));
    expect(codingJobBackendService.previewCodingJobFromDefinition).toHaveBeenCalledWith(
      1,
      42
    );
    expect(coderService.getCoders).not.toHaveBeenCalled();
    expect(codingJobBackendService.createCodingJobFromDefinition).toHaveBeenCalledWith(
      1,
      42
    );
    expect(codingJobBackendService.updateCodingJob).not.toHaveBeenCalled();
  });

  it('shows a preview error without opening the bulk creation dialog', async () => {
    const coderService = TestBed.inject(CoderService) as unknown as { getCoders: jest.Mock };
    const codingJobBackendService = TestBed.inject(CodingJobBackendService) as unknown as {
      createCodingJobFromDefinition: jest.Mock;
      previewCodingJobFromDefinition: jest.Mock;
    };
    const matDialog = TestBed.inject(MatDialog);
    const snackBar = TestBed.inject(MatSnackBar) as unknown as { open: jest.Mock };
    jest.spyOn(matDialog, 'open');

    coderService.getCoders.mockReturnValue(of([{ id: 1, name: 'Ada' }]));
    codingJobBackendService.previewCodingJobFromDefinition.mockReturnValue(
      throwError(() => new Error('preview failed'))
    );

    await component.createCodingJobFromDefinition({
      id: 42,
      status: 'approved',
      assignedVariables: [{ unitName: 'Unit 1', variableId: 'Var 1' }],
      assignedCoders: [1],
      createdJobsCount: 0
    });

    expect(codingJobBackendService.previewCodingJobFromDefinition).toHaveBeenCalledWith(1, 42);
    expect(matDialog.open).not.toHaveBeenCalled();
    expect(codingJobBackendService.createCodingJobFromDefinition).not.toHaveBeenCalled();
    expect(snackBar.open).toHaveBeenCalledWith(
      'coding-job-definitions.messages.snackbar.create-preview-failed',
      'common.close',
      { duration: 5000 }
    );
  });

  it('passes saved display options into the edit dialog', () => {
    const matDialog = TestBed.inject(MatDialog);
    const dialogRefMock = { afterClosed: () => of(false) };
    jest.spyOn(matDialog, 'open').mockReturnValue(dialogRefMock as never);

    component.editDefinition({
      id: 24,
      status: 'draft',
      assignedVariables: [{ unitName: 'Unit', variableId: 'Var' }],
      assignedCoders: [1],
      assignedCoderConfigs: [{ coderId: 1, capacityPercent: 75 }],
      caseOrderingMode: 'continuous',
      showScore: false,
      allowComments: false,
      suppressGeneralInstructions: true,
      createdJobsCount: 0
    });

    expect(matDialog.open).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({
      data: expect.objectContaining({
        codingJob: expect.objectContaining({
          showScore: false,
          allowComments: false,
          suppressGeneralInstructions: true,
          assignedCoderConfigs: [{ coderId: 1, capacityPercent: 75 }]
        })
      })
    }));
  });
});
