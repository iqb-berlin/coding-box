import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  MatDialogModule,
  MatDialogRef,
  MAT_DIALOG_DATA
} from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { HttpErrorResponse } from '@angular/common/http';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { TranslateModule } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';
import { CodingTrainingBackendService } from '../../services/coding-training-backend.service';
import { CodingResultsComparisonComponent } from './coding-results-comparison.component';
import { SERVER_URL } from '../../../injection-tokens';
import { CodingStatisticsService } from '../../services/coding-statistics.service';
import { AppService } from '../../../core/services/app.service';
import { CoderTraining } from '../../models/coder-training.model';

describe('CodingResultsComparisonComponent', () => {
  let component: CodingResultsComparisonComponent;
  let fixture: ComponentFixture<CodingResultsComparisonComponent>;
  let codingTrainingBackendService: {
    getCoderTrainings: jest.Mock;
    compareTrainingCodingResults: jest.Mock;
    compareWithinTrainingCodingResults: jest.Mock;
    saveDiscussionResult: jest.Mock;
    getTrainingCohensKappa: jest.Mock;
  };
  let codingStatisticsService: {
    getReplayUrl: jest.Mock;
  };
  let appService: {
    authData: { userName: string };
    loggedUser: { preferred_username?: string } | undefined;
    createOwnToken: jest.Mock;
  };
  let snackBar: {
    open: jest.Mock;
  };

  beforeEach(async () => {
    codingTrainingBackendService = {
      getCoderTrainings: jest.fn().mockReturnValue({ subscribe: jest.fn() }),
      compareTrainingCodingResults: jest.fn(),
      compareWithinTrainingCodingResults: jest.fn(),
      saveDiscussionResult: jest.fn().mockReturnValue(of({
        success: true,
        code: 7,
        score: 2,
        source: 'manual',
        managerUserId: 2,
        managerName: 'Test User'
      })),
      getTrainingCohensKappa: jest.fn()
    };
    codingStatisticsService = {
      getReplayUrl: jest.fn()
    };
    appService = {
      authData: { userName: 'Test User' },
      loggedUser: undefined,
      createOwnToken: jest.fn()
    };
    snackBar = {
      open: jest.fn()
    };

    await TestBed.configureTestingModule({
      imports: [
        CodingResultsComparisonComponent,
        MatDialogModule,
        HttpClientTestingModule,
        TranslateModule.forRoot()
      ],
      providers: [
        {
          provide: MatDialogRef,
          useValue: { close: jest.fn() }
        },
        {
          provide: MAT_DIALOG_DATA,
          useValue: { workspaceId: 1 }
        },
        {
          provide: SERVER_URL,
          useValue: 'http://localhost:3000'
        },
        {
          provide: MatSnackBar,
          useValue: snackBar
        },
        {
          provide: CodingTrainingBackendService,
          useValue: codingTrainingBackendService
        },
        {
          provide: CodingStatisticsService,
          useValue: codingStatisticsService
        },
        {
          provide: AppService,
          useValue: appService
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(CodingResultsComparisonComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should initialize from the requested comparison mode', () => {
    component.data.initialMode = 'within-training';

    component.ngOnInit();

    expect(component.comparisonMode).toBe('within-training');
  });

  it('should expose replay as its own table column', () => {
    expect(component.displayedColumns).toEqual([
      'index',
      'unitVariable',
      'personInfo',
      'replay',
      'givenAnswer',
      'match'
    ]);
  });

  it('should add modal values to the within-training evaluation table', () => {
    component.comparisonMode = 'within-training';
    component.selectedTrainingForWithin = 5;
    component.withinTrainingData = [
      {
        responseId: 1,
        unitName: 'Unit1',
        variableId: 'Var1',
        testperson: 'Test1',
        coders: [
          {
            jobId: 1,
            coderName: 'Coder1',
            code: '7',
            score: 2
          },
          {
            jobId: 2,
            coderName: 'Coder2',
            code: '7',
            score: 2
          }
        ]
      }
    ];
    component.codersFormControl.setValue([1, 2]);

    (component as unknown as { updateDisplayedColumns: () => void }).updateDisplayedColumns();

    expect(component.displayedColumns).toEqual([
      'index',
      'unitVariable',
      'personInfo',
      'replay',
      'givenAnswer',
      'match',
      'modalValue',
      'coder_1',
      'coder_2',
      'discussion'
    ]);
  });

  it('should calculate deterministic modal values for selected coders', () => {
    component.comparisonMode = 'within-training';
    component.codersFormControl.setValue([1, 2, 3, 4]);
    const row = {
      responseId: 1,
      unitName: 'Unit1',
      variableId: 'Var1',
      testperson: 'Test1',
      coders: [
        {
          jobId: 1,
          coderName: 'Coder1',
          code: '8',
          score: 1
        },
        {
          jobId: 2,
          coderName: 'Coder2',
          code: '7',
          score: 1
        },
        {
          jobId: 3,
          coderName: 'Coder3',
          code: '8',
          score: 1
        },
        {
          jobId: 4,
          coderName: 'Coder4',
          code: '9',
          score: 1
        }
      ]
    };
    component.withinTrainingData = [row];

    (component as unknown as { updateModalValueDisplays: () => void }).updateModalValueDisplays();

    expect(component.withinTrainingData[0].modalValueDisplay?.valueText).toBe('8');
    expect(component.withinTrainingData[0].modalValueDisplay?.deviationText).toBe('2');

    row.coders[3].code = '7';

    (component as unknown as { updateModalValueDisplays: () => void }).updateModalValueDisplays();

    expect(component.withinTrainingData[0].modalValueDisplay?.valueText).toBe('7*');
  });

  it('should open replay for the row response with coding context', () => {
    const openSpy = jest.spyOn(window, 'open').mockImplementation(() => null);
    appService.createOwnToken.mockReturnValue(of('token-123'));
    codingStatisticsService.getReplayUrl.mockReturnValue(of({
      replayUrl: 'https://app.test/#/replay/login%40code%40booklet/UNIT_1/2/VAR_1?auth=token-123'
    }));

    component.openReplay({
      responseId: 77,
      unitName: 'UNIT_1',
      variableId: 'VAR_1',
      personCode: 'code',
      personLogin: 'login',
      personGroup: '',
      testPerson: 'login@code@booklet',
      coders: []
    } as never);

    expect(appService.createOwnToken).toHaveBeenCalledWith(1, 1);
    expect(codingStatisticsService.getReplayUrl).toHaveBeenCalledWith(1, 77, 'token-123');
    expect(openSpy).toHaveBeenCalledWith(
      'https://app.test/#/replay/login%40code%40booklet/UNIT_1/2/VAR_1?auth=token-123&mode=coding&originResponseId=77',
      '_blank'
    );
  });

  it('should show feedback when no replay URL is returned', () => {
    const openSpy = jest.spyOn(window, 'open').mockImplementation(() => null);
    appService.createOwnToken.mockReturnValue(of('token-123'));
    codingStatisticsService.getReplayUrl.mockReturnValue(of({ replayUrl: '' }));

    component.openReplay({
      responseId: 77,
      unitName: 'UNIT_1',
      variableId: 'VAR_1',
      personCode: 'code',
      personLogin: 'login',
      personGroup: '',
      testPerson: 'login@code@booklet',
      coders: []
    } as never);

    expect(openSpy).not.toHaveBeenCalled();
    expect(snackBar.open).toHaveBeenCalledWith(
      'Replay-URL konnte nicht erzeugt werden.',
      'common.close',
      { duration: 3000 }
    );
  });

  it('should format and filter trainings with stable disambiguation data', () => {
    const training = {
      id: 33,
      workspace_id: 1,
      label: 'Duplicate Label',
      created_at: new Date('2026-05-13T11:36:00'),
      updated_at: new Date('2026-05-13T11:36:00'),
      jobsCount: 2
    } as CoderTraining;

    component.availableTrainings = [training];
    component.filteredTrainings = [training];

    expect(component.getTrainingOptionTitle(training)).toBe('Duplicate Label · ID 33');
    expect(component.getTrainingOptionMeta(training)).toContain('2 Kodierer');
    expect(component.getTrainingCoderOptionLabel({
      trainingId: 33,
      trainingLabel: 'Duplicate Label',
      coderName: 'coder1'
    })).toBe('Duplicate Label · ID 33: coder1');

    component.applyTrainingFilter({ target: { value: '33' } } as unknown as Event);

    expect(component.filteredTrainings).toEqual([training]);
  });

  it('should show discussion result as the main header and manager as subordinate info', () => {
    component.comparisonMode = 'within-training';
    component.selectedTrainingForWithin = 1;
    component.availableCoders = [{ jobId: 1, coderName: 'Coder1' }];
    component.codersFormControl.setValue([1]);
    component.discussionManagerLabel = 'reichlej@gmx.de';
    component.withinTrainingData = [
      {
        responseId: 1,
        unitName: 'Unit1',
        variableId: 'Var1',
        testperson: 'Test1',
        coders: [
          {
            jobId: 1,
            coderName: 'Coder1',
            code: 'A',
            score: null
          }
        ]
      }
    ];
    component.dataSource.data = component.withinTrainingData;

    (component as unknown as { updateDisplayedColumns: () => void }).updateDisplayedColumns();
    fixture.detectChanges();

    const discussionHeader: HTMLElement | null = fixture.nativeElement.querySelector('.mat-column-discussion');

    expect(discussionHeader?.textContent).toContain('Diskussionsergebnis');
    expect(discussionHeader?.textContent).toContain('Manager: reichlej@gmx.de');
  });

  it('should apply combined table filters for task, variable, person, agreement and notes', () => {
    component.comparisonMode = 'between-trainings';
    component.codersFromTrainingsFormControl.setValue(['1_101', '2_201']);
    component.selectedCodersFromTrainings = new Set(['1_101', '2_201']);
    component.comparisonData = [
      {
        responseId: 1,
        unitName: 'Unit A',
        variableId: 'VAR_1',
        testPerson: 'Test1',
        personLogin: 'login-1',
        personCode: 'Code1',
        personGroup: 'Group A',
        coders: [
          {
            trainingId: 1,
            trainingLabel: 'Training 1',
            coderId: 101,
            coderName: 'Coder 101',
            code: '1',
            score: 1,
            notes: null
          },
          {
            trainingId: 2,
            trainingLabel: 'Training 2',
            coderId: 201,
            coderName: 'Coder 201',
            code: '1',
            score: 1,
            notes: null
          }
        ]
      },
      {
        responseId: 2,
        unitName: 'Unit A',
        variableId: 'VAR_2',
        testPerson: 'Test2',
        personLogin: 'login-2',
        personCode: 'Code2',
        personGroup: 'Group A',
        coders: [
          {
            trainingId: 1,
            trainingLabel: 'Training 1',
            coderId: 101,
            coderName: 'Coder 101',
            code: '1',
            score: 1,
            notes: 'Bitte besprechen'
          },
          {
            trainingId: 2,
            trainingLabel: 'Training 2',
            coderId: 201,
            coderName: 'Coder 201',
            code: '2',
            score: 0,
            notes: null
          }
        ]
      },
      {
        responseId: 3,
        unitName: 'Unit B',
        variableId: 'VAR_2',
        testPerson: 'Test3',
        personLogin: 'login-2',
        personCode: 'Code3',
        personGroup: 'Group B',
        coders: [
          {
            trainingId: 1,
            trainingLabel: 'Training 1',
            coderId: 101,
            coderName: 'Coder 101',
            code: '1',
            score: 1,
            notes: 'Andere Aufgabe'
          },
          {
            trainingId: 2,
            trainingLabel: 'Training 2',
            coderId: 201,
            coderName: 'Coder 201',
            code: '2',
            score: 0,
            notes: null
          }
        ]
      }
    ];
    component.dataSource.data = component.comparisonData;

    component.tableFilters = {
      unitName: 'unit a',
      variableId: 'var_2',
      personLogin: 'LOGIN-2',
      personGroup: 'group a',
      match: 'differ',
      notesMode: 'with-notes'
    };
    component.applyTableFilters();

    expect(component.getFilteredRowsCount()).toBe(1);
    expect(component.dataSource.filteredData.map(row => row.responseId)).toEqual([2]);
    expect(component.totalComparisons).toBe(1);
    expect(component.matchingComparisons).toBe(0);
  });

  it('should distinguish rows without visible coder notes from rows with visible coder notes', () => {
    component.comparisonMode = 'between-trainings';
    component.codersFromTrainingsFormControl.setValue(['1_101', '2_201']);
    component.selectedCodersFromTrainings = new Set(['1_101', '2_201']);
    component.comparisonData = [
      {
        responseId: 10,
        unitName: 'Unit A',
        variableId: 'VAR_1',
        testPerson: 'Test1',
        personLogin: 'login-1',
        personCode: 'Code1',
        personGroup: 'Group A',
        coders: [
          {
            trainingId: 1,
            trainingLabel: 'Training 1',
            coderId: 101,
            coderName: 'Visible Coder 1',
            code: '1',
            score: 1,
            notes: null
          },
          {
            trainingId: 2,
            trainingLabel: 'Training 2',
            coderId: 201,
            coderName: 'Visible Coder 2',
            code: '1',
            score: 1,
            notes: '   '
          },
          {
            trainingId: 3,
            trainingLabel: 'Training 3',
            coderId: 301,
            coderName: 'Hidden Coder',
            code: '2',
            score: 0,
            notes: 'Notiz eines ausgeblendeten Kodierers'
          }
        ]
      },
      {
        responseId: 11,
        unitName: 'Unit A',
        variableId: 'VAR_2',
        testPerson: 'Test2',
        personLogin: 'login-2',
        personCode: 'Code2',
        personGroup: 'Group A',
        coders: [
          {
            trainingId: 1,
            trainingLabel: 'Training 1',
            coderId: 101,
            coderName: 'Visible Coder 1',
            code: '1',
            score: 1,
            notes: 'Sichtbare Notiz'
          },
          {
            trainingId: 2,
            trainingLabel: 'Training 2',
            coderId: 201,
            coderName: 'Visible Coder 2',
            code: '2',
            score: 0,
            notes: null
          }
        ]
      }
    ];
    component.dataSource.data = component.comparisonData;

    component.tableFilters.notesMode = 'with-notes';
    component.applyTableFilters();

    expect(component.dataSource.filteredData.map(row => row.responseId)).toEqual([11]);

    component.tableFilters.notesMode = 'none';
    component.applyTableFilters();

    expect(component.dataSource.filteredData.map(row => row.responseId)).toEqual([10]);
  });

  it('should render compact coding issue badges and only real note icons in coder cells', () => {
    component.comparisonMode = 'between-trainings';
    component.availableCodersFromTrainings = [
      {
        trainingId: 1,
        trainingLabel: 'Training A',
        coderId: 101,
        coderName: 'Ada'
      },
      {
        trainingId: 2,
        trainingLabel: 'Training B',
        coderId: 201,
        coderName: 'Ben'
      }
    ];
    component.codersFromTrainingsFormControl.setValue(['1_101', '2_201']);
    component.selectedCodersFromTrainings = new Set(['1_101', '2_201']);
    component.comparisonData = [
      {
        responseId: 12,
        unitName: 'Unit A',
        variableId: 'VAR_1',
        testPerson: 'Test1',
        personLogin: 'login-1',
        personCode: 'Code1',
        personGroup: 'Group A',
        coders: [
          {
            trainingId: 1,
            trainingLabel: 'Training A',
            coderId: 101,
            coderName: 'Ada',
            code: '7',
            score: 2,
            notes: ' Bitte prüfen ',
            codingIssueOption: -1
          },
          {
            trainingId: 2,
            trainingLabel: 'Training B',
            coderId: 201,
            coderName: 'Ben',
            code: '-2',
            score: null,
            notes: '   ',
            codingIssueOption: -2
          }
        ]
      }
    ];
    component.dataSource.data = component.comparisonData;

    (component as unknown as { updateDisplayedColumns: () => void }).updateDisplayedColumns();
    fixture.detectChanges();

    const tableText = ((fixture.nativeElement as HTMLElement).textContent || '').replace(/\s+/g, ' ');
    const issueIcons = fixture.nativeElement.querySelectorAll('.coding-issue-icon');
    const issueBadges = fixture.nativeElement.querySelectorAll('.coding-issue-badge');
    const noteIcons = fixture.nativeElement.querySelectorAll('.note-icon');
    const adaResult = component.comparisonData[0].coders[0];
    const benResult = component.comparisonData[0].coders[1];

    expect(tableText).toContain('Code:7');
    expect(tableText).toContain('Score: 2');
    expect(tableText).toContain('Code:Neuer Code nötig');
    expect(tableText).toContain('Unsicher');
    expect(tableText).toContain('Neuer Code');
    expect(issueIcons).toHaveLength(2);
    expect(issueBadges).toHaveLength(2);
    expect(noteIcons).toHaveLength(1);
    expect(component.getDisplayCodeText('7', -1)).toBe('7');
    expect(component.getDisplayCodeText('-2', -2)).toBe('Neuer Code nötig');
    expect(component.getCodingIssueShortLabel(-1)).toBe('Unsicher');
    expect(component.getCodingIssueShortLabel(-2)).toBe('Neuer Code');
    expect(component.getCoderNoteTooltip(adaResult)).toBe('Training A - Ada: Bitte prüfen');
    expect(component.getCodingIssueTooltip(adaResult)).toBe('Training A - Ada: Code-Vergabe unsicher');
    expect(component.shouldShowScore(adaResult)).toBe(true);
    expect(component.shouldShowScore(benResult)).toBe(false);
  });

  it('should include coder names in note tooltips so multiple notes stay distinguishable', () => {
    expect(component.getCoderNoteTooltip({
      jobId: 1,
      coderName: 'Ada',
      code: '1',
      score: 1,
      notes: 'erste Notiz',
      codingIssueOption: null
    })).toBe('Ada: erste Notiz');
    expect(component.getCoderNoteTooltip({
      jobId: 2,
      coderName: 'Ben',
      code: '2',
      score: 0,
      notes: 'zweite Notiz',
      codingIssueOption: null
    })).toBe('Ben: zweite Notiz');
  });

  it('should initialize discussion values from automatic agreement but not from replay code fallback', () => {
    (component as unknown as {
      initDiscussionValues: (data: Array<{
        responseId: number;
        unitName: string;
        variableId: string;
        replayCode?: number | null;
        replayScore?: number | null;
        discussionCode?: number | null;
        discussionScore?: number | null;
        discussionSource?: 'manual' | 'auto_agreement' | null;
        coders: Array<{ jobId: number; coderName: string; code: string | null; score: number | null }>;
      }>) => void;
    }).initDiscussionValues([
      {
        responseId: 1,
        unitName: 'Unit1',
        variableId: 'Var1',
        replayCode: 5,
        replayScore: 1,
        discussionCode: null,
        discussionScore: null,
        coders: []
      },
      {
        responseId: 2,
        unitName: 'Unit1',
        variableId: 'Var1',
        discussionCode: 7,
        discussionScore: 2,
        discussionSource: 'auto_agreement',
        coders: []
      }
    ]);

    expect(component.discussionCodeByResponseId[1]).toBe('');
    expect(component.discussionScoreByResponseId[1]).toBeNull();
    expect(component.discussionCodeByResponseId[2]).toBe('7');
    expect(component.discussionScoreByResponseId[2]).toBe(2);
  });

  it('should mark automatic agreement in the discussion column', () => {
    component.comparisonMode = 'within-training';
    component.selectedTrainingForWithin = 1;
    component.availableCoders = [{ jobId: 1, coderName: 'Coder1' }];
    component.codersFormControl.setValue([1]);
    component.withinTrainingData = [
      {
        responseId: 1,
        unitName: 'Unit1',
        variableId: 'Var1',
        testperson: 'Test1',
        discussionCode: 7,
        discussionScore: 2,
        discussionSource: 'auto_agreement',
        coders: [
          {
            jobId: 1,
            coderName: 'Coder1',
            code: '7',
            score: 2
          }
        ]
      }
    ];
    component.dataSource.data = component.withinTrainingData;
    component.discussionCodeByResponseId[1] = '7';
    component.discussionScoreByResponseId[1] = 2;

    (component as unknown as { updateDisplayedColumns: () => void }).updateDisplayedColumns();
    fixture.detectChanges();

    const discussionSource: HTMLElement | null = fixture.nativeElement.querySelector('.discussion-source-auto');

    expect(discussionSource?.textContent).toContain('Auto-Konsens');
  });

  it('should not persist an unchanged automatic agreement on blur', () => {
    const row = {
      responseId: 1,
      unitName: 'Unit1',
      variableId: 'Var1',
      testperson: 'Test1',
      discussionCode: 7,
      discussionScore: 2,
      discussionSource: 'auto_agreement' as 'manual' | 'auto_agreement' | null,
      coders: [
        {
          jobId: 1,
          coderName: 'Coder1',
          code: '7',
          score: 2
        },
        {
          jobId: 2,
          coderName: 'Coder2',
          code: '7',
          score: 2
        }
      ]
    };
    component.comparisonMode = 'within-training';
    component.selectedTrainingForWithin = 5;
    component.discussionCodeByResponseId[1] = '7';
    component.discussionScoreByResponseId[1] = 2;

    component.onDiscussionCodeBlur(row);

    expect(codingTrainingBackendService.saveDiscussionResult).not.toHaveBeenCalled();
    expect(component.discussionCodeByResponseId[1]).toBe('7');
    expect(component.discussionScoreByResponseId[1]).toBe(2);
    expect(row.discussionSource).toBe('auto_agreement');
  });

  it('should save an active replay selection with its score as manual discussion result', () => {
    const row = {
      responseId: 1,
      unitName: 'Unit1',
      variableId: 'Var1',
      testperson: 'login@code@booklet',
      discussionCode: null,
      discussionScore: null,
      discussionSource: 'auto_agreement' as 'manual' | 'auto_agreement' | null,
      coders: [
        {
          jobId: 1,
          coderName: 'Coder1',
          code: '3',
          score: 1
        }
      ]
    };
    component.comparisonMode = 'within-training';
    component.selectedTrainingForWithin = 5;
    component.withinTrainingData = [row];

    (component as unknown as {
      handleReplayCodeSelected: (data: {
        type: 'replayCodeSelected';
        testPerson: string;
        unitId: string;
        variableId: string;
        code: string;
        score: number | null;
        responseId: number;
      }) => void;
    }).handleReplayCodeSelected({
      type: 'replayCodeSelected',
      testPerson: 'login@code@booklet',
      unitId: 'Unit1',
      variableId: 'Var1',
      code: '7',
      score: 2,
      responseId: 1
    });

    expect(codingTrainingBackendService.saveDiscussionResult).toHaveBeenCalledWith(1, 5, 1, 7, 2);
    expect(component.discussionCodeByResponseId[1]).toBe('7');
    expect(component.discussionScoreByResponseId[1]).toBe(2);
    expect(row.discussionCode).toBe(7);
    expect(row.discussionScore).toBe(2);
    expect(row.discussionSource).toBe('manual');
  });

  it('should show a validation message when a discussion code is not supported by the coding scheme', () => {
    const row = {
      responseId: 1,
      unitName: 'Unit1',
      variableId: 'Var1',
      testperson: 'Test1',
      discussionCode: null,
      discussionScore: null,
      discussionSource: null as 'manual' | 'auto_agreement' | null,
      coders: []
    };
    codingTrainingBackendService.saveDiscussionResult.mockReturnValue(throwError(() => new HttpErrorResponse({
      status: 400,
      error: { message: 'Unsupported code for variable Var1: 999' }
    })));
    component.comparisonMode = 'within-training';
    component.selectedTrainingForWithin = 5;
    component.discussionCodeByResponseId[1] = '999';

    component.onDiscussionCodeBlur(row);

    expect(component.discussionErrorByResponseId[1]).toBe('Der Code ist im Kodierschema dieser Variable nicht vorhanden.');
    expect(snackBar.open).toHaveBeenCalledWith(
      'Der Code ist im Kodierschema dieser Variable nicht vorhanden.',
      'common.close',
      { duration: 4000 }
    );
  });

  describe('calculateStatistics', () => {
    it('should calculate statistics correctly for between trainings mode', () => {
      component.comparisonMode = 'between-trainings';
      component.comparisonData = [
        {
          responseId: 1,
          unitName: 'Unit1',
          variableId: 'Var1',
          testPerson: 'Test1',
          personLogin: 'Login1',
          personCode: 'Code1',
          personGroup: 'Group1',
          coders: [
            {
              trainingId: 1,
              trainingLabel: 'Training 1',
              coderId: 101,
              coderName: 'Coder 101',
              code: 'A',
              score: null
            },
            {
              trainingId: 2,
              trainingLabel: 'Training 2',
              coderId: 102,
              coderName: 'Coder 102',
              code: 'A',
              score: null
            }
          ]
        },
        {
          responseId: 2,
          unitName: 'Unit2',
          variableId: 'Var2',
          testPerson: 'Test2',
          personLogin: 'Login2',
          personCode: 'Code2',
          personGroup: 'Group2',
          coders: [
            {
              trainingId: 1,
              trainingLabel: 'Training 1',
              coderId: 101,
              coderName: 'Coder 101',
              code: 'B',
              score: null
            },
            {
              trainingId: 2,
              trainingLabel: 'Training 2',
              coderId: 102,
              coderName: 'Coder 102',
              code: 'C',
              score: null
            }
          ]
        },
        {
          responseId: 3,
          unitName: 'Unit3',
          variableId: 'Var3',
          testPerson: 'Test3',
          personLogin: 'Login3',
          personCode: 'Code3',
          personGroup: 'Group3',
          coders: [
            {
              trainingId: 1,
              trainingLabel: 'Training 1',
              coderId: 101,
              coderName: 'Coder 101',
              code: 'D',
              score: null
            },
            {
              trainingId: 2,
              trainingLabel: 'Training 2',
              coderId: 102,
              coderName: 'Coder 102',
              code: 'E',
              score: null
            }
          ]
        }
      ];

      component.dataSource.data = component.comparisonData;
      component.codersFromTrainingsFormControl.setValue(['1_101', '2_102']);
      component.selectedCodersFromTrainings = new Set(['1_101', '2_102']);
      component.calculateStatistics();

      expect(component.totalComparisons).toBe(3);
      expect(component.matchingComparisons).toBe(1); // First comparison matches; the other rows differ.
      expect(component.matchingPercentage).toBe(33); // 1 out of 3 = 33%
    });

    it('should treat selected but missing coder results as incomplete instead of matching', () => {
      component.comparisonMode = 'between-trainings';
      component.codersFromTrainingsFormControl.setValue(['1_101', '2_102']);
      component.comparisonData = [
        {
          responseId: 1,
          unitName: 'Unit1',
          variableId: 'Var1',
          testPerson: 'Test1',
          personLogin: 'Login1',
          personCode: 'Code1',
          personGroup: 'Group1',
          coders: [
            {
              trainingId: 1,
              trainingLabel: 'Training 1',
              coderId: 101,
              coderName: 'Coder 101',
              code: 'A',
              score: null
            }
          ]
        }
      ];
      component.dataSource.data = component.comparisonData;

      component.calculateStatistics();

      expect(component.getComparisonStatus(component.comparisonData[0])).toBe('incomplete');
      expect(component.areCodesTheSame(component.comparisonData[0])).toBe(false);
      expect(component.totalComparisons).toBe(0);
      expect(component.incompleteComparisons).toBe(1);

      component.tableFilters.match = 'match';
      component.applyTableFilters();

      expect(component.getFilteredRowsCount()).toBe(0);
      expect(component.hasFilterEmptyState()).toBe(true);
    });

    it('should keep a selected training without coder columns visible as incomplete', () => {
      component.comparisonMode = 'between-trainings';
      component.selectedTrainings.select(1, 2);
      component.codersFromTrainingsFormControl.setValue(['1_101', '1_102']);
      component.comparisonData = [
        {
          responseId: 1,
          unitName: 'Unit1',
          variableId: 'Var1',
          testPerson: 'Test1',
          personLogin: 'Login1',
          personCode: 'Code1',
          personGroup: 'Group1',
          coders: [
            {
              trainingId: 1,
              trainingLabel: 'Training 1',
              coderId: 101,
              coderName: 'Coder 101',
              code: 'A',
              score: null
            },
            {
              trainingId: 1,
              trainingLabel: 'Training 1',
              coderId: 102,
              coderName: 'Coder 102',
              code: 'A',
              score: null
            }
          ]
        }
      ];
      component.dataSource.data = component.comparisonData;

      component.calculateStatistics();

      expect(component.getComparisonStatus(component.comparisonData[0])).toBe('incomplete');
      expect(component.totalComparisons).toBe(0);
      expect(component.incompleteComparisons).toBe(1);
    });

    it('should calculate statistics correctly for within training mode', () => {
      component.comparisonMode = 'within-training';
      component.withinTrainingData = [
        {
          responseId: 1,
          unitName: 'Unit1',
          variableId: 'Var1',
          testperson: 'Test1',
          coders: [
            {
              jobId: 1,
              coderName: 'Coder1',
              code: 'A',
              score: null
            },
            {
              jobId: 2,
              coderName: 'Coder2',
              code: 'A',
              score: null
            }
          ]
        },
        {
          responseId: 2,
          unitName: 'Unit2',
          variableId: 'Var2',
          testperson: 'Test2',
          coders: [
            {
              jobId: 1,
              coderName: 'Coder1',
              code: 'B',
              score: null
            },
            {
              jobId: 2,
              coderName: 'Coder2',
              code: 'C',
              score: null
            }
          ]
        }
      ];

      component.dataSource.data = component.withinTrainingData;
      component.codersFormControl.setValue([1, 2]);
      component.calculateStatistics();

      expect(component.totalComparisons).toBe(2);
      expect(component.matchingComparisons).toBe(1); // First matches, second differs
      expect(component.matchingPercentage).toBe(50); // 1 out of 2 = 50%
    });

    it('should handle empty data correctly', () => {
      component.comparisonMode = 'between-trainings';
      component.comparisonData = [];

      component.calculateStatistics();

      expect(component.totalComparisons).toBe(0);
      expect(component.matchingComparisons).toBe(0);
      expect(component.matchingPercentage).toBe(0);
    });
  });

  it('should restore backend-authoritative automatic agreement when clearing a manual discussion result', () => {
    codingTrainingBackendService.saveDiscussionResult.mockReturnValueOnce(of({
      success: true,
      code: 7,
      score: 2,
      source: 'auto_agreement',
      managerUserId: null,
      managerName: null
    }));
    const row = {
      responseId: 1,
      unitName: 'Unit1',
      variableId: 'Var1',
      testperson: 'Test1',
      discussionCode: 8,
      discussionScore: 2,
      discussionSource: 'manual' as 'manual' | 'auto_agreement' | null,
      coders: [
        {
          jobId: 1,
          coderName: 'Coder1',
          code: '7',
          score: 2
        },
        {
          jobId: 2,
          coderName: 'Coder2',
          code: '7',
          score: 2
        }
      ]
    };
    component.comparisonMode = 'within-training';
    component.selectedTrainingForWithin = 5;
    component.discussionCodeByResponseId[1] = '';

    component.onDiscussionCodeBlur(row);

    expect(codingTrainingBackendService.saveDiscussionResult).toHaveBeenCalledWith(1, 5, 1, null, null);
    expect(component.discussionCodeByResponseId[1]).toBe('7');
    expect(component.discussionScoreByResponseId[1]).toBe(2);
    expect(row.discussionCode).toBe(7);
    expect(row.discussionScore).toBe(2);
    expect(row.discussionSource).toBe('auto_agreement');
  });

  it('should clear stale kappa values when changing comparison mode', () => {
    component.kappaStatistics = {
      variables: [],
      workspaceSummary: {
        totalDoubleCodedResponses: 10,
        totalCoderPairs: 1,
        averageKappa: 1,
        variablesIncluded: 1,
        codersIncluded: 2,
        weightingMethod: 'weighted'
      }
    };
    component.originalKappaStatistics = component.kappaStatistics;

    component.onModeChange();

    expect(component.kappaStatistics).toBeNull();
    expect(component.originalKappaStatistics).toBeNull();
    expect(component.variableKappaSummaries).toEqual([]);
  });

  it('should render mean kappa summaries per variable', () => {
    component.comparisonMode = 'within-training';
    component.selectedTrainingForWithin = 5;
    component.showKappaStatistics = true;
    component.codersFormControl.setValue([1, 2, 3]);
    component.withinTrainingData = [
      {
        responseId: 1,
        unitName: 'U1',
        variableId: 'V1',
        testperson: 'Test1',
        coders: [
          {
            jobId: 1,
            coderName: 'C1',
            code: '1',
            score: null
          },
          {
            jobId: 2,
            coderName: 'C2',
            code: '1',
            score: null
          }
        ]
      }
    ];
    component.originalKappaStatistics = {
      variables: [
        {
          unitName: 'U1',
          variableId: 'V1',
          coderPairs: [
            {
              coder1Id: 1,
              coder1Name: 'C1',
              coder2Id: 2,
              coder2Name: 'C2',
              kappa: 0.82,
              agreement: 0.9,
              totalItems: 10,
              validPairs: 10,
              interpretation: 'kappa.good'
            },
            {
              coder1Id: 1,
              coder1Name: 'C1',
              coder2Id: 3,
              coder2Name: 'C3',
              kappa: 0.88,
              agreement: 0.8,
              totalItems: 5,
              validPairs: 5,
              interpretation: 'kappa.good'
            }
          ]
        }
      ],
      workspaceSummary: {
        totalDoubleCodedResponses: 1,
        totalCoderPairs: 2,
        averageKappa: 0.84,
        variablesIncluded: 1,
        codersIncluded: 3,
        weightingMethod: 'weighted'
      }
    };

    component.useWeightedMean = true;
    component.filterKappaStatistics();
    fixture.detectChanges();

    const summaryTable: HTMLElement | null = fixture.nativeElement.querySelector('.variable-mean-table');
    const inlineSummary: HTMLElement | null = fixture.nativeElement.querySelector('.variable-summary-box');
    const tableText = summaryTable?.textContent?.replace(/\s+/g, ' ');
    const inlineSummaryText = inlineSummary?.textContent?.replace(/\s+/g, ' ');

    expect(component.variableKappaSummaries).toHaveLength(1);
    expect(component.variableKappaSummaries[0]).toMatchObject({
      key: 'U1::V1',
      unitName: 'U1',
      variableId: 'V1',
      caseCount: 1,
      validPairCount: 15
    });
    expect(component.variableKappaSummaries[0].meanKappa).toBeCloseTo(0.84, 10);
    expect(component.variableKappaSummaries[0].meanAgreement).toBeCloseTo(0.866666, 5);
    expect(tableText).toContain('Mittelwerte je Variable');
    expect(tableText).toContain('Gültige Paarwerte');
    expect(tableText).toContain('U1 - V1');
    expect(tableText).toContain('0.840');
    expect(tableText).toContain('86.7%');
    expect(tableText).toContain('15');
    expect(inlineSummaryText).toContain('Mittelwert U1 - V1');
    expect(inlineSummaryText).toContain('Kappa 0.840');
    expect(inlineSummaryText).toContain('Übereinstimmung 86.7%');
    expect(inlineSummaryText).toContain('Fälle 1');
    expect(inlineSummaryText).toContain('Gültige Paarwerte 15');
  });

  it('should render unweighted mean kappa summaries when weighting is disabled', () => {
    component.comparisonMode = 'within-training';
    component.selectedTrainingForWithin = 5;
    component.showKappaStatistics = true;
    component.useWeightedMean = false;
    component.codersFormControl.setValue([1, 2, 3]);
    component.withinTrainingData = [
      {
        responseId: 1,
        unitName: 'U1',
        variableId: 'V1',
        testperson: 'P1',
        discussionCode: null,
        discussionScore: null,
        discussionSource: null,
        coders: [
          {
            jobId: 1,
            coderName: 'C1',
            code: '1',
            score: 1,
            notes: null,
            codingIssueOption: null
          },
          {
            jobId: 2,
            coderName: 'C2',
            code: '1',
            score: 1,
            notes: null,
            codingIssueOption: null
          }
        ]
      }
    ];
    component.originalKappaStatistics = {
      variables: [{
        unitName: 'U1',
        variableId: 'V1',
        coderPairs: [
          {
            coder1Id: 1,
            coder1Name: 'C1',
            coder2Id: 2,
            coder2Name: 'C2',
            kappa: 0.82,
            agreement: 0.9,
            totalItems: 10,
            validPairs: 10,
            interpretation: 'kappa.good'
          },
          {
            coder1Id: 1,
            coder1Name: 'C1',
            coder2Id: 3,
            coder2Name: 'C3',
            kappa: 0.88,
            agreement: 0.8,
            totalItems: 5,
            validPairs: 5,
            interpretation: 'kappa.good'
          }
        ]
      }],
      workspaceSummary: {
        totalDoubleCodedResponses: 1,
        totalCoderPairs: 2,
        averageKappa: 0.85,
        variablesIncluded: 1,
        codersIncluded: 3,
        weightingMethod: 'unweighted'
      }
    };

    component.filterKappaStatistics();

    expect(component.variableKappaSummaries[0].meanKappa).toBeCloseTo(0.85, 10);
    expect(component.variableKappaSummaries[0].meanAgreement).toBeCloseTo(0.85, 10);
  });

  it('should exclude null kappa pairs from filtered workspace average kappa denominator', () => {
    component.comparisonMode = 'within-training';
    component.selectedTrainingForWithin = 5;
    component.useWeightedMean = true;
    component.codersFormControl.setValue([1, 2, 3]);
    component.originalKappaStatistics = {
      variables: [{
        unitName: 'U1',
        variableId: 'V1',
        coderPairs: [
          {
            coder1Id: 1,
            coder1Name: 'C1',
            coder2Id: 2,
            coder2Name: 'C2',
            kappa: 0.8,
            agreement: 0.9,
            totalItems: 10,
            validPairs: 10,
            interpretation: 'kappa.good'
          },
          {
            coder1Id: 1,
            coder1Name: 'C1',
            coder2Id: 3,
            coder2Name: 'C3',
            kappa: null,
            agreement: 0.5,
            totalItems: 100,
            validPairs: 100,
            interpretation: 'kappa.na'
          }
        ]
      }],
      workspaceSummary: {
        totalDoubleCodedResponses: 0,
        totalCoderPairs: 2,
        averageKappa: 0.8,
        variablesIncluded: 1,
        codersIncluded: 3,
        weightingMethod: 'weighted'
      }
    };

    component.filterKappaStatistics();

    expect(component.kappaStatistics?.workspaceSummary.averageKappa).toBeCloseTo(0.8, 10);
    expect(component.kappaStatistics?.workspaceSummary.totalCoderPairs).toBe(2);
  });

  describe('calculateMeanAgreement', () => {
    it('should calculate weighted mean agreement correctly', () => {
      component.kappaStatistics = {
        variables: [
          {
            unitName: 'U1',
            variableId: 'V1',
            coderPairs: [
              {
                coder1Id: 1,
                coder1Name: 'C1',
                coder2Id: 2,
                coder2Name: 'C2',
                kappa: 0.5,
                agreement: 0.8,
                totalItems: 10,
                validPairs: 10,
                interpretation: 'mod'
              },
              {
                coder1Id: 1,
                coder1Name: 'C1',
                coder2Id: 3,
                coder2Name: 'C3',
                kappa: 0.6,
                agreement: 0.9,
                totalItems: 10,
                validPairs: 5,
                interpretation: 'good'
              }
            ]
          }
        ],
        workspaceSummary: {
          totalDoubleCodedResponses: 0,
          totalCoderPairs: 0,
          averageKappa: 0,
          variablesIncluded: 0,
          codersIncluded: 0,
          weightingMethod: 'weighted'
        }
      };
      component.useWeightedMean = true;
      component.calculateMeanAgreement();

      // Weighted mean: (0.8 * 10 + 0.9 * 5) / (10 + 5) = (8 + 4.5) / 15 = 12.5 / 15 = 0.8333...
      expect(component.kappaStatistics?.workspaceSummary.meanAgreement).toBeCloseTo(0.8333, 4);
    });

    it('should calculate unweighted mean agreement correctly', () => {
      component.kappaStatistics = {
        variables: [
          {
            unitName: 'U1',
            variableId: 'V1',
            coderPairs: [
              {
                coder1Id: 1,
                coder1Name: 'C1',
                coder2Id: 2,
                coder2Name: 'C2',
                kappa: 0.5,
                agreement: 0.8,
                totalItems: 10,
                validPairs: 10,
                interpretation: 'mod'
              },
              {
                coder1Id: 1,
                coder1Name: 'C1',
                coder2Id: 3,
                coder2Name: 'C3',
                kappa: 0.6,
                agreement: 0.9,
                totalItems: 10,
                validPairs: 5,
                interpretation: 'good'
              }
            ]
          }
        ],
        workspaceSummary: {
          totalDoubleCodedResponses: 0,
          totalCoderPairs: 0,
          averageKappa: 0,
          variablesIncluded: 0,
          codersIncluded: 0,
          weightingMethod: 'unweighted'
        }
      };
      component.useWeightedMean = false;
      component.calculateMeanAgreement();

      // Unweighted mean: (0.8 + 0.9) / 2 = 0.85
      expect(component.kappaStatistics?.workspaceSummary.meanAgreement).toBeCloseTo(0.85, 4);
    });
  });
});
