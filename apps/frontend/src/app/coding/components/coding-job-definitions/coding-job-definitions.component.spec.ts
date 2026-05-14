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
      assignedCoders: [1]
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

  it('creates distributed jobs from an approved definition with all definition settings', async () => {
    const coderService = TestBed.inject(CoderService) as unknown as { getCoders: jest.Mock };
    const distributedCodingService = TestBed.inject(DistributedCodingService) as unknown as {
      createDistributedCodingJobs: jest.Mock;
    };
    const codingJobBackendService = TestBed.inject(CodingJobBackendService) as unknown as {
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
    distributedCodingService.createDistributedCodingJobs.mockReturnValue(of({
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
      doubleCodingAbsolute: 1,
      caseOrderingMode: 'continuous',
      maxCodingCases: 7
    });

    expect(matDialog.open).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({
      data: expect.objectContaining({
        selectedVariables: assignedVariables,
        selectedVariableBundles: assignedVariableBundles,
        selectedCoders: [
          { id: 1, name: 'Ada' },
          { id: 2, name: 'Bea' }
        ],
        doubleCodingAbsolute: 1,
        caseOrderingMode: 'continuous',
        maxCodingCases: 7
      })
    }));
    expect(distributedCodingService.createDistributedCodingJobs).toHaveBeenCalledWith(
      1,
      assignedVariables,
      [
        { id: 1, name: 'Ada', username: 'Ada' },
        { id: 2, name: 'Bea', username: 'Bea' }
      ],
      1,
      undefined,
      assignedVariableBundles,
      'continuous',
      7,
      42
    );
    expect(codingJobBackendService.updateCodingJob).toHaveBeenCalledWith(1, 111, {
      showScore: false,
      allowComments: true,
      suppressGeneralInstructions: true
    });
  });
});
