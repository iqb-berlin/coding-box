import { provideHttpClient } from '@angular/common/http';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { of, Subject } from 'rxjs';

import { CodingJobDefinitionsComponent } from './coding-job-definitions.component';
import { CodingJobBackendService } from '../../services/coding-job-backend.service';
import { CoderService } from '../../services/coder.service';
import { CodingJobService } from '../../services/coding-job.service';
import { AppService } from '../../../core/services/app.service';
import { SERVER_URL } from '../../../injection-tokens';
import { environment } from '../../../../environments/environment';

describe('CodingJobDefinitionsComponent in zoneless mode', () => {
  async function createBulkWorkflow() {
    const appService = { selectedWorkspaceId: 1 };
    const backend = {
      getJobDefinitions: jest.fn().mockReturnValue(of([])),
      previewCodingJobFromDefinition: jest.fn().mockReturnValue(of({
        selectedCoders: [{ id: 11, name: 'Coder' }],
        selectedVariables: [],
        selectedVariableBundles: [],
        distribution: {},
        distributionByCoderId: {},
        doubleCodingInfo: {},
        warnings: []
      })),
      createCodingJobFromDefinition: jest.fn().mockReturnValue(of({ success: true, jobsCreated: 1 }))
    };
    const dialog = { open: jest.fn() };
    const snackBar = { open: jest.fn() };
    const jobsCreated = jest.fn();
    await TestBed.configureTestingModule({
      imports: [CodingJobDefinitionsComponent, TranslateModule.forRoot()],
      providers: [
        provideZonelessChangeDetection(), provideHttpClient(),
        { provide: SERVER_URL, useValue: environment.backendUrl },
        { provide: AppService, useValue: appService },
        { provide: MatDialog, useValue: dialog },
        { provide: MatSnackBar, useValue: snackBar },
        { provide: CodingJobBackendService, useValue: backend },
        { provide: CodingJobService, useValue: { jobsCreatedEvent: { emit: jobsCreated } } },
        { provide: CoderService, useValue: { getCoders: jest.fn().mockReturnValue(of([])) } }
      ]
    }).compileComponents();
    const fixture = TestBed.createComponent(CodingJobDefinitionsComponent);
    fixture.detectChanges();
    const definition = {
      id: 42,
      name: 'Definition',
      status: 'approved' as const,
      createdJobsCount: 0,
      assignedCoders: [11]
    };
    return {
      fixture, appService, backend, dialog, snackBar, jobsCreated, definition
    };
  }

  it('unsubscribes a pending bulk preview on destroy without opening a dialog or reporting an error', async () => {
    const workflow = await createBulkWorkflow();
    const preview = new Subject<never>();
    workflow.backend.previewCodingJobFromDefinition.mockReturnValue(preview);
    const pending = workflow.fixture.componentInstance.createCodingJobFromDefinition(workflow.definition);
    expect(preview.observed).toBe(true);
    workflow.fixture.destroy();
    await pending;
    expect(preview.observed).toBe(false);
    expect(workflow.dialog.open).not.toHaveBeenCalled();
    expect(workflow.snackBar.open).not.toHaveBeenCalled();
    expect(workflow.backend.createCodingJobFromDefinition).not.toHaveBeenCalled();
  });

  it('discards a completed preview after the selected workspace changes', async () => {
    const workflow = await createBulkWorkflow();
    const preview = new Subject<unknown>();
    workflow.backend.previewCodingJobFromDefinition.mockReturnValue(preview);
    const pending = workflow.fixture.componentInstance.createCodingJobFromDefinition(workflow.definition);
    workflow.appService.selectedWorkspaceId = 2;
    preview.next({ selectedCoders: [{ id: 11, name: 'Old workspace coder' }] });
    await pending;
    expect(workflow.dialog.open).not.toHaveBeenCalled();
    expect(workflow.backend.createCodingJobFromDefinition).not.toHaveBeenCalled();
  });

  it('closes its bulk dialog on destroy and ignores even a late confirmation', async () => {
    const workflow = await createBulkWorkflow();
    const closed = new Subject<{ confirmed: boolean }>();
    const dialogRef = { afterClosed: () => closed, close: jest.fn() };
    workflow.dialog.open.mockReturnValue(dialogRef);
    const pending = workflow.fixture.componentInstance.createCodingJobFromDefinition(workflow.definition);
    await Promise.resolve();
    expect(workflow.dialog.open).toHaveBeenCalledTimes(1);
    workflow.fixture.destroy();
    expect(dialogRef.close).toHaveBeenCalledTimes(1);
    closed.next({ confirmed: true });
    await pending;
    expect(workflow.backend.createCodingJobFromDefinition).not.toHaveBeenCalled();
  });

  it.each(['success', 'error'])(
    "ignores an accepted bulk request's late %s after leaving its workspace",
    async outcome => {
      const workflow = await createBulkWorkflow();
      const creation = new Subject<unknown>();
      workflow.backend.createCodingJobFromDefinition.mockReturnValue(creation);
      workflow.dialog.open.mockReturnValue({ afterClosed: () => of({ confirmed: true }), close: jest.fn() });
      const pending = workflow.fixture.componentInstance.createCodingJobFromDefinition(workflow.definition);
      await Promise.resolve();
      await Promise.resolve();
      expect(workflow.backend.createCodingJobFromDefinition).toHaveBeenCalledWith(1, 42);
      workflow.backend.getJobDefinitions.mockClear();
      workflow.appService.selectedWorkspaceId = 2;
      workflow.fixture.destroy();
      expect(creation.observed).toBe(true);
      if (outcome === 'success') creation.next({ success: true, jobsCreated: 2 });
      else creation.error(new Error('Old workspace failure'));
      await pending;
      expect(workflow.snackBar.open).not.toHaveBeenCalled();
      expect(workflow.backend.getJobDefinitions).not.toHaveBeenCalled();
      expect(workflow.jobsCreated).not.toHaveBeenCalled();
    }
  );

  it('renders a delayed definition response without manual change detection', async () => {
    const definitions = new Subject<[]>();

    await TestBed.configureTestingModule({
      imports: [CodingJobDefinitionsComponent, TranslateModule.forRoot()],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        { provide: SERVER_URL, useValue: environment.backendUrl },
        { provide: MatSnackBar, useValue: { open: jest.fn() } },
        { provide: AppService, useValue: { selectedWorkspaceId: 1 } },
        { provide: CodingJobService, useValue: { jobsCreatedEvent: { emit: jest.fn() } } },
        { provide: CoderService, useValue: { getCoders: jest.fn().mockReturnValue(of([])) } },
        {
          provide: CodingJobBackendService,
          useValue: { getJobDefinitions: jest.fn().mockReturnValue(definitions.asObservable()) }
        }
      ]
    }).compileComponents();

    const fixture = TestBed.createComponent(CodingJobDefinitionsComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.loading-container')).toBeTruthy();

    definitions.next([]);
    definitions.complete();
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('.loading-container')).toBeNull();
    expect(fixture.nativeElement.querySelector('.empty-state button')).toBeTruthy();
  });
});
