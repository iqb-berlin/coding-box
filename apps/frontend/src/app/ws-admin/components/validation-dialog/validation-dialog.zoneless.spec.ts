import { By } from '@angular/platform-browser';
import { TranslateModule } from '@ngx-translate/core';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { provideHttpClient } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import * as csvExport from './shared/validation-export.util';
import {
  VariablesValidationPanelComponent, VariableTypesValidationPanelComponent, ResponseStatusValidationPanelComponent, GroupResponsesValidationPanelComponent, DuplicateResponsesValidationPanelComponent
} from './panels';
import { ValidationDialogComponent } from './validation-dialog.component';
import { AppService } from '../../../core/services/app.service';
import { SERVER_URL } from '../../../injection-tokens';
import {
  ValidationTaskStateService, ValidationType
} from '../../../shared/services/validation/validation-task-state.service';

const panels: [ValidationType, string][] = [
  ['testTakers', 'test-takers'],
  ['variables', 'variables'],
  ['variableTypes', 'variable-types'],
  ['responseStatus', 'response-status'],
  ['groupResponses', 'group-responses'],
  ['duplicateResponses', 'duplicate-responses']
];

describe('Validation panels inside their real parent dialog', () => {
  let fixture: ComponentFixture<ValidationDialogComponent>;
  let state: ValidationTaskStateService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ValidationDialogComponent, TranslateModule.forRoot()],
      providers: [
        provideHttpClient(), provideHttpClientTesting(), provideNoopAnimations(), provideZonelessChangeDetection(),
        { provide: AppService, useValue: { selectedWorkspaceId: 5 } },
        { provide: SERVER_URL, useValue: 'http://localhost/api' },
        { provide: MAT_DIALOG_DATA, useValue: {} },
        { provide: MatSnackBar, useValue: { open: jest.fn() } },
        { provide: MatDialogRef, useValue: { close: jest.fn() } }
      ]
    }).compileComponents();
    state = TestBed.inject(ValidationTaskStateService);
    fixture = TestBed.createComponent(ValidationDialogComponent);
    fixture.autoDetectChanges();
    await fixture.whenStable();
  });

  it('cancels the XML request when the validation dialog is destroyed', () => {
    const http = TestBed.inject(HttpTestingController);
    fixture.componentInstance.showUnitXml('UNIT');
    const pending = http.expectOne(request => request.url.endsWith('/unit/UNIT/content'));
    fixture.destroy();
    expect(pending.cancelled).toBe(true);
    expect(document.querySelector('coding-box-content-dialog')).toBeNull();
    expect(TestBed.inject(MatSnackBar).open).not.toHaveBeenCalled();
    http.verify();
  });

  it('renders a delayed XML response in the real content dialog', async () => {
    const http = TestBed.inject(HttpTestingController);
    const dialogs = TestBed.inject(MatDialog);
    fixture.componentInstance.showUnitXml('UNIT');
    expect(document.querySelector('coding-box-content-dialog')).toBeNull();
    http.expectOne(request => request.url.endsWith('/unit/UNIT/content'))
      .flush({ content: '<Unit><Metadata><Id>DELAYED_UNIT</Id></Metadata></Unit>' });
    await fixture.whenStable();
    try {
      const content = document.querySelector('coding-box-content-dialog');
      expect(content?.textContent).toContain('Unit XML: UNIT');
      expect(content?.querySelector('coding-box-xml-viewer')).not.toBeNull();
      expect(content?.textContent).toContain('DELAYED_UNIT');
      http.verify();
    } finally {
      dialogs.closeAll();
      await fixture.whenStable();
    }
  });

  function finishAcceptedJobAfterClose(http: HttpTestingController, type: ValidationType): void {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'requestAnimationFrame', 'setTimeout', 'clearTimeout'] });
    try {
      const task = {
        id: 101, workspace_id: 5, validation_type: 'deleteAllResponses', status: 'pending'
      };
      http.expectOne(request => request.method === 'POST').flush(task);
      fixture.destroy();
      TestBed.inject(AppService).selectedWorkspaceId = 6;
      state.setValidationResult(6, type, { status: 'success', timestamp: 2, details: { marker: 'other workspace' } });
      jest.advanceTimersByTime(2000);
      http.expectOne(request => request.url.includes('/workspace/5/') && request.url.endsWith('/validation-tasks/101'))
        .flush({ ...task, status: 'completed', progress: 100 });
      expect(state.getAllTaskIds(5)[type]).toBeFalsy();
      expect(state.getAllValidationResults(6)[type].details).toEqual({ marker: 'other workspace' });
      expect(TestBed.inject(MatSnackBar).open).not.toHaveBeenCalled();
      http.expectNone(request => request.method === 'POST');
      http.verify();
    } finally {
      jest.useRealTimers();
    }
  }

  function finishMutationAndRefresh(http: HttpTestingController): void {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'requestAnimationFrame', 'setTimeout', 'clearTimeout'] });
    try {
      for (const id of [101, 102]) {
        const creation = http.expectOne(request => request.method === 'POST');
        const task = {
          id,
          workspace_id: 5,
          validation_type: creation.request.params.get('type'),
          status: 'pending',
          progress: 0
        };
        creation.flush(task);
        jest.advanceTimersByTime(2000);
        http.expectOne(request => request.url.endsWith(`/validation-tasks/${id}`))
          .flush({ ...task, status: 'completed', progress: 100 });
      }
      http.expectOne(request => request.url.endsWith('/validation-tasks/102/results'))
        .flush({
          data: [], total: 0, page: 1, limit: 10
        });
    } finally {
      jest.useRealTimers();
    }
  }

  it.each(panels)('renders delayed %s failure through the parent notification', async (type, selector) => {
    state.setValidationResult(5, type, {
      status: 'failed', timestamp: 1, details: { error: `Delayed ${type} failure` }
    });
    await fixture.whenStable();
    const panel: HTMLElement = fixture.nativeElement.querySelector(`coding-box-${selector}-validation-panel`);
    expect(panel.textContent).toContain(`Delayed ${type} failure`);
  });

  it.each(panels)('renders delayed %s task progress and completion', async (type, selector) => {
    for (const progress of [10, 55, 100]) {
      state.setTaskId(5, type, {
        id: 1,
        workspace_id: 5,
        validation_type: type,
        status: 'processing',
        progress,
        progress_message: `Step ${progress}`,
        created_at: new Date(0),
        updated_at: new Date(0)
      });
      await fixture.whenStable();
      const panel: HTMLElement = fixture.nativeElement.querySelector(`coding-box-${selector}-validation-panel`);
      expect(panel.textContent).toContain(`(${progress}%)`);
    }
    state.removeTaskId(5, type);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector(':scope > .info-banner')).toBeNull();
  });
  describe.each([
    ['variables', VariablesValidationPanelComponent],
    ['variableTypes', VariableTypesValidationPanelComponent],
    ['responseStatus', ResponseStatusValidationPanelComponent]
  ] as const)('%s pagination', (type, panelType) => {
    it('does not publish an old page into a newly opened workspace dialog', async () => {
      const panel = fixture.debugElement.query(By.directive(panelType));
      const http = TestBed.inject(HttpTestingController);
      panel.componentInstance.onPageChange({ pageIndex: 1, pageSize: 10, length: 20 });
      const pending = http.expectOne(request => request.url.includes('/workspace/5/'));
      TestBed.inject(AppService).selectedWorkspaceId = 6;
      const currentResult = {
        status: 'failed' as const,
        timestamp: 2,
        details: {
          data: [{
            responseId: 6, fileName: 'CURRENT_WORKSPACE', variableId: 'v', value: 'x'
          }],
          total: 1,
          page: 1,
          limit: 10
        }
      };
      state.setValidationResult(6, type, currentResult);
      const current = TestBed.createComponent(ValidationDialogComponent);
      current.autoDetectChanges();
      await current.whenStable();
      try {
        const currentPanel = current.debugElement.query(By.directive(panelType));
        expect(currentPanel.nativeElement.textContent).toContain('CURRENT_WORKSPACE');
        pending.flush({
          data: [{
            responseId: 5, fileName: 'OLD_WORKSPACE', variableId: 'v', value: 'y'
          }],
          total: 20,
          page: 2,
          limit: 10
        });
        await current.whenStable();
        expect(currentPanel.nativeElement.textContent).toContain('CURRENT_WORKSPACE');
        expect(currentPanel.nativeElement.textContent).not.toContain('OLD_WORKSPACE');
        expect(state.getAllValidationResults(6)[type]).toEqual(currentResult);
        expect(state.getAllValidationResults(5)[type].details).toMatchObject({ page: 2 });
        http.verify();
      } finally {
        current.destroy();
      }
    });

    it.each(['error', 'success'] as const)('releases the table after delayed page %s in the real dialog', async outcome => {
      state.setValidationResult(5, type, {
        status: 'failed',
        timestamp: 1,
        details: {
          data: [{
            responseId: 1, fileName: 'UNIT', variableId: 'v', value: 'x'
          }],
          total: 20,
          page: 1,
          limit: 10
        }
      });
      await fixture.whenStable();
      const panel = fixture.debugElement.query(By.directive(panelType));
      panel.componentInstance.onPageChange({ pageIndex: 1, pageSize: 10, length: 20 });
      fixture.changeDetectorRef.markForCheck();
      await fixture.whenStable();
      expect(panel.nativeElement.querySelector('.table-loading')).not.toBeNull();
      const http = TestBed.inject(HttpTestingController);
      const request = http.expectOne(() => true);
      if (outcome === 'error') request.flush('failure', { status: 500, statusText: 'Failure' });
      else {
        request.flush({
          data: [{
            responseId: 2, fileName: 'NEXT', variableId: 'v', value: 'y'
          }],
          total: 20,
          page: 2,
          limit: 10
        });
      }
      await fixture.whenStable();
      expect(panel.nativeElement.querySelector('.table-loading')).toBeNull();
      if (outcome === 'success') expect(panel.nativeElement.textContent).toContain('NEXT');
      http.verify();
    });
  });
  it.each([GroupResponsesValidationPanelComponent, DuplicateResponsesValidationPanelComponent])(
    'releases delayed page failures for %p', async panelType => {
      const panel = fixture.debugElement.query(By.directive(panelType));
      panel.componentInstance.onPageChange({ pageIndex: 1, pageSize: 10, length: 20 });
      fixture.changeDetectorRef.markForCheck();
      await fixture.whenStable();
      expect(panel.nativeElement.querySelector('.loading-fade')).not.toBeNull();
      const http = TestBed.inject(HttpTestingController);
      http.expectOne(() => true).flush('failure', { status: 500, statusText: 'Failure' });
      await fixture.whenStable();
      expect(panel.nativeElement.querySelector('.loading-fade')).toBeNull();
      http.verify();
    });
  describe.each([
    ['variables', VariablesValidationPanelComponent],
    ['variableTypes', VariableTypesValidationPanelComponent],
    ['responseStatus', ResponseStatusValidationPanelComponent],
    ['groupResponses', GroupResponsesValidationPanelComponent],
    ['duplicateResponses', DuplicateResponsesValidationPanelComponent]
  ] as const)('%s page lifecycle', (type, panelType) => {
    const emptyPage = (page: number) => ({
      data: [],
      total: 0,
      page,
      limit: 10,
      groupsWithResponses: [],
      totalGroups: 0,
      totalGroupsWithoutResponses: 0
    });

    it('recovers from an HTTP error with an empty retry response', async () => {
      const panel = fixture.debugElement.query(By.directive(panelType));
      const http = TestBed.inject(HttpTestingController);
      panel.componentInstance.onPageChange({ pageIndex: 1, pageSize: 10, length: 20 });
      fixture.changeDetectorRef.markForCheck();
      await fixture.whenStable();
      http.expectOne(() => true).flush('failure', { status: 500, statusText: 'Failure' });
      await fixture.whenStable();
      expect(panel.nativeElement.querySelector('.table-loading, .loading-fade')).toBeNull();
      panel.componentInstance.onPageChange({ pageIndex: 1, pageSize: 10, length: 20 });
      http.expectOne(() => true).flush(emptyPage(2));
      await fixture.whenStable();
      expect(panel.componentInstance.isLoadingPage()).toBe(false);
      expect(panel.componentInstance.currentPage()).toBe(2);
      expect(panel.nativeElement.querySelector('.table-loading, .loading-fade')).toBeNull();
      expect(panel.nativeElement.textContent).not.toContain('Läuft');
      http.verify();
    });

    it('cancels the previous page request before applying the newer page', async () => {
      const panel = fixture.debugElement.query(By.directive(panelType));
      const http = TestBed.inject(HttpTestingController);
      panel.componentInstance.onPageChange({ pageIndex: 1, pageSize: 10, length: 30 });
      const older = http.expectOne(() => true);
      panel.componentInstance.onPageChange({ pageIndex: 2, pageSize: 10, length: 30 });
      expect(older.cancelled).toBe(true);
      http.expectOne(() => true).flush(emptyPage(3));
      await fixture.whenStable();
      expect(panel.componentInstance.currentPage()).toBe(3);
      expect(panel.nativeElement.querySelector('.table-loading, .loading-fade')).toBeNull();
      http.verify();
    });

    it('cancels pending pagination when the parent dialog is destroyed', () => {
      const panel = fixture.debugElement.query(By.directive(panelType));
      const http = TestBed.inject(HttpTestingController);
      panel.componentInstance.onPageChange({ pageIndex: 1, pageSize: 10, length: 30 });
      const pending = http.expectOne(() => true);
      fixture.destroy();
      expect(pending.cancelled).toBe(true);
      expect(TestBed.inject(MatSnackBar).open).not.toHaveBeenCalled();
      http.verify();
    });

    it('reopens with fresh loading state after cancelling a pending page', async () => {
      const oldPanel = fixture.debugElement.query(By.directive(panelType));
      const http = TestBed.inject(HttpTestingController);
      oldPanel.componentInstance.onPageChange({ pageIndex: 1, pageSize: 10, length: 30 });
      const pending = http.expectOne(() => true);
      fixture.destroy();
      expect(pending.cancelled).toBe(true);
      fixture = TestBed.createComponent(ValidationDialogComponent);
      fixture.autoDetectChanges();
      await fixture.whenStable();
      const reopened = fixture.debugElement.query(By.directive(panelType));
      expect(reopened.componentInstance.isLoadingPage()).toBe(false);
      expect(reopened.nativeElement.querySelector('.table-loading, .loading-fade')).toBeNull();
      state.setValidationResult(5, type, { status: 'failed', timestamp: 2, details: { error: 'Fresh result' } });
      await fixture.whenStable();
      expect(reopened.nativeElement.textContent).toContain('Fresh result');
      http.verify();
    });
  });
  describe.each([
    ['variables', VariablesValidationPanelComponent],
    ['variableTypes', VariableTypesValidationPanelComponent],
    ['responseStatus', ResponseStatusValidationPanelComponent],
    ['groupResponses', GroupResponsesValidationPanelComponent],
    ['duplicateResponses', DuplicateResponsesValidationPanelComponent]
  ] as const)('%s CSV export', (type, panelType) => {
    it('releases the CSV action after failure and completes a retry', async () => {
      state.setValidationResult(5, type, {
        status: 'failed',
        timestamp: 1,
        details: {
          data: [{
            responseId: 1, fileName: 'UNIT', unitName: 'UNIT', variableId: 'v', value: 'x', duplicates: []
          }],
          total: 1,
          page: 1,
          limit: 10,
          groupsWithResponses: [{ group: 'G', hasResponse: false }],
          totalGroupsWithoutResponses: 1
        }
      });
      await fixture.whenStable();
      const panel = fixture.debugElement.query(By.directive(panelType));
      const button = Array.from(panel.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
        .find(element => element.textContent?.includes('CSV exportieren'))!;
      button.click();
      await fixture.whenStable();
      expect(button.disabled).toBe(true);
      const http = TestBed.inject(HttpTestingController);
      http.expectOne(() => true).flush('failure', { status: 500, statusText: 'Failure' });
      await fixture.whenStable();
      expect(button.disabled).toBe(false);
      expect(button.textContent).toContain('CSV exportieren');
      const download = jest.spyOn(csvExport, 'downloadCsvFile').mockImplementation(() => {});
      try {
        button.click();
        await fixture.whenStable();
        expect(button.disabled).toBe(true);
        http.expectOne(() => true).flush(state.getAllValidationResults(5)[type].details);
        await fixture.whenStable();
        expect(panel.nativeElement.textContent).not.toContain('Export...');
        expect(panel.componentInstance.isExporting()).toBe(false);
        expect(download).toHaveBeenCalledTimes(1);
        http.verify();
      } finally {
        download.mockRestore();
      }
    });
  });
  describe.each([
    ['variables', VariablesValidationPanelComponent],
    ['variableTypes', VariableTypesValidationPanelComponent],
    ['responseStatus', ResponseStatusValidationPanelComponent]
  ] as const)('%s deletion recovery', (type, panelType) => {
    it.each(['Alle löschen', 'Ausgewählte löschen'].flatMap(label => [
      { label, accepted: false }, { label, accepted: true }
    ]))('closes $label safely with accepted=$accepted', async ({ label, accepted }) => {
      state.setValidationResult(5, type, {
        status: 'failed',
        timestamp: 1,
        details: {
          data: [{
            responseId: 1, fileName: 'UNIT', variableId: 'v', value: 'x'
          }],
          total: 1,
          page: 1,
          limit: 10
        }
      });
      await fixture.whenStable();
      const panel = fixture.debugElement.query(By.directive(panelType));
      const buttons = () => Array.from(panel.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>);
      buttons().find(button => button.textContent?.includes('Alle auswählen'))!.click();
      await fixture.whenStable();
      buttons().find(button => button.textContent?.includes(label))!.click();
      await fixture.whenStable();
      const http = TestBed.inject(HttpTestingController);
      if (accepted) finishAcceptedJobAfterClose(http, type);
      else {
        const request = http.expectOne(() => true);
        fixture.destroy();
        expect(request.cancelled).toBe(true);
        expect(TestBed.inject(MatSnackBar).open).not.toHaveBeenCalled();
        http.verify();
      }
    });

    it.each(['Alle löschen', 'Ausgewählte löschen'])('releases %s after a delayed failure', async label => {
      state.setValidationResult(5, type, {
        status: 'failed',
        timestamp: 1,
        details: {
          data: [{
            responseId: 1, fileName: 'UNIT', variableId: 'v', value: 'x'
          }],
          total: 1,
          page: 1,
          limit: 10
        }
      });
      await fixture.whenStable();
      const panel = fixture.debugElement.query(By.directive(panelType));
      const buttons = () => Array.from(panel.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>);
      buttons().find(button => button.textContent?.includes('Alle auswählen'))!.click();
      await fixture.whenStable();
      const button = buttons().find(element => element.textContent?.includes(label))!;
      button.click();
      await fixture.whenStable();
      expect(button.disabled).toBe(true);
      const http = TestBed.inject(HttpTestingController);
      http.expectOne(() => true).flush('failure', { status: 500, statusText: 'Failure' });
      await fixture.whenStable();
      expect(button.disabled).toBe(false);
      expect(button.textContent).toContain(label);
      button.click();
      await fixture.whenStable();
      expect(button.disabled).toBe(true);
      finishMutationAndRefresh(http);
      await fixture.whenStable();
      expect(panel.componentInstance.isDeletingResponses()).toBe(false);
      expect(panel.nativeElement.textContent).not.toContain('UNIT');
      expect(state.getAllValidationResults(5)[type].status).toBe('success');
      http.verify();
    });
  });
  describe('duplicate resolution lifecycle', () => {
    beforeEach(async () => {
      state.setValidationResult(5, 'duplicateResponses', {
        status: 'failed',
        timestamp: 1,
        details: {
          data: [{
            unitName: 'UNIT',
            variableId: 'v',
            testTakerLogin: 'synthetic',
            duplicates: [{ responseId: 1, value: 'a' }, { responseId: 2, value: 'b' }]
          }],
          total: 1,
          page: 1,
          limit: 10
        }
      });
      await fixture.whenStable();
      const panel = fixture.debugElement.query(By.directive(DuplicateResponsesValidationPanelComponent));
      const buttons = Array.from(panel.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>);
      buttons.find(button => button.textContent?.includes('Vorschlag übernehmen'))!.click();
      await fixture.whenStable();
    });

    function resolveButton(label: string): HTMLButtonElement {
      const panel = fixture.debugElement.query(By.directive(DuplicateResponsesValidationPanelComponent));
      return Array.from(panel.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
        .find(button => button.textContent?.trim().startsWith(label))!;
    }

    it.each(['Alle automatisch auflösen', 'Ausgewählte behalten', 'Auflösen'])(
      'reenables %s after an HTTP error', async label => {
        const button = resolveButton(label);
        button.click();
        await fixture.whenStable();
        expect(button.disabled).toBe(true);
        const http = TestBed.inject(HttpTestingController);
        http.expectOne(() => true).flush('failure', { status: 500, statusText: 'Failure' });
        await fixture.whenStable();
        expect(button.disabled).toBe(false);
        button.click();
        await fixture.whenStable();
        expect(button.disabled).toBe(true);
        finishMutationAndRefresh(http);
        await fixture.whenStable();
        const panel = fixture.debugElement.query(By.directive(DuplicateResponsesValidationPanelComponent));
        expect(panel.componentInstance.isResolvingDuplicates()).toBe(false);
        expect(panel.nativeElement.textContent).not.toContain('UNIT');
        expect(state.getAllValidationResults(5).duplicateResponses.status).toBe('success');
        http.verify();
      }
    );

    it.each(['Alle automatisch auflösen', 'Ausgewählte behalten', 'Auflösen'])(
      'finishes accepted %s after closing without updating the destroyed dialog', async label => {
        resolveButton(label).click();
        await fixture.whenStable();
        finishAcceptedJobAfterClose(TestBed.inject(HttpTestingController), 'duplicateResponses');
      }
    );

    it.each(['Alle automatisch auflösen', 'Ausgewählte behalten', 'Auflösen'])(
      'cancels %s when the parent dialog is destroyed', async label => {
        resolveButton(label).click();
        await fixture.whenStable();
        const http = TestBed.inject(HttpTestingController);
        const request = http.expectOne(() => true);
        fixture.destroy();
        expect(request.cancelled).toBe(true);
        expect(TestBed.inject(MatSnackBar).open).not.toHaveBeenCalled();
        http.verify();
      }
    );
  });
});
