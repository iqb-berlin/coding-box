import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateModule } from '@ngx-translate/core';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { CodingJobResultDialogComponent } from './coding-job-result-dialog.component';
import { CodingJobBackendService } from '../../../services/coding-job-backend.service';
import { FileService } from '../../../../shared/services/file/file.service';
import { AppService } from '../../../../core/services/app.service';

class MatSnackBarMock {
  open = jest.fn(() => ({
    dismiss: jest.fn()
  }));
}

describe('CodingJobResultDialogComponent', () => {
  let component: CodingJobResultDialogComponent;
  let fixture: ComponentFixture<CodingJobResultDialogComponent>;

  const mockDialogRef = {
    close: jest.fn()
  };

  const mockDialogData = {
    codingJob: { id: 1, name: 'Test Job' },
    workspaceId: 123
  };

  const mockCodingJobBackendService = {
    getCodingJobUnits: jest.fn(() => of([])) as jest.Mock,
    getCodingProgress: jest.fn(() => of({})) as jest.Mock,
    getCodingNotes: jest.fn(() => of({})) as jest.Mock
  };

  const mockFileService = {
    getCodingSchemeFile: jest.fn()
  };

  const mockAppService = {
    createOwnToken: jest.fn(() => of('test-token')),
    loggedUser: { sub: 'test-user' }
  };

  const mockRouter = {
    createUrlTree: jest.fn(() => ({})),
    serializeUrl: jest.fn(() => '/replay/path')
  };

  const mockMatDialog = {
    open: jest.fn()
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCodingJobBackendService.getCodingJobUnits.mockReturnValue(of([]));
    mockCodingJobBackendService.getCodingProgress.mockReturnValue(of({}));
    mockCodingJobBackendService.getCodingNotes.mockReturnValue(of({}));

    await TestBed.configureTestingModule({
      imports: [CodingJobResultDialogComponent, TranslateModule.forRoot()],
      providers: [
        { provide: MatDialogRef, useValue: mockDialogRef },
        { provide: MAT_DIALOG_DATA, useValue: mockDialogData },
        { provide: MatSnackBar, useClass: MatSnackBarMock },
        { provide: CodingJobBackendService, useValue: mockCodingJobBackendService },
        { provide: FileService, useValue: mockFileService },
        { provide: AppService, useValue: mockAppService },
        { provide: Router, useValue: mockRouter },
        { provide: MatDialog, useValue: mockMatDialog }
      ]
    })
      .compileComponents();

    fixture = TestBed.createComponent(CodingJobResultDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should display test person context without empty separators and keep booklet searchable', () => {
    mockCodingJobBackendService.getCodingJobUnits.mockReturnValue(of([{
      responseId: 1,
      unitName: 'UNIT_1',
      unitAlias: 'Unit Alias',
      variableId: 'VAR_1',
      variableAnchor: 'VAR_1',
      bookletName: 'BOOKLET_A',
      personLogin: 'login',
      personCode: '',
      personGroup: 'group',
      isDoubleCoded: false,
      otherCoders: []
    }]));
    mockCodingJobBackendService.getCodingProgress.mockReturnValue(of({
      'login@@group@BOOKLET_A::BOOKLET_A::UNIT_1::VAR_1': { id: 1, score: 2 }
    }));
    mockCodingJobBackendService.getCodingNotes.mockReturnValue(of({
      'login@@group@BOOKLET_A::BOOKLET_A::UNIT_1::VAR_1': 'group note'
    }));

    component.loadCodingResults();

    expect(component.dataSource.data[0]).toMatchObject({
      testPerson: 'login / group / BOOKLET_A',
      code: 1,
      score: 2,
      notes: 'group note'
    });

    component.testPersonFilter = 'BOOKLET_A';
    component.applyFilters();

    expect(component.getFilteredResultCount()).toBe(1);
  });

  it('should still show results when notes fail to load', () => {
    mockCodingJobBackendService.getCodingJobUnits.mockReturnValue(of([{
      responseId: 1,
      unitName: 'UNIT_1',
      unitAlias: 'UNIT_1',
      variableId: 'VAR_1',
      variableAnchor: 'VAR_1',
      variablePage: '2',
      bookletName: 'BOOKLET_A',
      personLogin: 'login',
      personCode: 'code',
      personGroup: 'group',
      isDoubleCoded: false,
      otherCoders: []
    }]));
    mockCodingJobBackendService.getCodingProgress.mockReturnValue(of({
      'login@code@group@BOOKLET_A::BOOKLET_A::UNIT_1::VAR_1': { id: 1, score: 2 }
    }));
    mockCodingJobBackendService.getCodingNotes.mockReturnValue(throwError(() => new Error('notes failed')));

    component.loadCodingResults();

    expect(component.dataSource.data).toHaveLength(1);
    expect(component.dataSource.data[0].code).toBe(1);
    expect(component.isNotesUnavailable).toBe(true);
  });

  it('should identify new-code cases by stable issue option id', () => {
    expect(component.isNewCodeNeeded({
      codingIssueOption: -2,
      codingIssueOptionLabel: 'Beliebiger übersetzter Text'
    } as never)).toBe(true);

    expect(component.isNewCodeNeeded({
      codingIssueOption: -1,
      codingIssueOptionLabel: 'Neuer Code wäre im Text kein Signal mehr'
    } as never)).toBe(false);
  });

  it('should open replay with a valid hash route URL', () => {
    const windowOpenSpy = jest.spyOn(window, 'open').mockImplementation(() => null);

    component.reviewCodingResult({
      unitName: 'UNIT_1',
      unitAlias: 'UNIT_1',
      variableId: 'VAR_1',
      variableAnchor: 'VAR_1',
      variablePage: '2',
      bookletName: 'BOOKLET_A',
      personLogin: 'login',
      personCode: 'code',
      personGroup: 'group',
      testPerson: 'login@code@group@BOOKLET_A',
      codingIssueOption: -1,
      codingIssueOptionLabel: 'Unsichere Kodierung'
    } as never);

    expect(windowOpenSpy).toHaveBeenCalledWith(expect.any(String), '_blank');
    const openedUrl = windowOpenSpy.mock.calls[0][0] as string;
    expect(openedUrl).toContain('/#/replay/path');
    expect(openedUrl).not.toContain('#//replay');
    expect(mockRouter.createUrlTree).toHaveBeenCalledWith(
      ['replay/login@code@group@BOOKLET_A/UNIT_1/2/VAR_1'],
      expect.any(Object)
    );

    windowOpenSpy.mockRestore();
  });

  it('should allow applying results when the coding job freshness requires manual review', () => {
    component.isLoading = false;
    component.data.codingJob = {
      ...component.data.codingJob,
      status: 'completed',
      freshnessStatus: 'review_required'
    };
    component.dataSource.data = [{
      unitName: 'UNIT_1',
      unitAlias: 'UNIT_1',
      variableId: 'VAR_1',
      variableAnchor: 'VAR_1',
      bookletName: 'BOOKLET_A',
      personLogin: 'login',
      personCode: 'code',
      personGroup: 'group',
      testPerson: 'login / code / group / BOOKLET_A',
      testPersonSearch: 'login code group BOOKLET_A',
      code: 1,
      score: 2
    }];

    expect(component.canApplyCodingResults()).toBe(true);
    expect(component.getApplyButtonTooltip())
      .toBe('Geprüfte Kodierergebnisse auf Datenbank anwenden');
  });

  it('should block applying results when the coding job source freshness is stale', () => {
    component.isLoading = false;
    component.data.codingJob = {
      ...component.data.codingJob,
      status: 'completed',
      freshnessStatus: 'stale_source'
    };
    component.dataSource.data = [{
      unitName: 'UNIT_1',
      unitAlias: 'UNIT_1',
      variableId: 'VAR_1',
      variableAnchor: 'VAR_1',
      bookletName: 'BOOKLET_A',
      personLogin: 'login',
      personCode: 'code',
      personGroup: 'group',
      testPerson: 'login / code / group / BOOKLET_A',
      testPersonSearch: 'login code group BOOKLET_A',
      code: 1,
      score: 2
    }];

    expect(component.canApplyCodingResults()).toBe(false);
    expect(component.getApplyButtonTooltip())
      .toContain('Antwortdaten haben sich geändert');
  });
});
