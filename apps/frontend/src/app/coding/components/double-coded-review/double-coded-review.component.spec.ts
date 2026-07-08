import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { OverlayContainer } from '@angular/cdk/overlay';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { AppService } from '../../../core/services/app.service';
import { WorkspaceBackendService } from '../../../workspace/services/workspace-backend.service';
import { CodingFacadeService } from '../../../services/facades/coding-facade.service';
import { TestPersonCodingService } from '../../services/test-person-coding.service';
import { CodingStatisticsService } from '../../services/coding-statistics.service';
import { DoubleCodedReviewComponent } from './double-coded-review.component';
import { SessionRecoveryService } from '../../../core/services/session-recovery.service';

describe('DoubleCodedReviewComponent', () => {
  let component: DoubleCodedReviewComponent;
  let fixture: ComponentFixture<DoubleCodedReviewComponent>;
  let overlayContainer: OverlayContainer;

  type ReplaySelectionMessage = {
    type: 'replayCodeSelected';
    testPerson: string;
    unitId: string;
    variableId: unknown;
    code: unknown;
    score?: unknown;
    notes?: unknown;
    responseId: number;
  };

  type ReplaySelectionHarness = {
    handleReplayCodeSelected: (
      message: ReplaySelectionMessage,
      source: MessageEventSource | null,
      origin?: string
    ) => void;
    replayWindowByResponseId: Map<number, MessageEventSource>;
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        DoubleCodedReviewComponent,
        TranslateModule.forRoot()
      ],
      providers: [
        provideNoopAnimations(),
        {
          provide: AppService,
          useValue: {
            selectedWorkspaceId: 1,
            authData: { userName: 'Reviewer' },
            loggedUser: undefined,
            createOwnToken: jest.fn(() => of('token'))
          }
        },
        {
          provide: WorkspaceBackendService,
          useValue: {
            getWorkspaceCoders: jest.fn(() => of({
              data: [
                { userId: 10, username: 'Coder A' },
                { userId: 20, username: 'Coder B' }
              ]
            }))
          }
        },
        {
          provide: CodingFacadeService,
          useValue: {
            getJobDefinitions: jest.fn(() => of([
              { id: 99, status: 'approved', createdJobsCount: 2 }
            ])),
            getCoderTrainings: jest.fn(() => of([]))
          }
        },
        {
          provide: TestPersonCodingService,
          useValue: {
            getDoubleCodedVariablesForReview: jest.fn(() => of({
              data: [
                {
                  responseId: 501,
                  unitName: 'Unit A',
                  variableId: 'VAR_1',
                  personLogin: 'person-1',
                  personCode: 'P001',
                  bookletName: 'Booklet 1',
                  givenAnswer: 'answer',
                  isResolved: false,
                  appliedCode: null,
                  appliedScore: null,
                  appliedComment: null,
                  coderResults: [
                    {
                      coderId: 10,
                      coderName: 'Coder A',
                      jobId: 1001,
                      jobName: 'Definition 99 / A',
                      code: 1,
                      codingIssueOption: -3,
                      score: 0,
                      notes: null,
                      supervisorComment: null,
                      codedAt: '2026-05-20T09:00:00.000Z'
                    },
                    {
                      coderId: 20,
                      coderName: 'Coder B',
                      jobId: 1002,
                      jobName: 'Definition 99 / B',
                      code: 2,
                      score: 1,
                      notes: 'Check manually',
                      supervisorComment: null,
                      codedAt: '2026-05-20T09:10:00.000Z'
                    }
                  ]
                },
                {
                  responseId: 502,
                  unitName: 'Unit B',
                  variableId: 'VAR_2',
                  personLogin: 'person-2',
                  personCode: 'P002',
                  bookletName: 'Booklet 1',
                  givenAnswer: 'second answer',
                  isResolved: false,
                  appliedCode: null,
                  appliedScore: null,
                  appliedComment: null,
                  coderResults: [
                    {
                      coderId: 10,
                      coderName: 'Coder A',
                      jobId: 2001,
                      jobName: 'Definition 100 / A',
                      code: 1,
                      score: 0,
                      notes: null,
                      supervisorComment: null,
                      codedAt: '2026-05-20T10:00:00.000Z'
                    },
                    {
                      coderId: 20,
                      coderName: 'Coder B',
                      jobId: 2002,
                      jobName: 'Definition 100 / B',
                      code: 1,
                      score: 0,
                      notes: null,
                      supervisorComment: null,
                      codedAt: '2026-05-20T10:10:00.000Z'
                    }
                  ]
                },
                {
                  responseId: 503,
                  unitName: 'Unit C',
                  variableId: 'VAR_3',
                  personLogin: 'person-3',
                  personCode: 'P003',
                  bookletName: 'Booklet 2',
                  givenAnswer: 'third answer',
                  isResolved: false,
                  appliedCode: null,
                  appliedScore: null,
                  appliedComment: null,
                  coderResults: [
                    {
                      coderId: 10,
                      coderName: 'Coder A',
                      jobId: 3001,
                      jobName: 'Definition 101 / A',
                      code: 1,
                      score: 0,
                      notes: null,
                      supervisorComment: null,
                      codedAt: '2026-05-20T11:00:00.000Z'
                    },
                    {
                      coderId: 10,
                      coderName: 'Coder A renamed',
                      jobId: 3002,
                      jobName: 'Definition 102 / A',
                      code: 2,
                      score: 1,
                      notes: null,
                      supervisorComment: null,
                      codedAt: '2026-05-20T11:10:00.000Z'
                    }
                  ]
                },
                {
                  responseId: 504,
                  unitName: 'Unit D',
                  variableId: 'VAR_4',
                  personLogin: 'person-4',
                  personCode: 'P004',
                  bookletName: 'Booklet 2',
                  givenAnswer: 'fourth answer',
                  isResolved: true,
                  appliedCode: 2,
                  appliedScore: 1,
                  appliedComment: 'Final decision note',
                  coderResults: [
                    {
                      coderId: 10,
                      coderName: 'Coder A',
                      jobId: 4001,
                      jobName: 'Definition 103 / A',
                      code: 1,
                      score: 0,
                      notes: null,
                      supervisorComment: null,
                      codedAt: '2026-05-20T12:00:00.000Z'
                    },
                    {
                      coderId: 20,
                      coderName: 'Coder B',
                      jobId: 4002,
                      jobName: 'Definition 103 / B',
                      code: 2,
                      score: 1,
                      notes: null,
                      supervisorComment: 'Final decision note',
                      codedAt: '2026-05-20T12:10:00.000Z'
                    }
                  ]
                }
              ],
              total: 4,
              page: 1,
              limit: 50
            })),
            applyDoubleCodedResolutions: jest.fn(() => of({
              success: true,
              appliedCount: 1,
              failedCount: 0,
              skippedCount: 0,
              message: 'ok'
            })),
            notifyTestResultsChanged: jest.fn()
          }
        },
        {
          provide: CodingStatisticsService,
          useValue: {
            getReplayUrl: jest.fn(() => of({ replayUrl: '' }))
          }
        },
        {
          provide: MatSnackBar,
          useValue: { open: jest.fn() }
        },
        {
          provide: MatDialog,
          useValue: {
            open: jest.fn(() => ({ afterClosed: () => of(false) }))
          }
        }
      ]
    }).compileComponents();

    overlayContainer = TestBed.inject(OverlayContainer);
    fixture = TestBed.createComponent(DoubleCodedReviewComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    overlayContainer.ngOnDestroy();
    sessionStorage.clear();
  });

  it('renders the reusable decision cell and updates its selection through Material select', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const nativeElement = fixture.nativeElement as HTMLElement;
    const selectionCell = nativeElement.querySelector('td.mat-column-selection .selection-cell') as HTMLElement;

    expect(selectionCell).toBeTruthy();
    expect(selectionCell.querySelector('.decision-status.conflict')?.textContent)
      .toContain('double-coded-review.decision.status-inter-coder-conflict');
    expect(selectionCell.querySelector('.decision-code-value')?.textContent?.trim()).toBe('1');
    expect(selectionCell.querySelector('.decision-source')?.textContent).toContain('Coder A');
    expect(selectionCell.querySelector('.comment-field')).toBeTruthy();

    const selectTrigger = selectionCell.querySelector('.mat-mdc-select-trigger') as HTMLElement;
    selectTrigger.click();
    fixture.detectChanges();
    await fixture.whenStable();

    const options = Array.from(
      overlayContainer.getContainerElement().querySelectorAll('mat-option')
    ) as HTMLElement[];

    expect(options).toHaveLength(2);

    options[1].click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const reviewItem = component.dataSource.data[0];
    expect(component.selectionForm.get(component.getItemControlName(reviewItem))?.value).toBe('1002');
    expect(selectionCell.querySelector('.decision-code-value')?.textContent?.trim()).toBe('2');
    expect(selectionCell.querySelector('.decision-source')?.textContent).toContain('Coder B');
  });

  it('creates one dynamic column per coder and exposes alternate coder names in the tooltip', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.dynamicCoderColumns).toEqual(['coder_10', 'coder_20']);

    const nativeElement = fixture.nativeElement as HTMLElement;
    const coderHeaders = Array.from(
      nativeElement.querySelectorAll('th.mat-column-coder_10, th.mat-column-coder_20')
    ) as HTMLElement[];

    expect(coderHeaders).toHaveLength(2);
    expect(coderHeaders.map(header => header.textContent?.trim())).toEqual(['Coder A', 'Coder B']);
    expect(component.coderColumnMeta.coder_10.coderNames).toEqual(['Coder A', 'Coder A renamed']);
    expect(component.getCoderColumnTooltip('coder_10')).toContain('Weitere Namen: Coder A renamed');
  });

  it('opens replay in coding decision mode for double-coded review decisions', async () => {
    const codingStatisticsService = TestBed.inject(CodingStatisticsService) as unknown as {
      getReplayUrl: jest.Mock;
    };
    const openSpy = jest.spyOn(window, 'open').mockImplementation(() => null);
    codingStatisticsService.getReplayUrl.mockReturnValue(of({
      replayUrl: 'http://localhost:3333/#/replay/person/unit/0/VAR_1?workspaceId=1'
    }));

    fixture.detectChanges();
    await fixture.whenStable();
    component.openReplay(501);

    expect(codingStatisticsService.getReplayUrl).toHaveBeenCalledWith(1, 501);
    const openedUrl = openSpy.mock.calls[0][0] as string;
    expect(openedUrl).toContain(
      `${window.location.origin}/#/replay/person/unit/0/VAR_1?workspaceId=1&mode=coding-decision&originResponseId=501`
    );
    const reviewCodeSelections = new URLSearchParams(openedUrl.split('?')[1]).get('reviewCodeSelections');
    expect(JSON.parse(reviewCodeSelections || '[]')).toEqual([
      { code: -3, coderNames: ['Coder A'] },
      { code: 2, coderNames: ['Coder B'] }
    ]);
    expect(openSpy).toHaveBeenCalledWith(openedUrl, '_blank');
  });

  it('captures changed review selections as a recovery draft', async () => {
    const sessionRecoveryService = TestBed.inject(SessionRecoveryService);
    fixture.detectChanges();
    await fixture.whenStable();

    const reviewItem = component.dataSource.data[0];
    component.selectionForm.get(component.getItemControlName(reviewItem))?.setValue('1002');
    component.getCommentControl(reviewItem).setValue('Recovered comment');

    sessionRecoveryService.captureRegisteredDrafts();

    expect(sessionRecoveryService.peekDraft('double-coded-review-active-state')).toEqual({
      workspaceId: 1,
      entries: [
        {
          responseId: 501,
          selectedValue: '1002',
          comment: 'Recovered comment'
        }
      ]
    });
  });

  it('restores review selections from a recovery draft', async () => {
    const sessionRecoveryService = TestBed.inject(SessionRecoveryService);
    fixture.detectChanges();
    await fixture.whenStable();

    sessionRecoveryService.saveDraft('double-coded-review-active-state', {
      workspaceId: 1,
      entries: [
        {
          responseId: 501,
          selectedValue: '1002',
          comment: 'Recovered comment'
        }
      ]
    });

    sessionRecoveryService.notifyRestoredAuthentication();

    const reviewItem = component.dataSource.data[0];
    expect(component.selectionForm.get(component.getItemControlName(reviewItem))?.value).toBe('1002');
    expect(component.selectionForm.get(component.getCommentControlName(reviewItem))?.value).toBe('Recovered comment');
  });

  it('selects an available coder result from a replay code selection', async () => {
    const snackBar = TestBed.inject(MatSnackBar) as unknown as { open: jest.Mock };
    const replaySource = {} as MessageEventSource;
    const harness = component as unknown as ReplaySelectionHarness;
    fixture.detectChanges();
    await fixture.whenStable();

    snackBar.open.mockClear();
    harness.replayWindowByResponseId.set(501, replaySource);
    harness.handleReplayCodeSelected({
      type: 'replayCodeSelected',
      testPerson: 'person-1@P001@Booklet 1',
      unitId: 'Unit A',
      variableId: 'VAR_1',
      code: '2',
      score: 1,
      notes: 'Replay note',
      responseId: 501
    }, replaySource);

    const item = component.dataSource.data.find(row => row.responseId === 501);
    expect(component.selectionForm.get('item_501')?.value).toBe('1002');
    expect(component.selectionForm.get('comment_501')?.value).toBe('Replay note');
    expect(item?.selectedCoderResult?.jobId).toBe(1002);
    expect(snackBar.open).toHaveBeenCalledWith(
      'double-coded-review.success.replay-code-selected',
      'close',
      expect.objectContaining({ panelClass: ['success-snackbar'] })
    );
  });

  it('clears a transferred replay note when the replay sends empty notes', async () => {
    const replaySource = {} as MessageEventSource;
    const harness = component as unknown as ReplaySelectionHarness;
    fixture.detectChanges();
    await fixture.whenStable();

    harness.replayWindowByResponseId.set(501, replaySource);
    harness.handleReplayCodeSelected({
      type: 'replayCodeSelected',
      testPerson: 'person-1@P001@Booklet 1',
      unitId: 'Unit A',
      variableId: 'VAR_1',
      code: '2',
      score: 1,
      notes: 'Replay note',
      responseId: 501
    }, replaySource);

    expect(component.selectionForm.get('comment_501')?.value).toBe('Replay note');

    harness.handleReplayCodeSelected({
      type: 'replayCodeSelected',
      testPerson: 'person-1@P001@Booklet 1',
      unitId: 'Unit A',
      variableId: 'VAR_1',
      code: '2',
      score: 1,
      notes: '   ',
      responseId: 501
    }, replaySource);

    expect(component.selectionForm.get('comment_501')?.value).toBe('');
  });

  it('keeps existing comments when replay selections do not include notes', async () => {
    const replaySource = {} as MessageEventSource;
    const harness = component as unknown as ReplaySelectionHarness;
    fixture.detectChanges();
    await fixture.whenStable();

    const item = component.dataSource.data.find(row => row.responseId === 501)!;
    component.getCommentControl(item).setValue('Manual review comment');
    harness.replayWindowByResponseId.set(501, replaySource);

    harness.handleReplayCodeSelected({
      type: 'replayCodeSelected',
      testPerson: 'person-1@P001@Booklet 1',
      unitId: 'Unit A',
      variableId: 'VAR_1',
      code: '2',
      score: 1,
      responseId: 501
    }, replaySource);

    expect(component.selectionForm.get('comment_501')?.value).toBe('Manual review comment');
  });

  it('stores and applies a replay code selection that has no coder result', async () => {
    const testPersonCodingService = TestBed.inject(TestPersonCodingService) as unknown as {
      applyDoubleCodedResolutions: jest.Mock;
      notifyTestResultsChanged: jest.Mock;
    };
    const replaySource = {} as MessageEventSource;
    const harness = component as unknown as ReplaySelectionHarness;
    fixture.detectChanges();
    await fixture.whenStable();

    harness.replayWindowByResponseId.set(501, replaySource);
    harness.handleReplayCodeSelected({
      type: 'replayCodeSelected',
      testPerson: 'person-1@P001@Booklet 1',
      unitId: 'Unit A',
      variableId: 'VAR_1',
      code: '3',
      score: 2,
      notes: 'Replay note',
      responseId: 501
    }, replaySource);

    const item = component.dataSource.data.find(row => row.responseId === 501);
    expect(item).toBeDefined();
    expect(component.selectionForm.get('item_501')?.value).toBe('replay:501');
    expect(component.getSelectedDecisionResult(item!)?.code).toBe(3);
    expect(component.getSelectedDecisionResult(item!)?.score).toBe(2);
    expect(component.getDecisionResultSourceLabel(item!, component.getSelectedDecisionResult(item!)!))
      .toBe('double-coded-review.decision.replay-source');

    testPersonCodingService.applyDoubleCodedResolutions.mockClear();
    component.applySingleDecision(item!);

    expect(testPersonCodingService.applyDoubleCodedResolutions).toHaveBeenCalledWith(1, {
      decisions: [{
        responseId: 501,
        code: 3,
        score: 2,
        resolutionComment: 'Replay note'
      }]
    });
    expect(testPersonCodingService.notifyTestResultsChanged).toHaveBeenCalledWith({
      workspaceId: 1,
      statisticsVersion: 'v2'
    });
  });

  it('stores a replay code selection when only the score differs from coder results', async () => {
    const testPersonCodingService = TestBed.inject(TestPersonCodingService) as unknown as {
      applyDoubleCodedResolutions: jest.Mock;
    };
    const replaySource = {} as MessageEventSource;
    const harness = component as unknown as ReplaySelectionHarness;
    fixture.detectChanges();
    await fixture.whenStable();

    harness.replayWindowByResponseId.set(501, replaySource);
    harness.handleReplayCodeSelected({
      type: 'replayCodeSelected',
      testPerson: 'person-1@P001@Booklet 1',
      unitId: 'Unit A',
      variableId: 'VAR_1',
      code: '2',
      score: 2,
      responseId: 501
    }, replaySource);

    const item = component.dataSource.data.find(row => row.responseId === 501);
    expect(component.selectionForm.get('item_501')?.value).toBe('replay:501');

    testPersonCodingService.applyDoubleCodedResolutions.mockClear();
    component.applySingleDecision(item!);

    expect(testPersonCodingService.applyDoubleCodedResolutions).toHaveBeenCalledWith(1, {
      decisions: [{ responseId: 501, code: 2, score: 2 }]
    });
  });

  it('stores a replay code selection when the score is explicitly null', async () => {
    const testPersonCodingService = TestBed.inject(TestPersonCodingService) as unknown as {
      applyDoubleCodedResolutions: jest.Mock;
    };
    const replaySource = {} as MessageEventSource;
    const harness = component as unknown as ReplaySelectionHarness;
    fixture.detectChanges();
    await fixture.whenStable();

    harness.replayWindowByResponseId.set(501, replaySource);
    harness.handleReplayCodeSelected({
      type: 'replayCodeSelected',
      testPerson: 'person-1@P001@Booklet 1',
      unitId: 'Unit A',
      variableId: 'VAR_1',
      code: '2',
      score: null,
      responseId: 501
    }, replaySource);

    const item = component.dataSource.data.find(row => row.responseId === 501);
    expect(component.selectionForm.get('item_501')?.value).toBe('replay:501');

    testPersonCodingService.applyDoubleCodedResolutions.mockClear();
    component.applySingleDecision(item!);

    expect(testPersonCodingService.applyDoubleCodedResolutions).toHaveBeenCalledWith(1, {
      decisions: [{ responseId: 501, code: 2, score: null }]
    });
  });

  it('ignores malformed replay code selections without crashing', async () => {
    const snackBar = TestBed.inject(MatSnackBar) as unknown as { open: jest.Mock };
    const replaySource = {} as MessageEventSource;
    const harness = component as unknown as ReplaySelectionHarness;
    fixture.detectChanges();
    await fixture.whenStable();

    snackBar.open.mockClear();
    harness.replayWindowByResponseId.set(501, replaySource);
    expect(() => harness.handleReplayCodeSelected({
      type: 'replayCodeSelected',
      testPerson: 'person-1@P001@Booklet 1',
      unitId: 'Unit A',
      variableId: { invalid: true },
      code: { invalid: true },
      responseId: 501
    }, replaySource)).not.toThrow();

    expect(component.selectionForm.get('item_501')?.value).toBe('1001');
    expect(snackBar.open).toHaveBeenCalledWith(
      'double-coded-review.errors.replay-code-not-in-decisions',
      'close',
      expect.objectContaining({ panelClass: ['error-snackbar'] })
    );
  });

  it('ignores replay code selections with malformed scores', async () => {
    const snackBar = TestBed.inject(MatSnackBar) as unknown as { open: jest.Mock };
    const replaySource = {} as MessageEventSource;
    const harness = component as unknown as ReplaySelectionHarness;
    fixture.detectChanges();
    await fixture.whenStable();

    snackBar.open.mockClear();
    harness.replayWindowByResponseId.set(501, replaySource);
    harness.handleReplayCodeSelected({
      type: 'replayCodeSelected',
      testPerson: 'person-1@P001@Booklet 1',
      unitId: 'Unit A',
      variableId: 'VAR_1',
      code: '2',
      score: { invalid: true },
      responseId: 501
    }, replaySource);

    expect(component.selectionForm.get('item_501')?.value).toBe('1001');
    expect(snackBar.open).toHaveBeenCalledWith(
      'double-coded-review.errors.replay-code-not-in-decisions',
      'close',
      expect.objectContaining({ panelClass: ['error-snackbar'] })
    );
  });

  it('ignores replay code selections from stale replay windows', async () => {
    const snackBar = TestBed.inject(MatSnackBar) as unknown as { open: jest.Mock };
    const expectedReplaySource = {} as MessageEventSource;
    const staleReplaySource = {} as MessageEventSource;
    const harness = component as unknown as ReplaySelectionHarness;
    fixture.detectChanges();
    await fixture.whenStable();

    snackBar.open.mockClear();
    harness.replayWindowByResponseId.set(501, expectedReplaySource);
    harness.handleReplayCodeSelected({
      type: 'replayCodeSelected',
      testPerson: 'person-1@P001@Booklet 1',
      unitId: 'Unit A',
      variableId: 'VAR_1',
      code: '3',
      score: 2,
      responseId: 501
    }, staleReplaySource);

    expect(component.selectionForm.get('item_501')?.value).toBe('1001');
    expect(component.getSelectedDecisionResult(component.dataSource.data[0])?.code).toBe(1);
    expect(snackBar.open).not.toHaveBeenCalled();
  });

  it('ignores replay code selections from another origin', async () => {
    const snackBar = TestBed.inject(MatSnackBar) as unknown as { open: jest.Mock };
    const replaySource = {} as MessageEventSource;
    const harness = component as unknown as ReplaySelectionHarness;
    fixture.detectChanges();
    await fixture.whenStable();

    snackBar.open.mockClear();
    harness.replayWindowByResponseId.set(501, replaySource);
    harness.handleReplayCodeSelected({
      type: 'replayCodeSelected',
      testPerson: 'person-1@P001@Booklet 1',
      unitId: 'Unit A',
      variableId: 'VAR_1',
      code: '3',
      score: 2,
      responseId: 501
    }, replaySource, 'https://example.test');

    expect(component.selectionForm.get('item_501')?.value).toBe('1001');
    expect(component.getSelectedDecisionResult(component.dataSource.data[0])?.code).toBe(1);
    expect(snackBar.open).not.toHaveBeenCalled();
  });

  it('shows multiple results from the same coder in one coder column cell', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const nativeElement = fixture.nativeElement as HTMLElement;
    const rows = Array.from(nativeElement.querySelectorAll('tbody tr')) as HTMLElement[];
    const duplicateCoderRow = rows[2];
    const coderACell = duplicateCoderRow.querySelector('td.mat-column-coder_10') as HTMLElement;
    const coderBCell = duplicateCoderRow.querySelector('td.mat-column-coder_20') as HTMLElement;

    expect(coderACell.querySelectorAll('.coder-column-cell')).toHaveLength(2);
    expect(coderACell.textContent).toContain('Definition 101 / A');
    expect(coderACell.textContent).toContain('#3001');
    expect(coderACell.textContent).toContain('Definition 102 / A');
    expect(coderACell.textContent).toContain('#3002');
    expect(coderBCell.textContent).toContain('-');
  });

  it('shows applied decisions and marks matching original codes for resolved rows', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const nativeElement = fixture.nativeElement as HTMLElement;
    const rows = Array.from(nativeElement.querySelectorAll('tbody tr')) as HTMLElement[];
    const resolvedRow = rows[3];

    expect(resolvedRow.querySelector('.applied-result')?.textContent).toContain('2');
    expect(resolvedRow.querySelector('.applied-result')?.textContent).toContain('Final decision note');
    expect(resolvedRow.querySelector('.decision-status.resolved')?.textContent)
      .toContain('double-coded-review.applied');

    const coderACell = resolvedRow.querySelector('td.mat-column-coder_10') as HTMLElement;
    const coderBCell = resolvedRow.querySelector('td.mat-column-coder_20') as HTMLElement;

    expect(coderACell.querySelector('.applied-code-match')).toBeNull();
    expect(coderBCell.querySelector('.applied-code-match')).toBeTruthy();
    expect(coderBCell.querySelector('.applied-match-icon')).toBeTruthy();
  });

  it('labels duplicate coder decisions with job source and counts progress by unique coders', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const regularItem = component.dataSource.data[0];
    const duplicateCoderItem = component.dataSource.data[2];

    expect(component.getDecisionResultSourceLabel(regularItem, regularItem.coderResults[0]))
      .toBe('Coder A');
    expect(component.getDecisionResultSourceLabel(duplicateCoderItem, duplicateCoderItem.coderResults[0]))
      .toBe('Coder A - Definition 101 / A (#3001)');
    expect(component.getDecisionResultSourceLabel(duplicateCoderItem, duplicateCoderItem.coderResults[1]))
      .toBe('Coder A renamed - Definition 102 / A (#3002)');

    expect(component.getCoderCount(duplicateCoderItem)).toBe(1);
    expect(component.getCodedCount(duplicateCoderItem)).toBe(1);
    expect(component.getCoderCompletionStates(duplicateCoderItem)).toEqual([true]);

    const partiallyPendingDuplicateCoderItem = {
      ...duplicateCoderItem,
      coderResults: [
        duplicateCoderItem.coderResults[0],
        {
          ...duplicateCoderItem.coderResults[1],
          code: null
        }
      ]
    };

    expect(component.getCoderCount(partiallyPendingDuplicateCoderItem)).toBe(1);
    expect(component.getCodedCount(partiallyPendingDuplicateCoderItem)).toBe(0);
    expect(component.getCoderCompletionStates(partiallyPendingDuplicateCoderItem)).toEqual([false]);
  });

  it('keeps same-coder deviations actionable while classifying conflict types', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const interCoderConflictItem = component.dataSource.data[0];
    const matchItem = component.dataSource.data[1];
    const sameCoderConflictItem = component.dataSource.data[2];
    const sameCoderMatchItem = {
      ...sameCoderConflictItem,
      coderResults: [
        sameCoderConflictItem.coderResults[0],
        {
          ...sameCoderConflictItem.coderResults[1],
          code: sameCoderConflictItem.coderResults[0].code,
          score: sameCoderConflictItem.coderResults[0].score
        }
      ]
    };
    const mixedConflictItem = {
      ...sameCoderConflictItem,
      coderResults: [
        ...sameCoderConflictItem.coderResults,
        {
          ...interCoderConflictItem.coderResults[1],
          jobId: 3003,
          jobName: 'Definition 103 / B',
          code: 3,
          score: 2
        }
      ]
    };

    expect(component.getConflictType(matchItem)).toBe('none');
    expect(component.getConflictType(sameCoderMatchItem)).toBe('none');
    expect(component.getConflictType(sameCoderConflictItem)).toBe('same-coder');
    expect(component.getConflictType(interCoderConflictItem)).toBe('inter-coder');
    expect(component.getConflictType(mixedConflictItem)).toBe('mixed');
    expect(component.hasConflict(sameCoderMatchItem)).toBe(false);
    expect(component.hasConflict(sameCoderConflictItem)).toBe(true);

    expect(component.getDecisionStatusLabel(sameCoderConflictItem))
      .toBe('double-coded-review.decision.status-same-coder-conflict');
    expect(component.getDecisionStatusLabel(interCoderConflictItem))
      .toBe('double-coded-review.decision.status-inter-coder-conflict');
    expect(component.getDecisionStatusLabel(mixedConflictItem))
      .toBe('double-coded-review.decision.status-mixed-conflict');
  });
});
