import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import {
  CodebookJobDefinitionPickerDialogComponent,
  CodebookJobDefinitionPickerDialogData
} from './codebook-job-definition-picker-dialog.component';

describe('CodebookJobDefinitionPickerDialogComponent', () => {
  let fixture: ComponentFixture<CodebookJobDefinitionPickerDialogComponent>;

  const data: CodebookJobDefinitionPickerDialogData = {
    selectedJobDefinitionId: 2,
    options: [
      {
        id: 1,
        jobDefinition: { id: 1 },
        label: 'Definition #1',
        meta: '2 Variablen · 1 Aufgabe',
        bundleSummary: 'Gruppen: Basis',
        summary: '2 Variablen · 1 Aufgabe · Gruppen: Basis'
      },
      {
        id: 2,
        jobDefinition: { id: 2 },
        label: 'Definition #2',
        meta: '4 Variablen · 3 Aufgaben',
        bundleSummary: 'Gruppen: Lesen',
        summary: '4 Variablen · 3 Aufgaben · Gruppen: Lesen'
      }
    ]
  };

  beforeEach(async () => {
    const translateServiceMock = {
      instant: jest.fn((key: string) => key),
      get: jest.fn((key: string) => of(key)),
      stream: jest.fn((key: string) => of(key)),
      onLangChange: of({}),
      onTranslationChange: of({}),
      onDefaultLangChange: of({})
    };

    await TestBed.configureTestingModule({
      imports: [CodebookJobDefinitionPickerDialogComponent],
      providers: [
        { provide: MatDialogRef, useValue: { close: jest.fn() } },
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: TranslateService, useValue: translateServiceMock }
      ]
    }).compileComponents();
  });

  const createComponent = () => {
    const dialogRef = {
      close: jest.fn()
    };
    const component = new CodebookJobDefinitionPickerDialogComponent(
      dialogRef as never,
      data
    );
    return { component, dialogRef };
  };

  it('should compile external template and styles', () => {
    fixture = TestBed.createComponent(CodebookJobDefinitionPickerDialogComponent);
    fixture.detectChanges();

    expect(fixture.componentInstance).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.job-definition-picker-content')).toBeTruthy();
  });

  it('should initialize with selected job definition', () => {
    const { component } = createComponent();

    expect(component.selectedJobDefinitionId).toBe(2);
    expect(component.selectedOption?.id).toBe(2);
  });

  it('should filter definitions by label, meta and bundle summary', () => {
    const { component } = createComponent();

    component.filterText = 'basis';

    expect(component.filteredOptions.map(option => option.id)).toEqual([1]);

    component.filterText = '3 aufgaben';

    expect(component.filteredOptions.map(option => option.id)).toEqual([2]);
  });

  it('should close with current selection on apply', () => {
    const { component, dialogRef } = createComponent();

    component.selectJobDefinition(null);
    component.applySelection();

    expect(dialogRef.close).toHaveBeenCalledWith(null);
  });

  it('should clear search filter', () => {
    const { component } = createComponent();
    component.filterText = 'lesen';

    component.clearFilter();

    expect(component.filterText).toBe('');
  });
});
