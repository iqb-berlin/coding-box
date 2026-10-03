import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { of, Subject } from 'rxjs';
import { WorkspacesSelectionComponent } from './workspaces-selection.component';
import { WorkspaceBackendService } from '../../../workspace/services/workspace-backend.service';

@Component({
  selector: 'coding-box-workspace-refresh-test-host',
  standalone: true,
  imports: [WorkspacesSelectionComponent],
  template: `
    <button (click)="changed.set(true)">Workspace mutation completed</button>
    <coding-box-workspaces-selection
      [workspacesChanged]="changed()"
      [selectedWorkspacesIds]="selected"
      [selectionDisabled]="!ready()"
      (workspacesUpdated)="changed.set(false)"
      (workspaceListReady)="ready.set($event)" />
  `
})
class WorkspaceRefreshHostComponent {
  readonly changed = signal(false);
  readonly ready = signal(false);
  readonly selected: number[] = [];
}

describe('WorkspacesSelectionComponent refresh recovery', () => {
  let fixture: ComponentFixture<WorkspaceRefreshHostComponent>;

  afterEach(() => fixture?.destroy());

  it('retries after a failed refresh while retaining the previous list and disabling access selection', async () => {
    const firstPage = {
      data: [{ id: 1, name: 'First workspace' }], total: 1, page: 1, limit: 20
    };
    const failingRefresh = new Subject<typeof firstPage>();
    const retryRefresh = new Subject<typeof firstPage>();
    const getList = jest.fn()
      .mockReturnValueOnce(of(firstPage))
      .mockReturnValueOnce(failingRefresh)
      .mockReturnValueOnce(retryRefresh);
    await TestBed.configureTestingModule({
      imports: [WorkspaceRefreshHostComponent, TranslateModule.forRoot()],
      providers: [
        provideZonelessChangeDetection(),
        { provide: WorkspaceBackendService, useValue: { getAllWorkspacesListOrFail: getList } }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(WorkspaceRefreshHostComponent);
    await fixture.whenStable();
    expect(getList).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.ready()).toBe(true);

    const element = fixture.nativeElement as HTMLElement;
    const mutate = () => (element.querySelector('button') as HTMLButtonElement).click();
    const firstRow = () => element.querySelector('mat-row') as HTMLElement;
    const firstCheckbox = () => firstRow().querySelector('input[type="checkbox"]') as HTMLInputElement;

    mutate();
    await fixture.whenStable();
    expect(getList).toHaveBeenCalledTimes(2);
    failingRefresh.error(new Error('Temporary HTTP failure'));
    await fixture.whenStable();

    expect(fixture.componentInstance.changed()).toBe(false);
    expect(fixture.componentInstance.ready()).toBe(false);
    expect(firstRow().textContent).toContain('First workspace');
    expect(firstCheckbox().disabled).toBe(true);

    mutate();
    await fixture.whenStable();
    expect(getList).toHaveBeenCalledTimes(3);
    expect(fixture.componentInstance.ready()).toBe(false);
    expect(firstRow().textContent).toContain('First workspace');
    expect(firstCheckbox().disabled).toBe(true);

    retryRefresh.next({
      ...firstPage,
      data: [{ id: 2, name: 'Updated workspace' }]
    });
    retryRefresh.complete();
    await fixture.whenStable();
    expect(fixture.componentInstance.changed()).toBe(false);
    expect(fixture.componentInstance.ready()).toBe(true);
    expect(firstRow().textContent).toContain('Updated workspace');
    expect(firstCheckbox().disabled).toBe(false);
  });
});
