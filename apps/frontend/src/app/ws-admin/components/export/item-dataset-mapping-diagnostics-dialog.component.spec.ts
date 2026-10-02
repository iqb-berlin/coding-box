import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import type {
  ItemDatasetMappingWarningDto
} from '../../../../../../../api-dto/coding/export-request.dto';
import {
  ItemDatasetMappingDiagnosticsDialogComponent,
  ItemDatasetMappingDiagnosticsDialogData
} from './item-dataset-mapping-diagnostics-dialog.component';

describe('ItemDatasetMappingDiagnosticsDialogComponent', () => {
  let fixture: ComponentFixture<ItemDatasetMappingDiagnosticsDialogComponent>;
  let component: ItemDatasetMappingDiagnosticsDialogComponent;
  let data: ItemDatasetMappingDiagnosticsDialogData;
  let closeDialog: jest.Mock;

  beforeEach(async () => {
    const ignoredWarnings: ItemDatasetMappingWarningDto[] = Array.from(
      { length: 26 },
      (_, index) => ({
        code: 'vomd-fallback-ignored',
        message: `UNIT${index}/ITEM: redundanter Fallback ignoriert`,
        unitId: `UNIT${index}`,
        itemId: 'ITEM',
        variableId: 'VAR',
        columnName: index === 0 ? '=HYPERLINK("https://example.test")' : '',
        sourceFile: index === 25 ? 'special.vomd' : `UNIT${index}.vomd`,
        suggestedAction: index === 0 ?
          'Eintrag; mit "Anführungszeichen" korrigieren.\nDanach neu laden.' :
          'Redundanten Eintrag entfernen.'
      })
    );
    data = {
      severity: 'warning',
      diagnostics: [
        ...ignoredWarnings,
        {
          code: 'vomd-fallback-used',
          message: 'USED1/ITEM: eindeutiger Fallback verwendet',
          unitId: 'USED1',
          itemId: 'ITEM',
          sourceFile: 'USED1.vomd'
        },
        {
          code: 'vomd-fallback-used',
          message: 'USED2/ITEM: eindeutiger Fallback verwendet',
          unitId: 'USED2',
          itemId: 'ITEM',
          sourceFile: 'USED2.vomd'
        }
      ]
    };
    closeDialog = jest.fn();

    await TestBed.configureTestingModule({
      imports: [
        ItemDatasetMappingDiagnosticsDialogComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot()
      ],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: { close: closeDialog } }
      ]
    }).compileComponents();

    const translateService = TestBed.inject(TranslateService);
    translateService.setTranslation('de', {
      close: 'Schließen',
      paginator: {
        itemsPerPageLabel: 'Einträge pro Seite',
        nextPageLabel: 'Nächste Seite',
        previousPageLabel: 'Vorherige Seite',
        firstPageLabel: 'Erste Seite',
        lastPageLabel: 'Letzte Seite',
        getRangeLabel: '{{startIndex}}–{{endIndex}} von {{length}}'
      },
      'ws-admin': {
        'export-options': {
          'item-dataset-diagnostics-title-warning':
            'Item-Metadatenwarnungen ({{count}})',
          'item-dataset-diagnostics-description-warning':
            'Diese Hinweise verhindern den Export nicht.',
          'item-dataset-diagnostics-search': 'Diagnosen durchsuchen',
          'item-dataset-diagnostics-cause': 'Ursache',
          'item-dataset-diagnostics-all-causes': 'Alle Ursachen',
          'item-dataset-diagnostics-results': '{{filtered}} von {{total}} Diagnosen',
          'item-dataset-diagnostics-download': 'Gefilterte Diagnosen als CSV',
          'item-dataset-diagnostics-group-count': '{{count}} Diagnosen',
          'item-dataset-diagnostics-empty': 'Keine Diagnosen gefunden.',
          'item-dataset-diagnostics-severity-warning': 'Warnung',
          'item-dataset-diagnostic-file': 'VOMD-Datei',
          'item-dataset-diagnostic-unit': 'Unit',
          'item-dataset-diagnostic-item': 'Item',
          'item-dataset-diagnostic-target-variable': 'Ziel-variableId',
          'item-dataset-diagnostic-column': 'Spalte',
          'item-dataset-diagnostic-code': {
            'vomd-fallback-ignored': 'Redundanter Fallback ignoriert',
            'vomd-fallback-used': 'Eindeutiger Fallback verwendet'
          },
          'item-dataset-diagnostics-csv': {
            severity: 'Schweregrad',
            cause: 'Ursache',
            message: 'Meldung',
            file: 'VOMD-Datei',
            unit: 'Unit',
            item: 'Item',
            variable: 'variableId',
            column: 'Spalte',
            action: 'Handlungsempfehlung'
          }
        }
      }
    });
    translateService.use('de');

    fixture = TestBed.createComponent(
      ItemDatasetMappingDiagnosticsDialogComponent
    );
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('groups by cause, sorts by count and opens the largest group', () => {
    expect(component.visibleGroups.map(group => group.code)).toEqual([
      'vomd-fallback-ignored',
      'vomd-fallback-used'
    ]);
    expect(component.visibleGroups[0].diagnostics).toHaveLength(26);
    expect(component.expandedCode).toBe('vomd-fallback-ignored');
    expect(component.filteredCount).toBe(28);
  });

  it('searches all context fields and resets pagination', () => {
    component.onPageChange('vomd-fallback-ignored', {
      pageIndex: 1,
      pageSize: 10,
      length: 26,
      previousPageIndex: 0
    });
    component.search = 'SPECIAL.VOMD';
    component.onFiltersChange();

    expect(component.filteredCount).toBe(1);
    expect(component.visibleGroups[0].diagnostics[0].unitId).toBe('UNIT25');
    expect(component.getPageState('vomd-fallback-ignored')).toEqual({
      pageIndex: 0,
      pageSize: 25
    });
  });

  it('filters by cause and shows an empty result', () => {
    component.selectedCode = 'vomd-fallback-used';
    component.onFiltersChange();

    expect(component.visibleGroups).toHaveLength(1);
    expect(component.filteredCount).toBe(2);

    component.search = 'nicht vorhanden';
    component.onFiltersChange();

    expect(component.visibleGroups).toEqual([]);
    expect(component.expandedCode).toBeNull();
  });

  it('paginates each expanded group with the selected page size', () => {
    const group = component.visibleGroups[0];
    expect(component.getPageDiagnostics(group)).toHaveLength(25);

    component.onPageChange(group.code, {
      pageIndex: 1,
      pageSize: 25,
      length: 26,
      previousPageIndex: 0
    });

    expect(component.getPageDiagnostics(group)).toHaveLength(1);
    expect(component.pageSizeOptions).toEqual([10, 25, 50]);
  });

  it('uses the raw code when an unknown cause is received', () => {
    data.diagnostics.push({
      code: 'future-warning',
      message: 'Künftige Warnung'
    } as unknown as ItemDatasetMappingWarningDto);

    expect(component.getCauseLabel('future-warning')).toBe('future-warning');
  });

  it('exports every filtered diagnostic with BOM and escaped CSV values', () => {
    component.search = 'UNIT0';
    component.onFiltersChange();

    const csv = component.buildCsv();
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('"Schweregrad";"Ursache";"Meldung"');
    expect(csv).toContain('"Eintrag; mit ""Anführungszeichen"" korrigieren.\nDanach neu laden."');
    expect(csv).toContain(
      '"\'=HYPERLINK(""https://example.test"")"'
    );
    expect(csv).not.toContain('UNIT1.vomd');
    expect(component.getDownloadFileName(new Date(2026, 6, 22))).toBe(
      'itemdatensatz-warnungen-2026-07-22.csv'
    );
  });

  it('closes the dialog', () => {
    component.close();
    expect(closeDialog).toHaveBeenCalled();
  });
});
