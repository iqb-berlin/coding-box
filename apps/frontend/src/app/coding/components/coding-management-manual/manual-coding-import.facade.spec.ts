import { Component, inject } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { BehaviorSubject, of } from 'rxjs';
import { AppService } from '../../../core/services/app.service';
import { TestPersonCodingService } from '../../services/test-person-coding.service';
import { ValidationStateService } from '../../services/validation-state.service';
import { ExternalCodingImportResultDto } from '../../../../../../../api-dto/coding/external-coding-import-result.dto';
import * as interpretation from './coding-import-file';
import { ManualCodingImportFacade } from './manual-coding-import.facade';

@Component({ standalone: true, template: '{{imports.isImporting()}}', providers: [ManualCodingImportFacade] })
class ImportHost { readonly imports = inject(ManualCodingImportFacade); }

const flush = async (): Promise<void> => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };

describe('manual coding import lifecycle', () => {
  let fixture: ComponentFixture<ImportHost>;
  let facade: ManualCodingImportFacade;
  let app: { selectedWorkspaceId: number; selectedWorkspaceId$: BehaviorSubject<number> };
  let api: { importExternalCodingWithProgress: jest.Mock };
  let validation: { startValidation: jest.Mock; resetValidation: jest.Mock; updateProgress: jest.Mock; setValidationError: jest.Mock };
  let dialog: { open: jest.Mock };
  let snack: { open: jest.Mock };

  beforeEach(() => {
    app = { selectedWorkspaceId: 5, selectedWorkspaceId$: new BehaviorSubject(5) };
    api = { importExternalCodingWithProgress: jest.fn() };
    validation = {
      startValidation: jest.fn(), resetValidation: jest.fn(), updateProgress: jest.fn(), setValidationError: jest.fn()
    };
    dialog = { open: jest.fn().mockReturnValue({ afterClosed: () => of({ sourceFormat: 'external-coding', scoreMode: 'import', existingCodingMode: 'fill-empty' }), close: jest.fn() }) };
    snack = { open: jest.fn() };
    TestBed.configureTestingModule({
      imports: [ImportHost],
      providers: [
        { provide: AppService, useValue: app }, { provide: TestPersonCodingService, useValue: api },
        { provide: ValidationStateService, useValue: validation }, { provide: MatDialog, useValue: dialog },
        { provide: MatSnackBar, useValue: snack }, { provide: TranslateService, useValue: { instant: (key: string) => key } }
      ]
    });
    fixture = TestBed.createComponent(ImportHost); facade = fixture.componentInstance.imports;
    jest.spyOn(interpretation, 'detectCodingImportFormat').mockResolvedValue({
      fileName: 'codes.csv', detectedFormat: 'external-coding', title: '', description: '', canImport: true, headers: [], helpItems: []
    });
    jest.spyOn(facade as unknown as { fileToBase64: () => Promise<string> }, 'fileToBase64').mockResolvedValue('encoded');
    fixture.detectChanges();
  });
  afterEach(() => { fixture.destroy(); jest.restoreAllMocks(); });

  it.each(['workspace', 'destroy', 'new import'] as const)('aborts the stream and suppresses late progress/results on %s', async target => {
    let finish!: () => void;
    api.importExternalCodingWithProgress.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const pending = facade.importFile(new File([''], 'codes.csv'));
    await flush();
    const [, , progress, complete, error, abortSignal] = api.importExternalCodingWithProgress.mock.calls[0];
    expect(abortSignal.aborted).toBe(false);
    if (target === 'workspace') { app.selectedWorkspaceId = 6; app.selectedWorkspaceId$.next(6); } else if (target === 'destroy') fixture.destroy();
    else { api.importExternalCodingWithProgress.mockResolvedValueOnce(undefined); await facade.importFile(new File([''], 'new.csv')); }
    expect(abortSignal.aborted).toBe(true);
    const count = validation.updateProgress.mock.calls.length;
    progress(99, 'late'); complete({} as ExternalCodingImportResultDto); error('late');
    finish(); await pending;
    expect(validation.updateProgress).toHaveBeenCalledTimes(count);
    expect(dialog.open).toHaveBeenCalledTimes(target === 'new import' ? 2 : 1);
    expect(snack.open).not.toHaveBeenCalled();
    expect(validation.setValidationError).not.toHaveBeenCalled();
  });

  it('opens the preview with the original workspace, file and selected import options', async () => {
    api.importExternalCodingWithProgress.mockImplementation(async (_id, _file, _progress, complete) => complete({
      message: 'preview', processedRows: 3, updatedRows: 2, errors: [], affectedRows: []
    }));
    await facade.importFile(new File([''], 'codes.csv'));
    expect(dialog.open).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({
      data: expect.objectContaining({
        workspaceId: 5,
        fileData: 'encoded',
        fileName: 'codes.csv',
        isPreview: true,
        sourceFormat: 'external-coding',
        scoreMode: 'import',
        existingCodingMode: 'fill-empty',
        processedRows: 3
      })
    }));
    expect(facade.isImporting()).toBe(false);
    const resets = validation.resetValidation.mock.calls.length;
    fixture.destroy();
    expect(validation.resetValidation).toHaveBeenCalledTimes(resets);
  });

  it('never opens a format dialog after asynchronous file reading outlives the view', async () => {
    let release!: (value: Awaited<ReturnType<typeof interpretation.detectCodingImportFormat>>) => void;
    jest.spyOn(interpretation, 'detectCodingImportFormat').mockReturnValue(new Promise(resolve => { release = resolve; }));
    const pending = facade.importFile(new File([''], 'codes.csv'));
    fixture.destroy();
    release({
      fileName: '', detectedFormat: 'unknown', title: '', description: '', canImport: false, headers: [], helpItems: []
    });
    await pending;
    expect(dialog.open).not.toHaveBeenCalled();
    expect(validation.startValidation).not.toHaveBeenCalled();
  });
});
