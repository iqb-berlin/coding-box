import {
  ComponentFixture, TestBed, fakeAsync, tick
} from '@angular/core/testing';
import {
  MAT_DIALOG_DATA, MatDialog, MatDialogRef
} from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import {
  Component, EventEmitter, Input, Output
} from '@angular/core';
import { VariableInfo } from '@iqbspecs/variable-info/variable-info.interface';
import { UnitScheme } from '../schemer/unit-scheme.interface';
import { SchemeEditorDialogComponent, SchemeEditorDialogData } from './scheme-editor-dialog.component';
import { FileService } from '../../../shared/services/file/file.service';

import { ConfirmDialogComponent } from '../../../shared/dialogs/confirm-dialog.component';
import { StandaloneUnitSchemerComponent } from '../schemer/unit-schemer.component';

@Component({
  selector: 'unit-schemer-standalone',
  template: '',
  standalone: true
})
class MockStandaloneUnitSchemerComponent {
  @Input() schemerHtml = '';
  @Input() unitScheme?: UnitScheme;
  @Output() schemeChanged = new EventEmitter<UnitScheme>();
  @Output() error = new EventEmitter<string>();
}

describe('SchemeEditorDialogComponent', () => {
  let component: SchemeEditorDialogComponent;
  let fixture: ComponentFixture<SchemeEditorDialogComponent>;
  let mockFileService: Partial<FileService>;

  let mockDialogRef: Partial<MatDialogRef<SchemeEditorDialogComponent>>;
  let mockSnackBar: Partial<MatSnackBar>;
  let mockDialog: Partial<MatDialog>;

  const mockData: SchemeEditorDialogData = {
    workspaceId: 1,
    fileId: 'file-1',
    fileName: 'test-scheme.json',
    content: '{"variables":[]}'
  };

  beforeEach(async () => {
    mockFileService = {
      getFilesList: jest.fn().mockReturnValue(of({ data: [{ id: 's1', filename: 'schemer.html', created_at: new Date() }] })),
      downloadFile: jest.fn().mockReturnValue(of({ base64Data: btoa('<html lang="en"></html>') })),
      deleteFiles: jest.fn().mockReturnValue(of(true)),
      uploadTestFiles: jest.fn().mockReturnValue(of({ failed: 0, conflicts: [] })),
      getVariableInfoForScheme: jest.fn().mockReturnValue(of([]))
    };

    mockDialogRef = {
      close: jest.fn()
    };

    mockSnackBar = {
      open: jest.fn()
    };

    mockDialog = {
      open: jest.fn()
    };

    await TestBed.configureTestingModule({
      imports: [
        SchemeEditorDialogComponent,
        NoopAnimationsModule
      ],
      providers: [
        { provide: FileService, useValue: mockFileService },

        { provide: MatDialogRef, useValue: mockDialogRef },
        { provide: MAT_DIALOG_DATA, useValue: mockData },
        { provide: MatSnackBar, useValue: mockSnackBar },
        { provide: MatDialog, useValue: mockDialog }
      ]
    })
      .overrideComponent(SchemeEditorDialogComponent, {
        remove: { imports: [StandaloneUnitSchemerComponent] },
        add: { imports: [MockStandaloneUnitSchemerComponent] }
      })
      .compileComponents();

    fixture = TestBed.createComponent(SchemeEditorDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load schemer HTML and variable info on init', () => {
    expect(mockFileService.getVariableInfoForScheme).toHaveBeenCalledWith(1, 'test-scheme.json');
    expect(mockFileService.getFilesList).toHaveBeenCalledWith(1, 1, 10000, 'Schemer');
    expect(mockFileService.downloadFile).toHaveBeenCalledWith(1, 's1');
    expect(component.schemerHtml).toBe('<html lang="en"></html>');
    expect(component.isLoading).toBe(false);
  });

  it('should handle scheme changes', () => {
    const newScheme = { scheme: '{"new": true}', schemeType: 'type1' };
    component.onSchemeChanged(newScheme);
    expect(component.unitScheme).toEqual(newScheme);
    expect(component.hasChanges).toBe(true);
  });

  it('should show confirm dialog on close if there are changes', () => {
    component.hasChanges = true;
    const mockConfirmRef = { afterClosed: () => of(true) };
    (mockDialog.open as jest.Mock).mockReturnValue(mockConfirmRef);

    component.close();

    expect(mockDialog.open).toHaveBeenCalledWith(ConfirmDialogComponent, expect.any(Object));
    expect(mockDialogRef.close).toHaveBeenCalledWith(false);
  });

  it('should close immediately if no changes', () => {
    component.hasChanges = false;
    component.close();
    expect(mockDialogRef.close).toHaveBeenCalledWith(false);
  });

  it('should save scheme successfully', fakeAsync(() => {
    component.hasChanges = true;
    component.unitScheme = { scheme: '{"updated": true}', schemeType: 'type1' };

    // Mock getFilesList for Resource to find existing file
    (mockFileService.getFilesList as jest.Mock).mockReturnValueOnce(of({ data: [{ id: 'r1', filename: 'test-scheme.json', file_type: 'Resource' }] }));

    component.save();
    tick();

    expect(mockFileService.deleteFiles).toHaveBeenCalledWith(1, ['r1']);
    expect(mockFileService.uploadTestFiles).toHaveBeenCalled();
    expect(mockSnackBar.open).toHaveBeenCalledWith('Scheme saved successfully', 'Success', expect.any(Object));
    expect(mockDialogRef.close).toHaveBeenCalledWith(true);
  }));

  it('should handle save error', fakeAsync(() => {
    component.hasChanges = true;
    (mockFileService.uploadTestFiles as jest.Mock).mockReturnValue(of({ failed: 1, conflicts: [] }));

    // Mock getFilesList for Resource to NOT find existing file
    (mockFileService.getFilesList as jest.Mock).mockReturnValueOnce(of({ data: [] }));

    component.save();
    tick();

    expect(mockSnackBar.open).toHaveBeenCalledWith('Failed to save scheme', 'Error', expect.any(Object));
  }));

  it('should handle save when file does not exist initially', fakeAsync(() => {
    component.hasChanges = true;
    component.unitScheme = { scheme: '{"new": true}', schemeType: 'type1' };

    // Mock getFilesList for Resource to NOT find existing file
    (mockFileService.getFilesList as jest.Mock).mockReturnValueOnce(of({ data: [] }));

    component.save();
    tick();

    expect(mockFileService.deleteFiles).not.toHaveBeenCalled();
    expect(mockFileService.uploadTestFiles).toHaveBeenCalled();
    expect(mockSnackBar.open).toHaveBeenCalledWith('Scheme saved successfully', 'Success', expect.any(Object));
    expect(mockDialogRef.close).toHaveBeenCalledWith(true);
  }));

  it('should show error via snackbar on schemer error', () => {
    const errorMsg = 'Something went wrong';
    component.onError(errorMsg);
    expect(mockSnackBar.open).toHaveBeenCalledWith(`Schemer error: ${errorMsg}`, 'Error', { duration: 3000 });
  });

  it('should pretty print JSON scheme', () => {
    component.unitScheme = { scheme: '{"a":1}', schemeType: 'test' };
    expect(component.prettyScheme).toContain('{\n  "a": 1\n}');
  });

  it('should return raw string if pretty print fails', () => {
    component.unitScheme = { scheme: 'invalid-json', schemeType: 'test' };
    expect(component.prettyScheme).toBe('invalid-json');
  });

  it('should merge variables when scheme changes if new scheme has none', () => {
    const originalVariables: VariableInfo[] = [{
      id: 'v1',
      type: 'string',
      format: '',
      multiple: false,
      nullable: true,
      values: [],
      valuePositionLabels: []
    }];
    component.unitScheme = { scheme: '{}', schemeType: 'test', variables: originalVariables };

    // New scheme without variables
    const newScheme: UnitScheme = { scheme: '{"updated":true}', schemeType: 'test' };

    component.onSchemeChanged(newScheme);

    expect(component.unitScheme.variables).toBe(originalVariables);
    expect(component.hasChanges).toBe(true);
  });
});
