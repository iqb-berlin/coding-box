import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { provideHttpClient } from '@angular/common/http';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { OverlayContainer } from '@angular/cdk/overlay';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of } from 'rxjs';

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
      updateCodingJob: jest.Mock;
    };
    const matDialog = TestBed.inject(MatDialog);
    const assignedVariables = [{ unitName: 'Unit 1', variableId: 'Var 1' }];
    const assignedVariableBundles = [{
      id: 9,
      name: 'Bundle A',
      caseOrderingMode: 'alternating' as const,
      variables: [{ unitName: 'Unit 2', variableId: 'Var 2' }],
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z')
    }];

    coderService.getCoders.mockReturnValue(of([
      { id: 1, name: 'Ada' },
      { id: 2, name: 'Bea' },
      { id: 3, name: 'Chris' }
    ]));
    codingJobBackendService.createCodingJobFromDefinition.mockReturnValue(of({
      success: true,
      jobsCreated: 1,
      message: 'created',
      jobs: [{ jobId: 111 }]
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
        selectedVariables: assignedVariables,
        selectedVariableBundles: assignedVariableBundles,
        selectedCoders: [
          { id: 1, name: 'Ada', capacityPercent: 150 },
          { id: 2, name: 'Bea', capacityPercent: 50 }
        ],
        doubleCodingAbsolute: 1,
        caseOrderingMode: 'continuous',
        maxCodingCases: 7,
        distributionSeed: 'seed-42',
        displayOptions: {
          showScore: false,
          allowComments: false,
          suppressGeneralInstructions: true
        },
        displayOptionsLocked: true
      })
    }));
    expect(codingJobBackendService.createCodingJobFromDefinition).toHaveBeenCalledWith(
      1,
      42
    );
    expect(codingJobBackendService.updateCodingJob).not.toHaveBeenCalled();
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
