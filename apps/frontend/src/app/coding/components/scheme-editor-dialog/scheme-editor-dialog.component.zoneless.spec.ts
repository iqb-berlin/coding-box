import {
  ComponentFixture, TestBed
} from '@angular/core/testing';
import {
  MAT_DIALOG_DATA, MatDialog, MatDialogRef
} from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { of, Subject, throwError } from 'rxjs';
import {
  Component, EventEmitter, provideZonelessChangeDetection, input, output
} from '@angular/core';
import { VariableInfo } from '@iqbspecs/variable-info/variable-info.interface';
import { SchemerConfig } from '../schemer/schemer-config.interface';
import { UnitScheme } from '../schemer/unit-scheme.interface';
import { SchemeEditorDialogComponent, SchemeEditorDialogData } from './scheme-editor-dialog.component';
import { FileService } from '../../../shared/services/file/file.service';

import { StandaloneUnitSchemerComponent } from '../schemer/unit-schemer.component';

@Component({
  selector: 'unit-schemer-standalone',
  template: '',
  standalone: true
})
class MockStandaloneUnitSchemerComponent {
  readonly schemerHtml = input('');
  readonly unitScheme = input<UnitScheme>();
  readonly schemerConfig = input<SchemerConfig>();
  readonly schemeChanged = output<UnitScheme>();
  readonly error = output<string>();
}

describe('Schemer preview without Zone.js', () => {
  let component: SchemeEditorDialogComponent;
  let fixture: ComponentFixture<SchemeEditorDialogComponent>;
  let mockFileService: Partial<FileService>;
  let filesResponse$: Subject<unknown>;
  let downloadResponse$: Subject<unknown>;
  let variablesResponse$: Subject<VariableInfo[]>;

  let mockDialogRef: Partial<MatDialogRef<SchemeEditorDialogComponent>>;
  let mockSnackBar: Partial<MatSnackBar>;
  let mockDialog: Partial<MatDialog>;
  let mockTranslateService: Partial<TranslateService>;
  let mockRouter: Partial<Router>;
  let snackBarAction$: Subject<void>;
  let snackBarDismissed$: Subject<void>;

  const mockData: SchemeEditorDialogData = {
    workspaceId: 1,
    fileId: 'file-1',
    fileName: 'test-scheme.json',
    content: '{"variableCodings":[],"version":"3.0"}',
    codingSchemeRef: { content: 'test-scheme.json', schemer: 'iqb-schemer@2.5', schemeType: 'iqb@3.0' }
  };

  async function createPreview(data: SchemeEditorDialogData = mockData): Promise<void> {
    TestBed.overrideProvider(MAT_DIALOG_DATA, { useValue: data });
    fixture = TestBed.createComponent(SchemeEditorDialogComponent);
    component = fixture.componentInstance;
    fixture.autoDetectChanges();
    await fixture.whenStable();
  }

  beforeEach(async () => {
    filesResponse$ = new Subject();
    downloadResponse$ = new Subject();
    variablesResponse$ = new Subject();
    mockFileService = {
      getFilesList: jest.fn().mockReturnValue(filesResponse$),
      downloadFile: jest.fn().mockReturnValue(downloadResponse$),
      deleteFiles: jest.fn().mockReturnValue(of(true)),
      uploadTestFiles: jest.fn().mockReturnValue(of({ failed: 0, conflicts: [] })),
      getVariableInfoForScheme: jest.fn().mockReturnValue(variablesResponse$),
      getUnitInfo: jest.fn().mockReturnValue(of({ codingSchemeRef: { content: 'DLB004.vocs', schemer: 'iqb-schemer@2.5', schemeType: 'iqb@3.0' } }))
    };

    mockDialogRef = {
      close: jest.fn()
    };

    snackBarAction$ = new Subject<void>();
    snackBarDismissed$ = new Subject<void>();
    mockSnackBar = {
      open: jest.fn().mockReturnValue({
        onAction: () => snackBarAction$.asObservable(),
        afterDismissed: () => snackBarDismissed$.asObservable()
      })
    };

    mockDialog = {
      open: jest.fn()
    };
    mockRouter = {
      navigate: jest.fn()
    };
    mockTranslateService = {
      instant: jest.fn().mockImplementation((key: string) => key),
      stream: jest.fn().mockReturnValue(of('')),
      get: jest.fn().mockImplementation((key: string) => of(key)),
      onLangChange: new EventEmitter(),
      onTranslationChange: new EventEmitter(),
      onDefaultLangChange: new EventEmitter()
    };

    await TestBed.configureTestingModule({
      imports: [
        SchemeEditorDialogComponent
      ],
      providers: [
        provideZonelessChangeDetection(),
        { provide: FileService, useValue: mockFileService },

        { provide: MatDialogRef, useValue: mockDialogRef },
        { provide: MAT_DIALOG_DATA, useValue: mockData },
        { provide: MatSnackBar, useValue: mockSnackBar },
        { provide: TranslateService, useValue: mockTranslateService },
        { provide: MatDialog, useValue: mockDialog },
        { provide: Router, useValue: mockRouter }
      ]
    })
      .overrideComponent(SchemeEditorDialogComponent, {
        remove: { imports: [StandaloneUnitSchemerComponent] },
        add: { imports: [MockStandaloneUnitSchemerComponent] }
      })
      .compileComponents();
  });

  const installed = [
    { id: 28, filename: 'iqb-schemer@2.8.1.html', created_at: '2026-07-23' },
    { id: 25, filename: 'iqb-schemer@2.5.0.html', created_at: '2026-05-08' }
  ];

  function list(files = installed): void {
    filesResponse$.next({ data: files });
    filesResponse$.complete();
  }

  it('keeps the coding status action usable after a successful save closes the editor', async () => {
    await createPreview();
    list([]);
    component.onSchemeChanged({ scheme: '{"updated":true}', schemeType: 'iqb@3.0' });
    jest.mocked(mockFileService.getFilesList!).mockReturnValueOnce(of({ data: [] }) as never);
    component.save();
    expect(mockDialogRef.close).toHaveBeenCalledWith(true);
    fixture.destroy();
    snackBarAction$.next();
    expect(mockRouter.navigate).toHaveBeenCalledWith(
      ['/workspace-admin/1/coding/management'],
      { queryParams: { refreshCodingFreshness: '1' } }
    );
    snackBarAction$.next();
    expect(mockRouter.navigate).toHaveBeenCalledTimes(1);
  });

  it('releases a dismissed coding status action without retaining its editor', async () => {
    await createPreview();
    list([]);
    component.onSchemeChanged({ scheme: '{"updated":true}', schemeType: 'iqb@3.0' });
    jest.mocked(mockFileService.getFilesList!).mockReturnValueOnce(of({ data: [] }) as never);
    component.save();
    fixture.destroy();
    snackBarDismissed$.next();
    expect(snackBarAction$.observed).toBe(false);
    snackBarAction$.next();
    expect(mockRouter.navigate).not.toHaveBeenCalled();
  });

  it('renders the referenced Schemer after a delayed list and download without another click', async () => {
    await createPreview();
    expect(fixture.nativeElement.querySelector('mat-spinner')).not.toBeNull();
    list();
    expect(mockFileService.downloadFile).toHaveBeenCalledWith(1, 25);
    downloadResponse$.next({ base64Data: btoa('<html lang="en"></html>') });
    downloadResponse$.complete();
    await fixture.whenStable();
    expect(component.schemerHtml()).toBe('<html lang="en"></html>');
    expect(component.unitScheme().schemeType).toBe('iqb@3.0');
    expect(fixture.nativeElement.querySelector('mat-spinner')).toBeNull();
    expect(fixture.nativeElement.querySelector('pre.raw-json')).toBeNull();
    expect(fixture.nativeElement.querySelector('unit-schemer-standalone')).not.toBeNull();
  });

  it('explains a missing reference and renders the raw JSON after an empty result', async () => {
    await createPreview();
    list([]);
    await fixture.whenStable();
    expect(mockFileService.downloadFile).not.toHaveBeenCalled();
    expect(component.isLoading()).toBe(false);
    expect(fixture.nativeElement.querySelector('mat-spinner')).toBeNull();
    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain('coding.schemer.not-found');
    expect(fixture.nativeElement.querySelector('pre.raw-json')?.textContent).toContain('variableCodings');
  });

  it('does not replace an unavailable 2.5 reference with installed 2.8', async () => {
    await createPreview();
    list([installed[0]]);
    await fixture.whenStable();
    expect(mockFileService.downloadFile).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain('coding.schemer.not-found');
  });

  it('ends loading and explains a failed download', async () => {
    await createPreview();
    list();
    downloadResponse$.error(new Error('Download failed'));
    await fixture.whenStable();
    expect(component.isLoading()).toBe(false);
    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain('coding.schemer.download-error');
    expect(fixture.nativeElement.querySelector('pre.raw-json')).not.toBeNull();
  });

  it('ends loading and explains a failed file list', async () => {
    await createPreview();
    filesResponse$.error(new Error('File list failed'));
    await fixture.whenStable();
    expect(component.isLoading()).toBe(false);
    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain('coding.schemer.fetch-error');
  });

  it('resolves the XML reference when opened directly from test files', async () => {
    await createPreview({
      workspaceId: 2, fileId: '41', fileName: 'DLB004.vocs', content: '{"version":"3.0"}'
    });
    list();
    downloadResponse$.next({ base64Data: btoa('<html lang="en"></html>') });
    downloadResponse$.complete();
    await fixture.whenStable();
    expect(mockFileService.getUnitInfo).toHaveBeenCalledWith(2, 'DLB004');
    expect(mockFileService.downloadFile).toHaveBeenLastCalledWith(2, 25);
    expect(component.unitScheme().schemeType).toBe('iqb@3.0');
    expect(fixture.nativeElement.querySelector('unit-schemer-standalone')).not.toBeNull();
  });

  it('still opens a standalone scheme if its unit XML is unavailable', async () => {
    mockFileService.getUnitInfo = jest.fn().mockReturnValue(throwError(() => new Error('No unit XML')));
    await createPreview({
      workspaceId: 2, fileId: '41', fileName: 'DLB004.vocs', content: '{"version":"3.4"}'
    });
    list();
    downloadResponse$.next({ base64Data: btoa('<html lang="en"></html>') });
    downloadResponse$.complete();
    await fixture.whenStable();
    expect(mockFileService.downloadFile).toHaveBeenLastCalledWith(2, 28);
    expect(component.unitScheme().schemeType).toBe('iqb@3.4');
    expect(fixture.nativeElement.querySelector('unit-schemer-standalone')).not.toBeNull();
  });

  it('shows an explanation for empty Schemer HTML', async () => {
    await createPreview();
    list();
    downloadResponse$.next({ base64Data: '' });
    downloadResponse$.complete();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('unit-schemer-standalone')).toBeNull();
    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain('coding.schemer.decode-error');
  });

  it('keeps the viewer read-only even if the embedded Schemer reports a change', async () => {
    await createPreview({ ...mockData, readOnly: true });
    list();
    downloadResponse$.next({ base64Data: btoa('<html lang="en"></html>') });
    downloadResponse$.complete();
    await fixture.whenStable();
    component.onSchemeChanged({ scheme: '{"unexpected":true}', schemeType: 'iqb@3.0' });
    expect(component.hasChanges()).toBe(false);
    expect(component.unitScheme().scheme).toBe(mockData.content);
    expect(fixture.nativeElement.querySelectorAll('mat-dialog-actions button')).toHaveLength(1);
  });

  it('cancels outstanding requests when the preview closes', async () => {
    await createPreview();
    list();
    fixture.destroy();
    expect(downloadResponse$.observed).toBe(false);
    expect(variablesResponse$.observed).toBe(false);
  });
});
