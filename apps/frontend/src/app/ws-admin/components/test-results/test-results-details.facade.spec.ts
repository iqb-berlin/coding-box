import { Component, inject } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
  BehaviorSubject, Subject, of, throwError
} from 'rxjs';
import de from '../../../../assets/i18n/de.json';
import { UnitNoteDto } from '../../../../../../../api-dto/unit-notes/unit-note.dto';
import { AppService } from '../../../core/services/app.service';
import { TestResultService } from '../../../shared/services/test-result/test-result.service';
import { UnitNoteService } from '../../../shared/services/unit/unit-note.service';
import { Booklet, TestResultPerson, Unit } from './test-results.models';
import { TestResultsDetailsFacade } from './test-results-details.facade';

@Component({ template: '{{details.testPerson()?.code}}', providers: [TestResultsDetailsFacade] })
class DetailsHost { readonly details = inject(TestResultsDetailsFacade); }
const person = (id: number): TestResultPerson => ({
  id, code: `P${id}`, group: 'G', login: 'L', uploaded_at: new Date()
});
const unit = (id: number): Unit => ({
  id,
  bookletid: 3,
  name: `U${id}`,
  alias: null,
  results: [
    {
      id: id * 10, unitid: id, variableid: 'V1', value: 'value', status: 'VALUE_CHANGED', subform: ''
    },
    {
      id: id * 10 + 1, unitid: id, variableid: 'V2', value: '', status: 'DISPLAYED', subform: ''
    }
  ],
  logs: [],
  tags: []
});
const booklet = (units: Unit[], id = 3): Booklet => ({
  id, personid: 2, name: `B${id}`, size: units.length, logs: [], units
});
const note = (unitId: number): UnitNoteDto => ({
  id: unitId, unitId, note: `Notiz ${unitId}`, createdAt: new Date(0), updatedAt: new Date(0)
});

describe('TestResultsDetailsFacade', () => {
  let fixture: ComponentFixture<DetailsHost>;
  let details: TestResultsDetailsFacade;
  let app: { selectedWorkspaceId: number; selectedWorkspaceId$: BehaviorSubject<number> };
  let results: { getPersonTestResults: jest.Mock };
  let notes: { getUnitNotes: jest.Mock; getNotesForMultipleUnits: jest.Mock };
  let snack: { open: jest.Mock };
  const changeWorkspace = (id: number): void => { app.selectedWorkspaceId = id; app.selectedWorkspaceId$.next(id); };
  beforeEach(() => {
    app = { selectedWorkspaceId: 5, selectedWorkspaceId$: new BehaviorSubject(5) };
    results = { getPersonTestResults: jest.fn().mockReturnValue(of([])) };
    notes = { getUnitNotes: jest.fn().mockReturnValue(of([])), getNotesForMultipleUnits: jest.fn().mockReturnValue(of({})) };
    snack = { open: jest.fn() };
    TestBed.configureTestingModule({
      imports: [DetailsHost, TranslateModule.forRoot()],
      providers: [
        { provide: AppService, useValue: app }, { provide: TestResultService, useValue: results },
        { provide: UnitNoteService, useValue: notes }, { provide: MatSnackBar, useValue: snack }
      ]
    });
    const translate = TestBed.inject(TranslateService); translate.setTranslation('de', de); translate.use('de');
    fixture = TestBed.createComponent(DetailsHost); details = fixture.componentInstance.details; fixture.detectChanges();
  });
  afterEach(() => fixture.destroy());

  it('replaces a delayed person request, sorts immutably, and renders only the latest person', async () => {
    const old = new Subject<Booklet[]>(); const latest = new Subject<Booklet[]>();
    results.getPersonTestResults.mockReturnValueOnce(old).mockReturnValueOnce(latest);
    details.onRowClick(person(1)); details.onRowClick(person(2)); expect(old.observed).toBe(false);
    const unsorted = [booklet([unit(8), unit(7)], 4), booklet([], 3)]; latest.next(unsorted); latest.complete(); old.next([booklet([unit(9)])]);
    await fixture.whenStable(); expect(fixture.nativeElement.textContent).toContain('P2');
    expect(details.booklets().map(b => b.id)).toEqual([3, 4]); expect(details.booklets()[1].units.map(u => u.id)).toEqual([7, 8]);
    expect(unsorted[0].units.map(u => u.id)).toEqual([8, 7]); expect(details.isLoadingBooklets()).toBe(false);
  });

  it.each(['workspace', 'destroy'] as const)('cancels a pending person request on %s before it can repopulate details', target => {
    const pending = new Subject<Booklet[]>(); results.getPersonTestResults.mockReturnValue(pending); details.onRowClick(person(1));
    if (target === 'workspace') { changeWorkspace(6); changeWorkspace(5); } else fixture.destroy();
    expect(pending.observed).toBe(false); pending.next([booklet([unit(7)])]);
    expect(details.booklets()).toEqual([]); expect(notes.getNotesForMultipleUnits).not.toHaveBeenCalled();
    if (target === 'workspace') { expect(details.testPerson()).toBeNull(); expect(details.isLoadingBooklets()).toBe(false); }
  });

  it('cancels old unit notes when selecting another unit and clears the old notes while loading', () => {
    const old = new Subject<UnitNoteDto[]>(); const latest = new Subject<UnitNoteDto[]>();
    notes.getUnitNotes.mockReturnValueOnce(old).mockReturnValueOnce(latest);
    const b = booklet([unit(7), unit(8)]); details.onUnitClick(b.units[0], b); details.unitNotes.set([note(7)]);
    details.onUnitClick(b.units[1], b); expect(old.observed).toBe(false); expect(details.unitNotes()).toEqual([]);
    latest.next([note(8)]); latest.complete(); old.next([note(7)]);
    expect(details.unitNotes()).toEqual([note(8)]); expect(details.unitNotesMap().has(7)).toBe(false);
    expect(details.unitNotesMap().get(8)).toEqual([note(8)]);
  });

  it.each(['reset', 'workspace', 'destroy'] as const)('cancels pending unit notes after %s', target => {
    const pending = new Subject<UnitNoteDto[]>(); notes.getUnitNotes.mockReturnValue(pending);
    const b = booklet([unit(7)]); details.onUnitClick(b.units[0], b);
    if (target === 'reset') details.resetSelectedResultDetails(); else if (target === 'workspace') { changeWorkspace(6); changeWorkspace(5); } else fixture.destroy();
    expect(pending.observed).toBe(false); pending.next([note(7)]); expect(details.unitNotes()).toEqual([]); expect(details.unitNotesMap().size).toBe(0);
  });

  it('cancels the previous person batch notes when another person is selected', () => {
    const pending = new Subject<Record<number, UnitNoteDto[]>>(); notes.getNotesForMultipleUnits.mockReturnValueOnce(pending).mockReturnValue(of({ 8: [note(8)] }));
    results.getPersonTestResults.mockReturnValueOnce(of([booklet([unit(7)])])).mockReturnValueOnce(of([booklet([unit(8)])]));
    details.onRowClick(person(1)); details.onRowClick(person(2)); expect(pending.observed).toBe(false); pending.next({ 7: [note(7)] });
    expect(details.unitNotesMap().has(7)).toBe(false); expect(details.unitNotesMap().get(8)).toEqual([note(8)]);
  });

  it('removes a deleted unit without changing existing snapshots and cancels its pending notes', () => {
    const pending = new Subject<UnitNoteDto[]>(); notes.getUnitNotes.mockReturnValue(pending);
    const first = booklet([unit(7), unit(8)]); const other = booklet([unit(9)], 4); details.booklets.set([first, other]);
    details.onUnitClick(first.units[0], first); details.unitNotesMap.set(new Map([[7, [note(7)]]])); details.removeUnit(7, 3);
    expect(details.booklets()[0].units.map(u => u.id)).toEqual([8]); expect(first.units.map(u => u.id)).toEqual([7, 8]);
    expect(details.booklets()[1]).toBe(other); expect(details.selectedUnit()).toBeUndefined(); expect(details.responses()).toEqual([]);
    expect(details.unitNotesMap().has(7)).toBe(false); expect(pending.observed).toBe(false);
    pending.next([note(7)]); expect(details.unitNotes()).toEqual([]);
  });

  it('does not restore a deleted unit in the notes cache when an older batch request completes', () => {
    const pending = new Subject<Record<number, UnitNoteDto[]>>(); notes.getNotesForMultipleUnits.mockReturnValue(pending);
    details.booklets.set([booklet([unit(7), unit(8)])]); details.loadAllUnitNotes(); details.removeUnit(7, 3);
    pending.next({ 7: [note(7)], 8: [note(8)] });
    expect(details.unitNotesMap().has(7)).toBe(false); expect(details.unitNotesMap().get(8)).toEqual([note(8)]);
  });

  it('removes a response from the visible list and stored unit tree so reselection cannot resurrect it', () => {
    const b = booklet([unit(7), unit(8)]); details.booklets.set([b]); details.onUnitClick(b.units[0], b);
    const oldResponses = details.responses(); details.removeResponse(70);
    expect(details.responses().map(r => r.id)).toEqual([71]); expect(details.selectedUnit()?.results.map(r => r.id)).toEqual([71]);
    expect(b.units[0].results.map(r => r.id)).toEqual([70, 71]); expect(oldResponses.map(r => r.id)).toEqual([70, 71]);
    const remaining = details.booklets()[0]; details.onUnitClick(remaining.units[1], remaining); details.onUnitClick(remaining.units[0], remaining);
    expect(details.responses().map(r => r.id)).toEqual([71]);
  });

  it('keeps the current unit intact when a deletion from a previously selected unit completes', () => {
    const b = booklet([unit(7), unit(8)]); details.booklets.set([b]); details.onUnitClick(b.units[1], b);
    details.removeUnit(7, 3); expect(details.selectedUnit()?.id).toBe(8); expect(details.responses().map(r => r.id)).toEqual([80, 81]);
    details.removeResponse(70); expect(details.responses().map(r => r.id)).toEqual([80, 81]);
  });

  it('opens a quick-search target through the same person request lifetime and expands the matched variable', () => {
    results.getPersonTestResults.mockReturnValue(of([booklet([unit(7)])]));
    details.openQuickSearchBrowserTarget({
      personId: 2, bookletId: 3, unitId: 7, kind: 'response', variableId: 'V2'
    });
    expect(results.getPersonTestResults).toHaveBeenCalledWith(5, 2); expect(details.testPerson()?.id).toBe(2);
    expect(details.selectedBooklet()).toBe('B3'); expect(details.selectedUnit()?.id).toBe(7); expect(details.responses().find(r => r.expanded)?.id).toBe(71);
  });

  it('allows selecting a person again after a load failure', () => {
    results.getPersonTestResults.mockReturnValueOnce(throwError(() => new Error('offline'))).mockReturnValue(of([booklet([unit(7)])]));
    details.onRowClick(person(2)); expect(details.isLoadingBooklets()).toBe(false); expect(snack.open).toHaveBeenCalled();
    details.onRowClick(person(2)); expect(details.booklets()).toHaveLength(1); expect(details.isLoadingBooklets()).toBe(false);
  });
});
