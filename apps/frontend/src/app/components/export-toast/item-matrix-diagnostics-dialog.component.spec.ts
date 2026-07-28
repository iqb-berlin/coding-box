import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ItemMatrixDiagnosticsDialogComponent } from './item-matrix-diagnostics-dialog.component';

describe('ItemMatrixDiagnosticsDialogComponent', () => {
  it('filters complete diagnostic groups without exposing person fields', async () => {
    const data = {
      total: 25,
      sampleLimit: 20,
      groups: [
        {
          reasonCode: 'derived-result-missing' as const,
          bookletName: 'BOOKLET-1',
          columnName: 'UNIT1_1',
          count: 22,
          sampleRowNumbers: [2, 3]
        },
        {
          reasonCode: 'missing-score' as const,
          bookletName: 'BOOKLET-2',
          columnName: 'UNIT2_1',
          count: 3,
          sampleRowNumbers: []
        }
      ]
    };
    await TestBed.configureTestingModule({
      imports: [
        ItemMatrixDiagnosticsDialogComponent,
        TranslateModule.forRoot()
      ],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: { close: jest.fn() } }
      ]
    }).compileComponents();
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('de', {
      'export-toast': {
        'item-matrix-diagnostics': {
          reasons: {
            'derived-result-missing': {
              label: 'Ableitung fehlt', action: 'Ableitung ausführen'
            },
            'missing-score': {
              label: 'Score fehlt', action: 'Score ergänzen'
            }
          }
        }
      }
    });
    translate.use('de');
    const component = TestBed.createComponent(
      ItemMatrixDiagnosticsDialogComponent
    ).componentInstance;

    expect(component.reasonOptions.map(option => option.count)).toEqual([22, 3]);
    component.onPageChange({ pageIndex: 1, pageSize: 1, length: 2 });
    expect(component.visibleGroups).toEqual([data.groups[1]]);
    component.search = 'BOOKLET-2';
    component.onFiltersChange();
    expect(component.pageIndex).toBe(0);
    expect(component.filteredGroups).toEqual([data.groups[1]]);
    component.search = '';
    component.selectedReason = 'derived-result-missing';
    component.onFiltersChange();
    expect(component.filteredGroups).toEqual([data.groups[0]]);
    expect(JSON.stringify(data.groups)).not.toMatch(
      /personLogin|personCode|personGroup/
    );

    const anchor = document.createElement('a');
    anchor.click = jest.fn();
    const originalCreateElement = document.createElement.bind(document);
    const createElement = jest.spyOn(document, 'createElement')
      .mockImplementation(tagName => (
        tagName === 'a' ? anchor : originalCreateElement(tagName)
      ));
    const createObjectUrl = jest.fn().mockReturnValue('blob:diagnostics');
    const revokeObjectUrl = jest.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectUrl
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectUrl
    });

    try {
      component.downloadCsv();
      expect(anchor.click).toHaveBeenCalled();
      expect(anchor.download).toMatch(/^Itemdatensatz-Diagnose-.*\.csv$/);
      expect(createObjectUrl).toHaveBeenCalledWith(expect.any(Blob));
      expect(revokeObjectUrl).toHaveBeenCalledWith('blob:diagnostics');
    } finally {
      createElement.mockRestore();
    }
  });

  it('renders only the current page for a large diagnostic result', async () => {
    const groups = Array.from({ length: 743 }, (_, index) => ({
      reasonCode: 'unresolved-status' as const,
      bookletName: `BOOKLET-${index}`,
      columnName: `COLUMN-${index}`,
      count: 1,
      sampleRowNumbers: []
    }));
    await TestBed.configureTestingModule({
      imports: [
        ItemMatrixDiagnosticsDialogComponent,
        TranslateModule.forRoot()
      ],
      providers: [
        {
          provide: MAT_DIALOG_DATA,
          useValue: { total: 743, sampleLimit: 20, groups }
        },
        { provide: MatDialogRef, useValue: { close: jest.fn() } }
      ]
    }).compileComponents();

    const fixture = TestBed.createComponent(
      ItemMatrixDiagnosticsDialogComponent
    );
    fixture.detectChanges();

    expect(fixture.componentInstance.filteredGroups).toHaveLength(743);
    expect(fixture.componentInstance.visibleGroups).toHaveLength(25);
    expect(
      fixture.nativeElement.querySelectorAll('mat-expansion-panel')
    ).toHaveLength(25);
  });
});
