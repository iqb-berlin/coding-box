import { provideZonelessChangeDetection, Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Subject } from 'rxjs';
import { AppService } from '../../core/services/app.service';
import { FileService } from '../../shared/services/file/file.service';
import { ResponseService } from '../../shared/services/response/response.service';
import { TestResultService } from '../../shared/services/test-result/test-result.service';
import { UnitService } from '../../shared/services/unit/unit.service';
import { UnitSearchDialogComponent } from './unit-search-dialog/unit-search-dialog.component';
import { BookletSearchDialogComponent } from './booklet-search-dialog/booklet-search-dialog.component';

const searchRow = {
  unitId: 1,
  unitName: 'Delayed unit',
  unitAlias: 'U1',
  tags: [],
  responses: [],
  responseId: 1,
  response: 'V1',
  responseValue: 'Delayed answer',
  responseStatus: 'VALUE_CHANGED',
  unit: 'Delayed unit',
  bookletId: 1,
  bookletName: 'Delayed booklet',
  booklet: 'Delayed booklet',
  units: [],
  personId: 1,
  personLogin: 'login',
  personCode: 'code',
  personGroup: 'group',
  login: 'login',
  code: 'code',
  group: 'group'
};

async function setup<T>(component: Type<T>, initialSearch?: string) {
  const response = new Subject<{ data: typeof searchRow[]; total: number }>();
  const search = jest.fn(() => response);
  const confirmation = new Subject<boolean>();
  const deletion = new Subject<{ success: boolean; report: { deletedUnit: number; warnings: string[] } }>();
  const dialog = { open: jest.fn(() => ({ afterClosed: () => confirmation })) };
  await TestBed.configureTestingModule({
    imports: [component, TranslateModule.forRoot()],
    providers: [
      provideZonelessChangeDetection(),
      { provide: MAT_DIALOG_DATA, useValue: { title: 'Search', initialSearch } },
      { provide: MatDialogRef, useValue: { close: jest.fn() } },
      { provide: MatDialog, useValue: dialog },
      { provide: MatSnackBar, useValue: { open: jest.fn() } },
      { provide: Router, useValue: {} },
      { provide: AppService, useValue: { selectedWorkspaceId: 17 } },
      { provide: FileService, useValue: {} },
      { provide: ResponseService, useValue: {} },
      { provide: UnitService, useValue: { deleteUnit: () => deletion } },
      {
        provide: TestResultService,
        useValue: {
          searchUnitsByName: search, searchBookletsByName: search, getFlatResponses: search, deleteBooklet: () => deletion
        }
      }
    ]
  });
  TestBed.overrideProvider(MatDialog, { useValue: dialog });
  await TestBed.compileComponents();
  const translate = TestBed.inject(TranslateService);
  translate.setTranslation('de', { paginator: { getRangeLabel: '{{startIndex}}–{{endIndex}} von {{length}}' } });
  translate.use('de');
  const fixture = TestBed.createComponent(component);
  await fixture.whenStable();
  return {
    fixture, response, search, dialog, confirmation, deletion
  };
}

async function waitForSearch(search: jest.Mock): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!search.mock.calls.length && Date.now() < deadline) {
    await new Promise(resolve => { setTimeout(resolve, 20); });
  }
  expect(search).toHaveBeenCalledTimes(1);
}

async function beginUnitSearch(mode: 'unit' | 'response' | 'booklet') {
  const context = await setup(UnitSearchDialogComponent);
  const { fixture, search } = context;
  const buttons = fixture.nativeElement.querySelectorAll('.search-mode-toggle button') as NodeListOf<HTMLButtonElement>;
  buttons[{ unit: 0, response: 1, booklet: 2 }[mode]].click();
  await fixture.whenStable();
  const input = fixture.nativeElement.querySelector('.search-container input') as HTMLInputElement;
  input.value = 'Delayed';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await waitForSearch(search);
  await fixture.whenStable();
  expect(fixture.nativeElement.querySelector('.loading-container')).not.toBeNull();
  return context;
}

describe('OnPush search dialogs without Zone.js', () => {
  it.each(['unit', 'response', 'booklet'] as const)('renders delayed %s results and the paginator without a further event', async mode => {
    const { fixture, response } = await beginUnitSearch(mode);
    response.next({ data: [searchRow], total: 31 });
    response.complete();
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.loading-container')).toBeNull();
    expect(element.querySelector('tr.mat-mdc-row')?.textContent).toContain('Delayed');
    expect(element.querySelector('mat-paginator')?.textContent).toContain('31');
    fixture.destroy();
  });

  it.each(['unit', 'response', 'booklet'] as const)('renders a delayed %s failure as an empty result and stops loading', async mode => {
    const { fixture, response } = await beginUnitSearch(mode);
    response.error(new Error('Search failed'));
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.loading-container')).toBeNull();
    expect(fixture.nativeElement.querySelector('.no-results')?.textContent).toContain('Keine Ergebnisse');
    fixture.destroy();
  });

  it('discards an older unit response when a new search starts', async () => {
    const { fixture, response, search } = await beginUnitSearch('unit');
    const newer = new Subject<{ data: typeof searchRow[]; total: number }>();
    search.mockReturnValue(newer);
    fixture.componentInstance.searchUnits('New unit');
    newer.next({ data: [{ ...searchRow, unitName: 'Current unit' }], total: 1 });
    await fixture.whenStable();
    response.next({ data: [searchRow], total: 31 });
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('tr.mat-mdc-row')?.textContent).toContain('Current unit');
    expect(fixture.componentInstance.totalItems()).toBe(1);
    expect(response.observed).toBe(false);
    fixture.destroy();
  });

  it('cancels an active request when changing search mode', async () => {
    const { fixture, response } = await beginUnitSearch('unit');
    (fixture.nativeElement.querySelectorAll('.search-mode-toggle button')[2] as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(response.observed).toBe(false);
    response.next({ data: [searchRow], total: 31 });
    await fixture.whenStable();
    expect(fixture.componentInstance.totalItems()).toBe(0);
    expect(fixture.nativeElement.querySelector('.loading-container')).toBeNull();
    fixture.destroy();
  });

  it('updates rows and the empty state after a delayed confirmed unit deletion', async () => {
    const {
      fixture, response, confirmation, deletion
    } = await beginUnitSearch('unit');
    response.next({ data: [searchRow], total: 1 });
    await fixture.whenStable();
    const buttons = Array.from(fixture.nativeElement.querySelectorAll('.mat-column-actions button') as NodeListOf<HTMLButtonElement>);
    buttons.find(button => button.textContent?.includes('delete'))!.click();
    await fixture.whenStable();
    confirmation.next(true);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.loading-container')).not.toBeNull();
    deletion.next({ success: true, report: { deletedUnit: 1, warnings: [] } });
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('tr.mat-mdc-row')).toBeNull();
    expect(fixture.nativeElement.querySelector('.no-results')).not.toBeNull();
    fixture.destroy();
  });

  it('cancels pending debounce and requests when destroying the unit dialog', async () => {
    const { fixture, response, search } = await beginUnitSearch('unit');
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    input.value = 'Queued search';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.destroy();
    await new Promise(resolve => { setTimeout(resolve, 550); });
    expect(search).toHaveBeenCalledTimes(1);
    expect(response.observed).toBe(false);
  });

  it('renders delayed standalone booklet results, a deletion, and a failed retry', async () => {
    const {
      fixture, response, search, confirmation, deletion
    } = await setup(BookletSearchDialogComponent, 'Delayed');
    expect(fixture.nativeElement.querySelector('.loading-container')).not.toBeNull();
    response.next({ data: [searchRow], total: 31 });
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('tr.mat-mdc-row')?.textContent).toContain('Delayed booklet');
    expect(fixture.nativeElement.querySelector('mat-paginator')?.textContent).toContain('31');
    const buttons = Array.from(fixture.nativeElement.querySelectorAll('.mat-column-actions button') as NodeListOf<HTMLButtonElement>);
    buttons.find(button => button.textContent?.includes('delete'))!.click();
    confirmation.next(true);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.loading-container')).not.toBeNull();
    deletion.next({ success: true, report: { deletedUnit: 1, warnings: [] } });
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('tr.mat-mdc-row')).toBeNull();
    expect(fixture.nativeElement.querySelector('.no-results')).not.toBeNull();
    const retry = new Subject<{ data: typeof searchRow[]; total: number }>();
    search.mockReturnValue(retry);
    fixture.componentInstance.searchBooklets('Retry');
    await fixture.whenStable();
    retry.error(new Error('Unavailable'));
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.loading-container')).toBeNull();
    expect(fixture.nativeElement.querySelector('.no-results')).not.toBeNull();
    fixture.destroy();
  });

  it('cancels older booklet searches and the active request on destruction', async () => {
    const { fixture, response, search } = await setup(BookletSearchDialogComponent, 'Delayed');
    const newer = new Subject<{ data: typeof searchRow[]; total: number }>();
    search.mockReturnValue(newer);
    fixture.componentInstance.searchBooklets('Current');
    newer.next({ data: [{ ...searchRow, bookletName: 'Current booklet' }], total: 1 });
    response.next({ data: [searchRow], total: 31 });
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('tr.mat-mdc-row')?.textContent).toContain('Current booklet');
    expect(response.observed).toBe(false);
    fixture.destroy();
    expect(newer.observed).toBe(false);
  });
});
