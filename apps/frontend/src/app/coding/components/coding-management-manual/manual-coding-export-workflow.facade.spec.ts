import { Component, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { BehaviorSubject, Subject, of } from 'rxjs';
import { GermanTranslationsTestingModule } from '../../../../testing/german-translations';
import { AppService } from '../../../core/services/app.service';
import { ExportJobService } from '../../../shared/services/file/export-job.service';
import { JobDefinition } from '../../services/coding-job-backend.service';
import { ManualCodingExportDialogResult } from '../manual-coding-export-dialog/manual-coding-export-dialog.component';
import { ManualCodingExportScopeFacade } from './manual-coding-export-scope.facade';
import { ManualCodingExportFacade } from './manual-coding-export.facade';
import { ManualCodingExportWorkflowFacade } from './manual-coding-export-workflow.facade';

@Component({ template: '', providers: [ManualCodingExportFacade, ManualCodingExportWorkflowFacade] })
class ExportWorkflowHost {
  readonly workflow = inject(ManualCodingExportWorkflowFacade);
}

describe('ManualCodingExportWorkflowFacade', () => {
  let app: { selectedWorkspaceId: number; selectedWorkspaceId$: BehaviorSubject<number>; userId: number };
  let jobs: { startJob: jest.Mock; estimateJob: jest.Mock };
  let dialog: { open: jest.Mock };
  let choice: Subject<ManualCodingExportDialogResult>;
  let close: jest.Mock;

  beforeEach(() => {
    app = { selectedWorkspaceId: 5, selectedWorkspaceId$: new BehaviorSubject(5), userId: 9 };
    jobs = {
      startJob: jest.fn(() => of({ jobId: 'export' })),
      estimateJob: jest.fn(() => of({ unitVariableCount: 1200, worksheetLimit: 1000, exceedsWorksheetLimit: true }))
    };
    choice = new Subject();
    close = jest.fn();
    dialog = { open: jest.fn(() => ({ afterClosed: () => choice, close })) };
    TestBed.configureTestingModule({
      imports: [ExportWorkflowHost, GermanTranslationsTestingModule],
      providers: [
        { provide: AppService, useValue: app },
        { provide: ExportJobService, useValue: jobs },
        { provide: MatDialog, useValue: dialog },
        { provide: MatSnackBar, useValue: { open: jest.fn() } },
        {
          provide: ManualCodingExportScopeFacade,
          useValue: {
            coders: signal([]),
            ensureCodersReady: () => true,
            ensureDefinitionsReady: () => true,
            getDefinitions: (rendered: object[] | undefined) => rendered ?? []
          }
        }
      ]
    });
  });

  it('keeps the definition scope selected when opening the dialog', () => {
    const host = TestBed.createComponent(ExportWorkflowHost);
    const definitions: JobDefinition[] = [{ id: 11, status: 'approved' }];
    host.componentInstance.workflow.openExecutionExport(definitions);
    definitions.splice(0, 1, { id: 22, status: 'approved' });
    choice.next({ exportType: 'detailed' });
    choice.complete();
    expect(jobs.startJob).toHaveBeenCalledWith(5, expect.objectContaining({ jobDefinitionIds: [11], userId: 9 }));
  });

  it.each(['workspace', 'destroy'] as const)('closes selection and discards late decisions on %s', context => {
    const host = TestBed.createComponent(ExportWorkflowHost);
    host.componentInstance.workflow.openExecutionExport([{ id: 11, status: 'approved' }]);
    if (context === 'destroy') host.destroy();
    else {
      app.selectedWorkspaceId = 6;
      app.selectedWorkspaceId$.next(6);
      app.selectedWorkspaceId = 5;
      app.selectedWorkspaceId$.next(5);
    }
    expect(close).toHaveBeenCalled();
    choice.next({ exportType: 'detailed' });
    expect(jobs.startJob).not.toHaveBeenCalled();
  });

  it('closes an outstanding worksheet warning when the owning view ends', () => {
    const warning = new Subject<true | 'compact' | false>();
    const closeWarning = jest.fn();
    dialog.open.mockReturnValueOnce({ afterClosed: () => choice, close })
      .mockReturnValueOnce({ afterClosed: () => warning, close: closeWarning });
    const host = TestBed.createComponent(ExportWorkflowHost);
    host.componentInstance.workflow.openExecutionExport([{ id: 11, status: 'approved' }]);
    choice.next({ exportType: 'aggregated', doubleCodingMethod: 'new-row-per-variable' });
    choice.complete();
    expect(dialog.open).toHaveBeenCalledTimes(2);
    host.destroy();
    expect(closeWarning).toHaveBeenCalled();
    warning.next(true);
    expect(jobs.startJob).not.toHaveBeenCalled();
  });
});
