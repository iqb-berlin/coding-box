import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateModule } from '@ngx-translate/core';
import { of, Subject } from 'rxjs';
import { VariableBundleManagerComponent } from './variable-bundle-manager.component';
import { VariableBundleService, PaginatedBundles } from '../../services/variable-bundle.service';
import { CodingJobBackendService } from '../../services/coding-job-backend.service';
import { AppService } from '../../../core/services/app.service';
import { Variable, VariableBundle } from '../../models/coding-job.model';

const bundle: VariableBundle = {
  id: 7, name: 'Current bundle', variables: [], createdAt: new Date(), updatedAt: new Date()
};

describe('Variable bundle request ownership without ZoneJS', () => {
  let fixture: ComponentFixture<VariableBundleManagerComponent>;
  let workspace: { selectedWorkspaceId: number; selectedWorkspaceId$: Subject<number> };
  let lists: Subject<PaginatedBundles>[];
  let preparations: Subject<Variable[]>[];
  let result: Subject<VariableBundle | boolean>;
  let dialogs: { open: jest.Mock };
  let close: jest.Mock;
  let service: { getBundles: jest.Mock; createBundle: jest.Mock; updateBundle: jest.Mock; deleteBundle: jest.Mock };
  let snackBar: { open: jest.Mock };

  beforeEach(async () => {
    workspace = { selectedWorkspaceId: 5, selectedWorkspaceId$: new Subject<number>() };
    lists = [];
    preparations = [];
    result = new Subject<VariableBundle | boolean>();
    close = jest.fn();
    dialogs = { open: jest.fn(() => ({ afterClosed: () => result, close })) };
    service = {
      getBundles: jest.fn(() => { const reply = new Subject<PaginatedBundles>(); lists.push(reply); return reply; }),
      createBundle: jest.fn(() => of(bundle)),
      updateBundle: jest.fn(() => of(bundle)),
      deleteBundle: jest.fn(() => of(true))
    };
    snackBar = { open: jest.fn() };
    await TestBed.configureTestingModule({
      imports: [VariableBundleManagerComponent, TranslateModule.forRoot()],
      providers: [
        provideZonelessChangeDetection(),
        { provide: AppService, useValue: workspace },
        { provide: VariableBundleService, useValue: service },
        { provide: MatDialog, useValue: dialogs },
        { provide: MatSnackBar, useValue: snackBar },
        {
          provide: CodingJobBackendService,
          useValue: {
            getCodingIncompleteVariables: () => {
              const reply = new Subject<Variable[]>(); preparations.push(reply); return reply;
            }
          }
        }
      ]
    }).overrideProvider(MatDialog, { useValue: dialogs }).compileComponents();
    fixture = TestBed.createComponent(VariableBundleManagerComponent);
    fixture.autoDetectChanges();
    await fixture.whenStable();
  });

  afterEach(() => fixture.destroy());

  function switchWorkspace(id: number): void {
    workspace.selectedWorkspaceId = id;
    workspace.selectedWorkspaceId$.next(id);
  }

  it('renders only the latest list and clears an empty replacement', async () => {
    fixture.componentInstance.loadVariableBundleGroups();
    expect(lists[0].observed).toBe(false);
    lists[0].next({
      bundles: [{ ...bundle, name: 'Stale bundle' }], total: 1, page: 1, limit: 10000
    });
    expect(fixture.componentInstance.isLoading()).toBe(true);
    lists[1].next({
      bundles: [bundle], total: 1, page: 1, limit: 10000
    });
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Current bundle');
    expect(fixture.nativeElement.textContent).not.toContain('Stale bundle');
    fixture.componentInstance.loadVariableBundleGroups();
    lists[2].next({
      bundles: [], total: 0, page: 1, limit: 10000
    });
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).not.toContain('Current bundle');
  });

  it('cancels preparation on a workspace round trip without opening a late dialog', () => {
    fixture.componentInstance.createVariableBundleGroup();
    switchWorkspace(6);
    switchWorkspace(5);
    expect(preparations[0].observed).toBe(false);
    preparations[0].next([]);
    preparations[0].error(new Error('late failure'));
    expect(dialogs.open).not.toHaveBeenCalled();
    expect(snackBar.open).not.toHaveBeenCalled();
    expect(lists[0].observed).toBe(false);
    expect(lists[1].observed).toBe(false);
    expect(lists[2].observed).toBe(true);
  });

  it.each(['create', 'edit', 'delete'])('ignores a late %s confirmation after a workspace round trip', action => {
    const component = fixture.componentInstance;
    if (action === 'create') component.createVariableBundleGroup();
    if (action === 'edit') component.editVariableBundleGroup(bundle);
    if (action === 'delete') component.deleteVariableBundleGroup(bundle);
    if (action !== 'delete') preparations[0].next([]);
    expect(dialogs.open).toHaveBeenCalledTimes(1);
    switchWorkspace(6);
    switchWorkspace(5);
    expect(close).toHaveBeenCalledTimes(1);
    result.next(action === 'delete' ? true : bundle);
    expect(service.createBundle).not.toHaveBeenCalled();
    expect(service.updateBundle).not.toHaveBeenCalled();
    expect(service.deleteBundle).not.toHaveBeenCalled();
  });

  it('closes its owned dialog and prevents mutation when the manager is destroyed', () => {
    fixture.componentInstance.deleteVariableBundleGroup(bundle);
    fixture.destroy();
    expect(close).toHaveBeenCalledTimes(1);
    expect(result.observed).toBe(false);
    result.next(true);
    expect(service.deleteBundle).not.toHaveBeenCalled();
    expect(lists[0].observed).toBe(false);
  });
});
