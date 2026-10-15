import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { TranslateModule } from '@ngx-translate/core';
import * as ExcelJS from 'exceljs';
import { Subject } from 'rxjs';
import { ExportDialogComponent } from './export-dialog.component';
import { TestPersonCodingService } from '../../services/test-person-coding.service';
import { ValidationStateService } from '../../services/validation-state.service';
import { AppService } from '../../../core/services/app.service';
import { ValidateCodingCompletenessResponseDto } from '../../../../../../../api-dto/coding/validate-coding-completeness-response.dto';

jest.unmock('@angular/material/snack-bar');

describe('Export dialog validation without ZoneJS', () => {
  let fixture: ComponentFixture<ExportDialogComponent>;
  let state: ValidationStateService;
  let response: Subject<ValidateCodingCompletenessResponseDto>;
  let download: Subject<Blob>;
  let validateCodingCompleteness: jest.Mock;
  let dialog: MatDialog;
  let openResults: jest.SpyInstance;
  let closing: Subject<void>;
  let workspace: { selectedWorkspaceId: number; selectedWorkspaceId$: Subject<number> };

  const results: ValidateCodingCompletenessResponseDto = {
    results: [],
    total: 1,
    missing: 0,
    currentPage: 1,
    pageSize: 50,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
    cacheKey: 'validation-cache'
  };

  const button = (key: string): HTMLButtonElement => Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll('button')
  ).find(element => element.textContent?.includes(key))!;

  async function selectFile(file: File): Promise<void> {
    const fileInput = fixture.nativeElement.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(fileInput, 'files', { configurable: true, value: [file] });
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    await fixture.whenStable();
  }

  async function waitFor(predicate: () => boolean): Promise<void> {
    for (let attempts = 0; attempts < 50 && !predicate(); attempts += 1) {
      await new Promise(resolve => { setTimeout(resolve, 20); });
    }
    expect(predicate()).toBe(true);
    await fixture.whenStable();
  }

  async function codingListFile(): Promise<File> {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Kodierliste');
    worksheet.addRow(['unit_key', 'login_name', 'login_code', 'booklet_id', 'variable_id']);
    worksheet.addRow(['UNIT1', 'login1', 'person1', 'BOOKLET1', 'variable1']);
    return new File([new Uint8Array(await workbook.xlsx.writeBuffer())], 'coding-list.xlsx');
  }

  beforeEach(async () => {
    closing = new Subject<void>();
    workspace = { selectedWorkspaceId: 1, selectedWorkspaceId$: new Subject<number>() };
    response = new Subject<ValidateCodingCompletenessResponseDto>();
    download = new Subject<Blob>();
    validateCodingCompleteness = jest.fn().mockReturnValue(response);
    await TestBed.configureTestingModule({
      imports: [ExportDialogComponent, MatSnackBarModule, TranslateModule.forRoot()],
      providers: [
        provideZonelessChangeDetection(),
        { provide: MatDialogRef, useValue: { close: () => closing.next(), beforeClosed: () => closing } },
        {
          provide: TestPersonCodingService,
          useValue: {
            validateCodingCompleteness,
            downloadValidationResultsAsExcel: jest.fn().mockReturnValue(download)
          }
        },
        { provide: AppService, useValue: workspace }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(ExportDialogComponent);
    state = fixture.debugElement.injector.get(ValidationStateService);
    dialog = fixture.debugElement.injector.get(MatDialog);
    openResults = jest.spyOn(dialog, 'open');
    await fixture.whenStable();
  });

  afterEach(async () => {
    dialog.closeAll();
    TestBed.inject(MatSnackBar).dismiss();
    await fixture.whenStable();
    fixture.destroy();
    openResults.mockRestore();
  });

  it('renders a malformed XLSX error and re-enables upload without another interaction', async () => {
    await selectFile(new File(['broken'], 'invalid.xlsx'));
    expect(fixture.nativeElement.querySelector('.validation-progress-section')).not.toBeNull();
    expect(button('upload-button').disabled).toBe(true);

    await waitFor(() => state.getValidationProgress().status === 'error');

    expect(fixture.componentInstance.isValidating()).toBe(false);
    expect(fixture.nativeElement.querySelector('.validation-progress-section')).toBeNull();
    expect(fixture.nativeElement.querySelector('.validation-error-section').textContent)
      .toContain('Fehler beim Parsen der Excel-Datei');
    expect(button('upload-button').disabled).toBe(false);
    expect(button('retry-button').disabled).toBe(false);
    expect(validateCodingCompleteness).not.toHaveBeenCalled();
  });

  it('retries after a parsing error and displays delayed backend success', async () => {
    await selectFile(new File(['broken'], 'invalid.xlsx'));
    await waitFor(() => state.getValidationProgress().status === 'error');
    button('retry-button').click();
    await selectFile(await codingListFile());
    await waitFor(() => validateCodingCompleteness.mock.calls.length === 1);
    expect(fixture.nativeElement.querySelector('.validation-error-section')).toBeNull();
    expect(button('upload-button').disabled).toBe(true);
    expect(validateCodingCompleteness).toHaveBeenCalledWith(1, [expect.objectContaining({
      unit_key: 'UNIT1',
      login_name: 'login1',
      login_code: 'person1',
      booklet_id: 'BOOKLET1',
      variable_id: 'variable1'
    })], 1, 50);

    response.next(results);
    response.complete();
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('.validation-progress-section')).toBeNull();
    expect(fixture.nativeElement.querySelector('.validation-results-section')).not.toBeNull();
    expect(button('upload-button').disabled).toBe(false);
    expect(button('download-button').disabled).toBe(false);
    expect(openResults).toHaveBeenCalledTimes(1);
    expect(openResults).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      data: expect.objectContaining({ validationResults: results, validationCacheKey: results.cacheKey })
    }));
  });

  it('renders delayed backend failure and leaves retry available', async () => {
    await selectFile(await codingListFile());
    await waitFor(() => validateCodingCompleteness.mock.calls.length === 1);

    response.error(new Error('Synthetic validation failure'));
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('.validation-progress-section')).toBeNull();
    expect(fixture.nativeElement.querySelector('.validation-error-section').textContent)
      .toContain('Fehler bei der Validierung');
    expect(button('upload-button').disabled).toBe(false);
    expect(button('retry-button').disabled).toBe(false);
    expect(openResults).not.toHaveBeenCalled();
  });

  it('keeps download busy across progress emissions and releases it after delayed failure', async () => {
    state.setValidationResults(results);
    await fixture.whenStable();
    button('download-button').click();
    await fixture.whenStable();
    expect(button('download-button').disabled).toBe(true);

    state.setValidationResults({ ...results });
    await fixture.whenStable();
    expect(button('download-button').disabled).toBe(true);
    download.error(new Error('Synthetic download failure'));
    await fixture.whenStable();

    expect(button('download-button').disabled).toBe(false);
    expect(button('upload-button').disabled).toBe(false);
  });

  it('stops opening result dialogs after the export view is destroyed', async () => {
    fixture.destroy();
    state.setValidationResults(results);
    expect(openResults).not.toHaveBeenCalled();
  });
  it.each(['close', 'destroy', 'workspace'])('ignores a delayed Excel parser promise on %s', async reason => {
    const file = await codingListFile();
    let release!: (workbook: ExcelJS.Workbook) => void;
    const parsed = new Promise<ExcelJS.Workbook>(resolve => { release = resolve; });
    const load = jest.fn(() => parsed);
    const xlsx = jest.spyOn(ExcelJS.Workbook.prototype, 'xlsx', 'get').mockReturnValue({ load } as never);
    try {
      await selectFile(file);
      await waitFor(() => load.mock.calls.length === 1);
      if (reason === 'close') closing.next();
      if (reason === 'destroy') fixture.destroy();
      if (reason === 'workspace') {
        workspace.selectedWorkspaceId = 2;
        workspace.selectedWorkspaceId$.next(2);
        workspace.selectedWorkspaceId = 1;
        workspace.selectedWorkspaceId$.next(1);
      }
      expect(state.getValidationProgress().status).toBe('idle');
      release(new ExcelJS.Workbook());
      await parsed;
      await Promise.resolve();
      expect(validateCodingCompleteness).not.toHaveBeenCalled();
      expect(state.getValidationProgress().status).toBe('idle');
      expect(openResults).not.toHaveBeenCalled();
    } finally { xlsx.mockRestore(); }
  });

  it('cancels a pending validation on close without publishing to a reopened dialog', async () => {
    await selectFile(await codingListFile());
    await waitFor(() => validateCodingCompleteness.mock.calls.length === 1);
    closing.next();
    expect(response.observed).toBe(false);
    const reopened = TestBed.createComponent(ExportDialogComponent);
    await reopened.whenStable();
    const reopenedState = reopened.debugElement.injector.get(ValidationStateService);
    response.next(results);
    expect(reopenedState).not.toBe(state);
    expect(reopenedState.getValidationResults()).toBeNull();
    expect(reopenedState.getValidationProgress().status).toBe('idle');
    reopened.destroy();
  });
});
