import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { WorkspacesSelectionComponent } from './workspaces-selection.component';
import { WorkspaceBackendService } from '../../../workspace/services/workspace-backend.service';

describe('WorkspacesSelectionComponent', () => {
  let fixture: ComponentFixture<WorkspacesSelectionComponent>;
  let getWorkspaces: jest.Mock;

  const selectedIds = () => fixture.componentInstance.tableSelectionCheckboxes.selected.map(workspace => workspace.id);
  const checkboxes = () => Array.from(
    fixture.nativeElement.querySelectorAll('mat-row input[type="checkbox"]')
  ) as HTMLInputElement[];

  beforeEach(async () => {
    getWorkspaces = jest.fn(() => of({
      data: [{ id: 2, name: 'Workspace 2' }, { id: 3, name: 'Workspace 3' }],
      total: 2,
      page: 1,
      limit: 20
    }));
    await TestBed.configureTestingModule({
      imports: [WorkspacesSelectionComponent, TranslateModule.forRoot()],
      providers: [
        provideZonelessChangeDetection(),
        { provide: WorkspaceBackendService, useValue: { getAllWorkspacesListOrFail: getWorkspaces } }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(WorkspacesSelectionComponent);
    fixture.componentRef.setInput('selectedWorkspacesIds', [2]);
    fixture.componentRef.setInput('workspacesChanged', false);
    await fixture.whenStable();
  });

  it('renders new preselection with the same number of selected workspaces', async () => {
    const selections: number[][] = [];
    fixture.componentInstance.workspaceSelectionChanged.subscribe(workspaces => {
      selections.push(workspaces.map(workspace => workspace.id));
    });
    expect(checkboxes().map(checkbox => checkbox.checked)).toEqual([true, false]);

    fixture.componentRef.setInput('selectedWorkspacesIds', [3]);
    await fixture.whenStable();

    expect(selectedIds()).toEqual([3]);
    expect(selections).toEqual([[3]]);
    expect(checkboxes().map(checkbox => checkbox.checked)).toEqual([false, true]);
    expect(getWorkspaces).toHaveBeenCalledTimes(1);
  });

  it('renders empty and multiple preselection without reloading the workspace list', async () => {
    fixture.componentRef.setInput('selectedWorkspacesIds', []);
    await fixture.whenStable();
    expect(checkboxes().map(checkbox => checkbox.checked)).toEqual([false, false]);

    fixture.componentRef.setInput('selectedWorkspacesIds', [2, 3]);
    await fixture.whenStable();
    expect(checkboxes().map(checkbox => checkbox.checked)).toEqual([true, true]);
    expect(getWorkspaces).toHaveBeenCalledTimes(1);
  });
});
