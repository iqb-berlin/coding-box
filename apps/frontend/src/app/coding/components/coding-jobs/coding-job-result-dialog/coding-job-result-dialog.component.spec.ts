import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateModule } from '@ngx-translate/core';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { CodingJobResultDialogComponent } from './coding-job-result-dialog.component';
import { CodingJobBackendService } from '../../../services/coding-job-backend.service';
import { FileService } from '../../../../shared/services/file/file.service';
import { MissingsProfileService } from '../../../services/missings-profile.service';

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
    getCodingNotes: jest.fn(() => of({})) as jest.Mock,
    applyCodingResults: jest.fn() as jest.Mock
  };

  const mockFileService = {
    getCodingSchemeFile: jest.fn()
  };

  const mockRouter = {
    createUrlTree: jest.fn(() => ({})),
    serializeUrl: jest.fn(() => '/replay/path')
  };

  const mockMatDialog = {
    open: jest.fn()
  };

  const mockMissingsProfileService = {
    getMissingsProfiles: jest.fn(() => of([{ id: 1, label: 'IQB-Standard' }])) as jest.Mock,
    getMissingsProfileDetails: jest.fn(() => of({
      id: 1,
      label: 'IQB-Standard',
      missings: JSON.stringify([
        {
          id: 'mir',
          label: 'missing invalid response',
          description: '',
          code: -98,
          score: 0
        },
        {
          id: 'mci',
          label: 'missing coding impossible',
          description: '',
          code: -97,
          score: 0
        }
      ])
    })) as jest.Mock
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockDialogData.codingJob = { id: 1, name: 'Test Job' };
    mockCodingJobBackendService.getCodingJobUnits.mockReturnValue(of([]));
    mockCodingJobBackendService.getCodingProgress.mockReturnValue(of({}));
    mockCodingJobBackendService.getCodingNotes.mockReturnValue(of({}));
    mockCodingJobBackendService.applyCodingResults.mockReturnValue(of({
      success: true,
      updatedResponsesCount: 1,
      skippedReviewCount: 0,
      skippedAlreadyCodedCount: 0,
      overwrittenExistingCount: 0,
      messageKey: 'coding-results.apply.success.bulk',
      messageParams: {}
    }));
    mockMissingsProfileService.getMissingsProfiles.mockReturnValue(of([{ id: 1, label: 'IQB-Standard' }]));
    mockMissingsProfileService.getMissingsProfileDetails.mockReturnValue(of({
      id: 1,
      label: 'IQB-Standard',
      missings: JSON.stringify([
        {
          id: 'mir',
          label: 'missing invalid response',
          description: '',
          code: -98,
          score: 0
        },
        {
          id: 'mci',
          label: 'missing coding impossible',
          description: '',
          code: -97,
          score: 0
        }
      ])
    }));

    await TestBed.configureTestingModule({
      imports: [CodingJobResultDialogComponent, TranslateModule.forRoot()],
      providers: [
        { provide: MatDialogRef, useValue: mockDialogRef },
        { provide: MAT_DIALOG_DATA, useValue: mockDialogData },
        { provide: MatSnackBar, useClass: MatSnackBarMock },
        { provide: CodingJobBackendService, useValue: mockCodingJobBackendService },
        { provide: MissingsProfileService, useValue: mockMissingsProfileService },
        { provide: FileService, useValue: mockFileService },
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

  it('should keep dialog open and reload results when apply leaves coding issue reviews open', () => {
    (component as unknown as { dialog: { open: jest.Mock } }).dialog = mockMatDialog;
    mockMatDialog.open.mockReturnValue({
      afterClosed: () => of({ overwriteExisting: false })
    });
    mockCodingJobBackendService.applyCodingResults.mockReturnValue(of({
      success: true,
      updatedResponsesCount: 1,
      skippedReviewCount: 1,
      skippedAlreadyCodedCount: 0,
      overwrittenExistingCount: 0,
      messageKey: 'coding-results.apply.success.bulk',
      messageParams: {}
    }));
    const loadSpy = jest.spyOn(component, 'loadCodingResults').mockImplementation();

    component.applyCodingResults();

    expect(mockDialogRef.close).not.toHaveBeenCalled();
    expect(loadSpy).toHaveBeenCalled();

    component.closeDialog();

    expect(mockDialogRef.close).toHaveBeenCalledWith({ resultsApplied: true });
  });

  it('should close without applied result marker before applying results', () => {
    component.closeDialog();

    expect(mockDialogRef.close).toHaveBeenCalledWith(undefined);
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

  it('should resolve manually selected missing codes from the coding job missing profile', () => {
    component.data.codingJob = {
      ...component.data.codingJob,
      missings_profile_id: 77
    };
    mockMissingsProfileService.getMissingsProfileDetails.mockReturnValue(of({
      id: 77,
      label: 'Custom',
      missings: JSON.stringify([
        {
          id: 'mir',
          label: 'Custom MIR',
          description: '',
          code: -123,
          score: 7
        },
        {
          id: 'mci',
          label: 'Custom MCI',
          description: '',
          code: -124,
          score: 8
        }
      ])
    }));
    mockCodingJobBackendService.getCodingJobUnits.mockReturnValue(of([{
      responseId: 1,
      unitName: 'UNIT_1',
      unitAlias: 'UNIT_1',
      variableId: 'VAR_1',
      variableAnchor: 'VAR_1',
      bookletName: 'BOOKLET_A',
      personLogin: 'login',
      personCode: 'code',
      personGroup: 'group',
      isDoubleCoded: false,
      otherCoders: []
    }]));
    mockCodingJobBackendService.getCodingProgress.mockReturnValue(of({
      'login@code@group@BOOKLET_A::BOOKLET_A::UNIT_1::VAR_1': {
        id: -3,
        label: 'MIR'
      }
    }));

    component.loadCodingResults();

    expect(mockMissingsProfileService.getMissingsProfileDetails).toHaveBeenLastCalledWith(123, 77);
    expect(component.dataSource.data[0]).toMatchObject({
      code: -123,
      score: 7,
      codeLabel: 'Custom MIR',
      unresolvedMissing: false
    });
    expect(component.getCodedResultCount()).toBe(1);
  });

  it('should resolve already stored profile missing codes from the coding job missing profile', () => {
    component.data.codingJob = {
      ...component.data.codingJob,
      status: 'completed',
      missings_profile_id: 77
    };
    mockMissingsProfileService.getMissingsProfileDetails.mockReturnValue(of({
      id: 77,
      label: 'Custom',
      missings: JSON.stringify([
        {
          id: 'mir',
          label: 'Custom MIR',
          description: '',
          code: -123,
          score: 7
        },
        {
          id: 'mci',
          label: 'Custom MCI',
          description: '',
          code: -124,
          score: 8
        },
        {
          id: 'mbi_mbo',
          label: 'Custom omission',
          description: '',
          code: -99,
          score: 4
        }
      ])
    }));
    mockCodingJobBackendService.getCodingJobUnits.mockReturnValue(of([{
      responseId: 1,
      unitName: 'UNIT_1',
      unitAlias: 'UNIT_1',
      variableId: 'VAR_1',
      variableAnchor: 'VAR_1',
      bookletName: 'BOOKLET_A',
      personLogin: 'login',
      personCode: 'code',
      personGroup: 'group',
      isDoubleCoded: false,
      otherCoders: []
    }]));
    mockCodingJobBackendService.getCodingProgress.mockReturnValue(of({
      'login@code@group@BOOKLET_A::BOOKLET_A::UNIT_1::VAR_1': {
        id: -99
      }
    }));

    component.loadCodingResults();

    expect(component.dataSource.data[0]).toMatchObject({
      code: -99,
      score: 4,
      codeLabel: 'Custom omission',
      unresolvedMissing: false
    });
    expect(component.canApplyCodingResults()).toBe(true);
  });

  it('should block applying results when a manual missing cannot be resolved from the profile', () => {
    component.data.codingJob = {
      ...component.data.codingJob,
      status: 'completed',
      missings_profile_id: 77
    };
    mockMissingsProfileService.getMissingsProfileDetails.mockReturnValue(of({
      id: 77,
      label: 'Incomplete',
      missings: JSON.stringify([
        {
          id: 'mci',
          label: 'Custom MCI',
          description: '',
          code: -124,
          score: 8
        }
      ])
    }));
    mockCodingJobBackendService.getCodingJobUnits.mockReturnValue(of([{
      responseId: 1,
      unitName: 'UNIT_1',
      unitAlias: 'UNIT_1',
      variableId: 'VAR_1',
      variableAnchor: 'VAR_1',
      bookletName: 'BOOKLET_A',
      personLogin: 'login',
      personCode: 'code',
      personGroup: 'group',
      isDoubleCoded: false,
      otherCoders: []
    }]));
    mockCodingJobBackendService.getCodingProgress.mockReturnValue(of({
      'login@code@group@BOOKLET_A::BOOKLET_A::UNIT_1::VAR_1': {
        id: -3,
        label: 'MIR'
      }
    }));

    component.loadCodingResults();

    const result = component.dataSource.data[0];
    expect(result.unresolvedMissing).toBe(true);
    expect(component.getCodeDisplay(result)).toBe('Missing nicht auflösbar');
    expect(component.canApplyCodingResults()).toBe(false);
    expect(component.getApplyButtonTooltip()).toContain('Missing-Kodierung');
  });

  it('should block applying results when an already stored profile missing code cannot be resolved', () => {
    component.data.codingJob = {
      ...component.data.codingJob,
      status: 'completed',
      missings_profile_id: 77
    };
    mockMissingsProfileService.getMissingsProfileDetails.mockReturnValue(of({
      id: 77,
      label: 'Incomplete',
      missings: JSON.stringify([
        {
          id: 'mir',
          label: 'Custom MIR',
          description: '',
          code: -123,
          score: 7
        },
        {
          id: 'mci',
          label: 'Custom MCI',
          description: '',
          code: -124,
          score: 8
        }
      ])
    }));
    mockCodingJobBackendService.getCodingJobUnits.mockReturnValue(of([{
      responseId: 1,
      unitName: 'UNIT_1',
      unitAlias: 'UNIT_1',
      variableId: 'VAR_1',
      variableAnchor: 'VAR_1',
      bookletName: 'BOOKLET_A',
      personLogin: 'login',
      personCode: 'code',
      personGroup: 'group',
      isDoubleCoded: false,
      otherCoders: []
    }]));
    mockCodingJobBackendService.getCodingProgress.mockReturnValue(of({
      'login@code@group@BOOKLET_A::BOOKLET_A::UNIT_1::VAR_1': {
        id: -99
      }
    }));

    component.loadCodingResults();

    const result = component.dataSource.data[0];
    expect(result.unresolvedMissing).toBe(true);
    expect(component.getCodeDisplay(result)).toBe('Missing nicht auflösbar');
    expect(component.canApplyCodingResults()).toBe(false);
  });

  it.each([
    ['empty string', ''],
    ['blank string', '   ']
  ])('should block applying results when a manual missing score is %s', (_label, score) => {
    component.data.codingJob = {
      ...component.data.codingJob,
      status: 'completed',
      missings_profile_id: 77
    };
    mockMissingsProfileService.getMissingsProfileDetails.mockReturnValue(of({
      id: 77,
      label: 'Incomplete',
      missings: JSON.stringify([
        {
          id: 'mir',
          label: 'Custom MIR',
          description: '',
          code: -123,
          score
        },
        {
          id: 'mci',
          label: 'Custom MCI',
          description: '',
          code: -124,
          score: 8
        }
      ])
    }));
    mockCodingJobBackendService.getCodingJobUnits.mockReturnValue(of([{
      responseId: 1,
      unitName: 'UNIT_1',
      unitAlias: 'UNIT_1',
      variableId: 'VAR_1',
      variableAnchor: 'VAR_1',
      bookletName: 'BOOKLET_A',
      personLogin: 'login',
      personCode: 'code',
      personGroup: 'group',
      isDoubleCoded: false,
      otherCoders: []
    }]));
    mockCodingJobBackendService.getCodingProgress.mockReturnValue(of({
      'login@code@group@BOOKLET_A::BOOKLET_A::UNIT_1::VAR_1': {
        id: -3,
        label: 'MIR'
      }
    }));

    component.loadCodingResults();

    const result = component.dataSource.data[0];
    expect(result.unresolvedMissing).toBe(true);
    expect(result.score).toBeUndefined();
    expect(component.canApplyCodingResults()).toBe(false);
  });

  it('should resolve manually selected missing codes with an explicit NA score', () => {
    component.data.codingJob = {
      ...component.data.codingJob,
      status: 'completed',
      missings_profile_id: 77
    };
    mockMissingsProfileService.getMissingsProfileDetails.mockReturnValue(of({
      id: 77,
      label: 'NA profile',
      missings: JSON.stringify([
        {
          id: 'mir',
          label: 'Custom MIR',
          description: '',
          code: -123,
          score: null
        },
        {
          id: 'mci',
          label: 'Custom MCI',
          description: '',
          code: -124,
          score: 8
        }
      ])
    }));
    mockCodingJobBackendService.getCodingJobUnits.mockReturnValue(of([{
      responseId: 1,
      unitName: 'UNIT_1',
      unitAlias: 'UNIT_1',
      variableId: 'VAR_1',
      variableAnchor: 'VAR_1',
      bookletName: 'BOOKLET_A',
      personLogin: 'login',
      personCode: 'code',
      personGroup: 'group',
      isDoubleCoded: false,
      otherCoders: []
    }]));
    mockCodingJobBackendService.getCodingProgress.mockReturnValue(of({
      'login@code@group@BOOKLET_A::BOOKLET_A::UNIT_1::VAR_1': {
        id: -3,
        label: 'MIR'
      }
    }));

    component.loadCodingResults();

    expect(component.dataSource.data[0]).toMatchObject({
      code: -123,
      score: null,
      unresolvedMissing: false
    });
    expect(component.getScoreDisplay(component.dataSource.data[0])).toBe('NA');
    expect(component.canApplyCodingResults()).toBe(true);
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

  it('should only enable coding issue actions after the job was submitted for review', () => {
    const codingIssueResult = {
      codingIssueOption: -1,
      codingIssueOptionLabel: 'Unsichere Kodierung'
    } as never;
    const newCodeResult = {
      codingIssueOption: -2,
      codingIssueOptionLabel: 'Neuer Code nötig'
    } as never;

    component.data.codingJob = {
      ...component.data.codingJob,
      status: 'active'
    };

    expect(component.canReviewCodingResult(codingIssueResult)).toBe(false);
    expect(component.canEditCodingScheme(newCodeResult)).toBe(false);
    expect(component.getReviewCodingResultTooltip(codingIssueResult))
      .toContain('Zur Überprüfung');

    component.data.codingJob = {
      ...component.data.codingJob,
      status: 'review'
    };

    expect(component.canReviewCodingResult(codingIssueResult)).toBe(true);
    expect(component.canEditCodingScheme(newCodeResult)).toBe(true);
  });

  it('should not open coding issue review before the job was submitted for review', () => {
    const windowOpenSpy = jest.spyOn(window, 'open').mockImplementation(() => null);
    const snackBar = TestBed.inject(MatSnackBar) as unknown as MatSnackBarMock;
    component.data.codingJob = {
      ...component.data.codingJob,
      status: 'active'
    };

    component.reviewCodingResult({
      unitName: 'UNIT_1',
      unitAlias: 'Unit Alias',
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

    expect(windowOpenSpy).not.toHaveBeenCalled();
    expect(snackBar.open).toHaveBeenCalledWith(
      'Kodierungshinweise können erst im Status "Zur Überprüfung" geprüft werden',
      'Schließen',
      { duration: 3000 }
    );

    windowOpenSpy.mockRestore();
  });

  it('should open replay with a valid hash route URL', () => {
    const windowOpenSpy = jest.spyOn(window, 'open').mockImplementation(() => null);
    component.data.codingJob = {
      ...component.data.codingJob,
      status: 'review'
    };

    component.reviewCodingResult({
      unitName: 'UNIT_1',
      unitAlias: 'Unit Alias',
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
    const createUrlTreeCalls = mockRouter.createUrlTree.mock.calls as unknown as Array<[
      string[],
      { queryParams: Record<string, unknown> }
    ]>;
    const queryParams = createUrlTreeCalls[0][1].queryParams;
    expect(queryParams).toEqual(expect.objectContaining({
      mode: 'coding-issue-review',
      workspaceId: 123,
      unitsData: expect.any(String)
    }));
    expect(queryParams.auth).toBeUndefined();

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
