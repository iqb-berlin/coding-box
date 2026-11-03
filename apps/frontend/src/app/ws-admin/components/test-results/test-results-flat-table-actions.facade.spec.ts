import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { BehaviorSubject, Subject, of } from 'rxjs';
import { GermanTranslationsTestingModule } from '../../../../testing/german-translations';
import { AppService } from '../../../core/services/app.service';
import { CodingStatisticsService } from '../../../coding/services/coding-statistics.service';
import { FileService } from '../../../shared/services/file/file.service';
import { UnitNoteService } from '../../../shared/services/unit/unit-note.service';
import { ResponseService } from '../../../shared/services/response/response.service';
import { TestResultService } from '../../../shared/services/test-result/test-result.service';
import { FlatResponseRow } from './test-results-flat-table.models';
import { TestResultsFlatTableActionsFacade } from './test-results-flat-table-actions.facade';

describe('flat result table actions', () => {
  const row = {
    responseId: 3, unitId: 4, personId: 5, unit: 'U', booklet: 'B', response: 'v'
  } as FlatResponseRow;
  let workspace: BehaviorSubject<number>;
  let files: { getUnitInfo: jest.Mock };
  let results: { getPersonTestResults: jest.Mock };
  let responses: { deleteResponse: jest.Mock };
  let dialog: { open: jest.Mock };
  let closed: Subject<boolean | undefined>;
  let dialogRef: { afterClosed: () => Subject<boolean | undefined>; close: jest.Mock };
  let facade: TestResultsFlatTableActionsFacade;
  beforeEach(() => {
    workspace = new BehaviorSubject(1);
    closed = new Subject();
    dialogRef = { afterClosed: () => closed, close: jest.fn(() => closed.next(undefined)) };
    dialog = { open: jest.fn(() => dialogRef) };
    files = { getUnitInfo: jest.fn(() => of({ metadata: {} })) };
    results = { getPersonTestResults: jest.fn() };
    responses = { deleteResponse: jest.fn() };
    TestBed.configureTestingModule({
      imports: [GermanTranslationsTestingModule],
      providers: [TestResultsFlatTableActionsFacade,
        { provide: AppService, useValue: { get selectedWorkspaceId() { return workspace.value; }, selectedWorkspaceId$: workspace } },
        { provide: FileService, useValue: files },
        { provide: TestResultService, useValue: results },
        { provide: ResponseService, useValue: responses },
        { provide: UnitNoteService, useValue: {} },
        { provide: CodingStatisticsService, useValue: {} },
        { provide: MatDialog, useValue: dialog },
        { provide: MatSnackBar, useValue: { open: () => ({ dismiss: jest.fn() }) } }]
    });
    facade = TestBed.inject(TestResultsFlatTableActionsFacade);
  });

  it('shares a person request, closes owned dialogs and invalidates the cache across workspaces', () => {
    const pending = new Subject<unknown[]>();
    results.getPersonTestResults.mockReturnValueOnce(pending).mockReturnValue(of([{ name: 'B', units: [{ id: 4, name: 'NEW' }] }]));
    facade.openUnitInfoFromFlatRow(row);
    facade.openUnitInfoFromFlatRow(row);
    expect(results.getPersonTestResults).toHaveBeenCalledTimes(1);
    pending.next([{ name: 'B', units: [{ id: 4, name: 'OLD' }] }]);
    pending.complete();
    expect(files.getUnitInfo).toHaveBeenCalledWith(1, 'OLD');
    workspace.next(2);
    expect(dialogRef.close).toHaveBeenCalled();
    facade.openUnitInfoFromFlatRow(row);
    expect(results.getPersonTestResults).toHaveBeenLastCalledWith(2, 5);
    expect(files.getUnitInfo).toHaveBeenLastCalledWith(2, 'NEW');
  });

  it('ignores an old confirmation even after switching back to the original workspace', () => {
    facade.deleteFromFlatRow(row);
    workspace.next(2);
    workspace.next(1);
    closed.next(true);
    expect(dialogRef.close).toHaveBeenCalled();
    expect(responses.deleteResponse).not.toHaveBeenCalled();
  });

  it('emits a completed deletion once and ignores delayed completion after a workspace switch', () => {
    const pending = new Subject<{ success: boolean }>();
    responses.deleteResponse.mockReturnValue(pending);
    const deleted = jest.fn();
    facade.deleted$.subscribe(deleted);
    facade.deleteFromFlatRow(row);
    closed.next(true);
    pending.next({ success: true });
    expect(responses.deleteResponse).toHaveBeenCalledWith(1, 3);
    expect(deleted).toHaveBeenCalledTimes(1);
    workspace.next(2);
    pending.next({ success: true });
    expect(deleted).toHaveBeenCalledTimes(1);
    expect(pending.observed).toBe(false);
  });
});
