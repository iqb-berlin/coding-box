import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MAT_DIALOG_DATA, MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { WorkspaceProcessesService } from '../../services/workspace-processes.service';
import { ProcessOverviewComponent } from './process-overview.component';
import { ProcessDto } from '../../../../../../../api-dto/workspaces/process-dto';

describe('ProcessOverviewComponent', () => {
  let fixture: ComponentFixture<ProcessOverviewComponent>;
  let component: ProcessOverviewComponent;
  let processesService: {
    getProcesses: jest.Mock;
    deleteProcess: jest.Mock;
  };
  let dialog: {
    open: jest.Mock;
  };
  let snackBar: {
    open: jest.Mock;
  };

  beforeEach(async () => {
    processesService = {
      getProcesses: jest.fn().mockReturnValue(of([])),
      deleteProcess: jest.fn().mockReturnValue(of(true))
    };
    dialog = {
      open: jest.fn().mockReturnValue({ afterClosed: () => of(true) })
    };
    snackBar = {
      open: jest.fn()
    };

    await TestBed.configureTestingModule({
      imports: [
        NoopAnimationsModule,
        TranslateModule.forRoot(),
        ProcessOverviewComponent
      ],
      providers: [
        { provide: WorkspaceProcessesService, useValue: processesService },
        { provide: MatDialog, useValue: dialog },
        { provide: MatSnackBar, useValue: snackBar },
        { provide: MAT_DIALOG_DATA, useValue: { workspaceId: 7 } }
      ]
    }).overrideComponent(ProcessOverviewComponent, {
      add: {
        providers: [
          { provide: WorkspaceProcessesService, useValue: processesService },
          { provide: MatDialog, useValue: dialog },
          { provide: MatSnackBar, useValue: snackBar }
        ]
      }
    }).compileComponents();

    fixture = TestBed.createComponent(ProcessOverviewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('confirms and deletes a removable process', () => {
    const process: ProcessDto = {
      id: 'job-1',
      queueName: 'data-export',
      status: 'waiting',
      progress: 0,
      timestamp: 100
    };

    component.deleteProcess(process);

    expect(dialog.open).toHaveBeenCalled();
    expect(processesService.deleteProcess).toHaveBeenCalledWith(7, 'data-export', 'job-1');
    expect(snackBar.open).toHaveBeenCalledWith(
      'Prozess wurde abgebrochen oder entfernt',
      'OK',
      { duration: 3000 }
    );
  });

  it('allows paused jobs but disables unsupported active jobs', () => {
    expect(component.canRemoveProcess({
      id: 'job-1',
      queueName: 'coding-statistics',
      status: 'paused',
      progress: 0,
      timestamp: 100
    })).toBe(true);

    expect(component.canRemoveProcess({
      id: 'job-2',
      queueName: 'database-export',
      status: 'active',
      progress: 50,
      timestamp: 100
    })).toBe(true);

    expect(component.canRemoveProcess({
      id: 'job-3',
      queueName: 'coding-statistics',
      status: 'active',
      progress: 0,
      timestamp: 100
    })).toBe(false);
  });

  it('keeps the tooltip on a wrapper around disabled action buttons', () => {
    component.processes.data = [{
      id: 'job-2',
      queueName: 'coding-statistics',
      status: 'active',
      progress: 0,
      timestamp: 100
    }];
    fixture.detectChanges();

    const wrapper = fixture.debugElement.query(By.css('.action-tooltip-wrapper'));
    const button = wrapper.query(By.css('button'));

    expect(wrapper).toBeTruthy();
    expect(button.nativeElement.disabled).toBe(true);
  });
});
