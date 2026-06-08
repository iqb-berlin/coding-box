import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { CodingVariablesDialogComponent } from './coding-variables-dialog.component';
import { FileBackendService } from '../../shared/services/file/file-backend.service';
import { FileService } from '../../shared/services/file/file.service';
import { UnitVariableDetailsDto } from '../../models/unit-variable-details.dto';

describe('CodingVariablesDialogComponent', () => {
  let component: CodingVariablesDialogComponent;
  let fixture: ComponentFixture<CodingVariablesDialogComponent>;

  const unitVariables: UnitVariableDetailsDto[] = [
    {
      unitName: 'Unit A',
      unitId: 'Unit A',
      variables: [
        {
          id: 'INTERNAL_1',
          alias: 'Alias_1',
          type: 'string',
          hasCodingScheme: true,
          codingSchemeRef: 'Unit A.VOCS',
          codes: [{ id: 1, label: 'Code 1' }],
          coderTrainingRequired: true
        },
        {
          id: 'INTERNAL_2',
          alias: 'Alias_2',
          type: 'integer',
          hasCodingScheme: true,
          isDerived: true
        },
        {
          id: 'INTERNAL_3',
          alias: 'Alias_3',
          type: 'boolean',
          hasCodingScheme: false
        }
      ]
    }
  ];

  const fileBackendServiceMock = {
    getUnitVariables: jest.fn(() => of(unitVariables)),
    getReplayAnchorOverrides: jest.fn(() => of([
      { unitName: 'Unit A', variableId: 'INTERNAL_2', replayAnchor: 'TEXT_ANCHOR' }
    ])),
    saveReplayAnchorOverride: jest.fn(),
    deleteReplayAnchorOverride: jest.fn()
  };

  const fileServiceMock = {
    getUnitInfo: jest.fn(),
    getCodingSchemeFile: jest.fn()
  };

  const dialogRefMock = {
    close: jest.fn()
  };

  const dialogMock = {
    open: jest.fn()
  };

  const snackBarMock = {
    open: jest.fn(() => ({ dismiss: jest.fn() }))
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    await TestBed.configureTestingModule({
      imports: [
        NoopAnimationsModule,
        TranslateModule.forRoot(),
        CodingVariablesDialogComponent
      ],
      providers: [
        { provide: MatDialogRef, useValue: dialogRefMock },
        { provide: MAT_DIALOG_DATA, useValue: { workspaceId: 1 } },
        { provide: FileBackendService, useValue: fileBackendServiceMock },
        { provide: FileService, useValue: fileServiceMock },
        { provide: MatDialog, useValue: dialogMock },
        { provide: MatSnackBar, useValue: snackBarMock }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(CodingVariablesDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should load all variables without restrictive default filters', () => {
    expect(component.hasCodingSchemeFilter).toBe(false);
    expect(component.hasCodesFilter).toBe(false);
    expect(component.dataSource.data).toHaveLength(3);
    expect(component.dataSource.filteredData.map(variable => variable.variableId)).toEqual([
      'INTERNAL_1',
      'INTERNAL_2',
      'INTERNAL_3'
    ]);
  });

  it('should filter variables by id and alias', () => {
    component.variableIdFilter = 'INTERNAL_2';
    component.applyFilter();
    expect(component.dataSource.filteredData.map(variable => variable.variableId)).toEqual(['INTERNAL_2']);

    component.variableIdFilter = 'Alias_1';
    component.applyFilter();
    expect(component.dataSource.filteredData.map(variable => variable.variableId)).toEqual(['INTERNAL_1']);
  });

  it('should render alias as primary text and id as secondary text', () => {
    const variableCell = fixture.nativeElement.querySelector('td.mat-column-variableId') as HTMLElement;

    expect(variableCell.querySelector('.variable-alias')?.textContent?.trim()).toBe('Alias_1');
    expect(variableCell.querySelector('.variable-id')?.textContent?.trim()).toBe('ID: INTERNAL_1');
  });

  it('should attach saved replay anchors to variables', () => {
    const variable = component.dataSource.data.find(item => item.variableId === 'INTERNAL_2');

    expect(variable?.replayAnchor).toBe('TEXT_ANCHOR');
    expect(variable?.savedReplayAnchor).toBe('TEXT_ANCHOR');
  });

  it('should filter derived variables', () => {
    component.isDerivedFilter = true;
    component.applyFilter();

    expect(component.dataSource.filteredData.map(variable => variable.variableId)).toEqual(['INTERNAL_2']);
  });

  it('should filter variables by training effort', () => {
    component.trainingRequiredFilter = 'required';
    component.applyFilter();
    expect(component.dataSource.filteredData.map(variable => variable.variableId)).toEqual(['INTERNAL_1']);

    component.trainingRequiredFilter = 'not-required';
    component.applyFilter();
    expect(component.dataSource.filteredData.map(variable => variable.variableId)).toEqual([
      'INTERNAL_2',
      'INTERNAL_3'
    ]);
  });

  it('should distinguish source data from filtered results', () => {
    component.variableIdFilter = 'missing';
    component.applyFilter();

    expect(component.hasVariables).toBe(true);
    expect(component.hasFilteredVariables).toBe(false);
    expect(component.dataSource.data).toHaveLength(3);
    expect(component.dataSource.filteredData).toHaveLength(0);
  });

  it('should clear all filters', () => {
    component.variableIdFilter = 'INTERNAL_1';
    component.hasCodingSchemeFilter = true;
    component.hasCodesFilter = true;
    component.trainingRequiredFilter = 'required';
    component.selectedTypes = ['string'];
    component.applyFilter();

    component.clearFilters();

    expect(component.variableIdFilter).toBe('');
    expect(component.hasCodingSchemeFilter).toBe(false);
    expect(component.hasCodesFilter).toBe(false);
    expect(component.trainingRequiredFilter).toBe('all');
    expect(component.selectedTypes).toEqual([]);
    expect(component.dataSource.filteredData).toHaveLength(3);
  });
});
