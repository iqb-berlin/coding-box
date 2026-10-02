import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialog } from '@angular/material/dialog';
import { MatPaginator } from '@angular/material/paginator';
import { MatSnackBar } from '@angular/material/snack-bar';
import { OverlayContainer } from '@angular/cdk/overlay';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { By } from '@angular/platform-browser';
import { TranslateModule } from '@ngx-translate/core';
import { Observable, of, Subject } from 'rxjs';
import { AppService } from '../../../core/services/app.service';
import { WorkspaceBackendService } from '../../../workspace/services/workspace-backend.service';
import { CodingFacadeService } from '../../../services/facades/coding-facade.service';
import { TestPersonCodingService } from '../../services/test-person-coding.service';
import { DoubleCodedReviewApiService } from '../../services/double-coded-review-api.service';
import { CodingStatisticsService } from '../../services/coding-statistics.service';
import { DoubleCodedReviewComponent } from './double-coded-review.component';
import { DoubleCodedDecisionCellComponent } from './double-coded-decision-cell.component';
import { DoubleCodedReviewFacade } from './double-coded-review.facade';
import { SessionRecoveryService } from '../../../core/services/session-recovery.service';

describe('DoubleCodedReviewComponent', () => {
  let component: DoubleCodedReviewComponent;
  let fixture: ComponentFixture<DoubleCodedReviewComponent>;
  let overlayContainer: OverlayContainer;
  let reviewFacade: DoubleCodedReviewFacade;

  const getDecisionCell = (
    responseId: number
  ): DoubleCodedDecisionCellComponent => {
    const cell = fixture.debugElement
      .queryAll(By.directive(DoubleCodedDecisionCellComponent))
      .map(debugElement => debugElement.componentInstance as DoubleCodedDecisionCellComponent)
      .find(candidate => candidate.item().responseId === responseId);
    if (!cell) throw new Error(`Decision cell for response ${responseId} not found`);
    return cell;
  };

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
      imports: [DoubleCodedReviewComponent, TranslateModule.forRoot()],
      providers: [
        provideNoopAnimations(),
        {
          provide: AppService,
          useValue: {
            selectedWorkspaceId: 1,
            userId: 99,
            authData: { userName: 'Reviewer', isAdmin: false },
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
            })
            )
          }
        },
        {
          provide: CodingFacadeService,
          useValue: {
            getJobDefinitions: jest.fn(() => of([{ id: 99, status: 'approved', createdJobsCount: 2 }])
            ),
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
                  sourceUnitId: 1501,
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
                  sourceUnitId: 1502,
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
                  managerDrafts: [
                    {
                      id: 41,
                      responseId: 502,
                      managerUserId: 88,
                      managerKey: '88',
                      managerName: 'Manager B',
                      state: 'draft',
                      effectiveCode: 1,
                      selectedCode: 1,
                      score: 0,
                      comment: 'Second opinion',
                      createdAt: '2026-05-20T10:15:00.000Z',
                      updatedAt: '2026-05-20T10:20:00.000Z',
                      finalizedAt: null,
                      legacy: false
                    }
                  ],
                  managerHistory: [],
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
                  sourceUnitId: 1503,
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
                  sourceUnitId: 1504,
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
            })
            ),
            applyDoubleCodedResolutions: jest.fn(() => of({
              success: true,
              appliedCount: 1,
              failedCount: 0,
              skippedCount: 0,
              message: 'ok',
              results: []
            })
            ),
            saveDoubleCodedReviewDraft: jest.fn(
              (_workspaceId, responseId, draft) => of({
                id: 1,
                responseId,
                managerUserId: 99,
                managerKey: '99',
                managerName: 'Reviewer',
                state: 'draft',
                effectiveCode: draft.code,
                selectedCode: draft.code,
                score: draft.score ?? null,
                comment: draft.comment ?? null,
                createdAt: '2026-05-20T12:00:00.000Z',
                updatedAt: '2026-05-20T12:00:00.000Z',
                finalizedAt: null,
                legacy: false
              })
            ),
            deleteDoubleCodedReviewDraft: jest.fn(() => of({ success: true })),
            notifyTestResultsChanged: jest.fn()
          }
        },
        {
          provide: DoubleCodedReviewApiService,
          useExisting: TestPersonCodingService
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
        },
        {
          provide: MAT_DIALOG_DATA,
          useValue: { canApplyResults: true }
        }
      ]
    }).compileComponents();

    overlayContainer = TestBed.inject(OverlayContainer);
    fixture = TestBed.createComponent(DoubleCodedReviewComponent);
    component = fixture.componentInstance;
    reviewFacade = fixture.debugElement.injector.get(DoubleCodedReviewFacade);
  });

  afterEach(() => {
    overlayContainer.ngOnDestroy();
    sessionStorage.clear();
  });

  it('allows applying decisions only with study-manager permission', () => {
    component.dialogData = { canApplyResults: false };
    expect(component.canApplyReviewResults).toBe(false);

    component.dialogData = { canApplyResults: true };
    expect(component.canApplyReviewResults).toBe(true);
  });

  it('requests server-side person sorting and resets pagination', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    const api = TestBed.inject(DoubleCodedReviewApiService) as unknown as {
      getDoubleCodedVariablesForReview: jest.Mock;
    };
    api.getDoubleCodedVariablesForReview.mockClear();
    component.currentPage = 3;

    component.onSortChange({ active: 'personInfo', direction: 'desc' });

    expect(component.currentPage).toBe(1);
    expect(component.sortBy).toBe('personInfo');
    expect(component.sortDirection).toBe('desc');
    expect(api.getDoubleCodedVariablesForReview).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        page: 1,
        sortBy: 'personInfo',
        sortDirection: 'desc'
      })
    );
  });

  it('restores the current page when the paginator is recreated', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    component.totalItems = 200;
    component.currentPage = 3;

    const expectRestoredPage = (): void => {
      component.isLoading = true;
      fixture.detectChanges();
      expect(fixture.debugElement.query(By.directive(MatPaginator))).toBeNull();

      component.isLoading = false;
      fixture.detectChanges();
      const paginator = fixture.debugElement.query(By.directive(MatPaginator))
        .componentInstance as MatPaginator;
      expect(paginator.pageIndex).toBe(2);
    };

    expectRestoredPage();

    component.dialogRef = {
      close: jest.fn()
    } as unknown as typeof component.dialogRef;
    expectRestoredPage();
  });

  it('renders the reusable decision cell and updates its selection through Material select', async () => {
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.99);
    fixture.detectChanges();
    await fixture.whenStable();
    randomSpy.mockRestore();
    fixture.detectChanges();

    const nativeElement = fixture.nativeElement as HTMLElement;
    const selectionCell = nativeElement.querySelector(
      'td.mat-column-selection .selection-cell'
    ) as HTMLElement;

    expect(selectionCell).toBeTruthy();
    expect(
      selectionCell.querySelector('.decision-status.conflict')?.textContent
    ).toContain('double-coded-review.decision.status-inter-coder-conflict');
    expect(
      selectionCell.querySelector('.decision-code-value')?.textContent?.trim()
    ).toBe('2');
    expect(selectionCell.querySelector('.comment-field')).toBeTruthy();

    const selectTrigger = selectionCell.querySelector(
      '.mat-mdc-select-trigger'
    ) as HTMLElement;
    selectTrigger.click();
    fixture.detectChanges();
    await fixture.whenStable();

    const options = (
      Array.from(
        overlayContainer.getContainerElement().querySelectorAll('mat-option')
      ) as HTMLElement[]
    ).filter(option => option.style.display !== 'none');

    expect(options).toHaveLength(3);

    options[0].click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const reviewItem = component.dataSource.data[0];
    expect(
      component.selectionForm.get(component.getItemControlName(reviewItem))
        ?.value
    ).toBe('code:2');
    expect(
      selectionCell.querySelector('.decision-code-value')?.textContent?.trim()
    ).toBe('2');
    expect(
      selectionCell.querySelector('.decision-source')?.textContent
    ).toContain('2');
    expect(
      nativeElement.querySelector('.coder-column-cell.selected-code-match')
    ).toBeTruthy();
  });

  it('creates one dynamic column per coder and exposes alternate coder names in the tooltip', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.dynamicCoderColumns).toEqual(['coder_10', 'coder_20']);

    const nativeElement = fixture.nativeElement as HTMLElement;
    const coderHeaders = Array.from(
      nativeElement.querySelectorAll(
        'th.mat-column-coder_10, th.mat-column-coder_20'
      )
    ) as HTMLElement[];

    expect(coderHeaders).toHaveLength(2);
    expect(coderHeaders.map(header => header.textContent?.trim())).toEqual([
      'Coder A',
      'Coder B'
    ]);
    expect(component.coderColumnMeta.coder_10.coderNames).toEqual([
      'Coder A',
      'Coder A renamed'
    ]);
    expect(component.getCoderColumnTooltip('coder_10')).toContain(
      'Weitere Namen: Coder A renamed'
    );
  });

  it('highlights coder results matching the current unresolved selection', async () => {
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    randomSpy.mockRestore();

    const reviewItem = component.dataSource.data.find(
      item => item.responseId === 501
    )!;
    expect(reviewItem.currentSelectionCode).toBe(-3);
    component.getItemControl(reviewItem).setValue('code:2');
    component.onSelectionChange(reviewItem, 'code:2');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(
      component.isCurrentCodeMatch(reviewItem, reviewItem.coderResults[0])
    ).toBe(false);
    expect(
      component.isCurrentCodeMatch(reviewItem, reviewItem.coderResults[1])
    ).toBe(true);
    const firstRow = (fixture.nativeElement as HTMLElement).querySelector(
      'tbody tr.mat-mdc-row'
    );
    const firstRowCoderCells = Array.from(
      firstRow?.querySelectorAll('.coder-column-cell') || []
    );
    expect(
      firstRowCoderCells[0]?.classList.contains('selected-code-match')
    ).toBe(false);
    expect(
      firstRowCoderCells[1]?.classList.contains('selected-code-match')
    ).toBe(true);
  });

  it('randomly preselects one modal candidate on ties without persisting an implicit draft', async () => {
    const codingService = TestBed.inject(
      TestPersonCodingService
    ) as unknown as {
      saveDoubleCodedReviewDraft: jest.Mock;
    };
    codingService.saveDoubleCodedReviewDraft.mockClear();
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.99);

    fixture.detectChanges();
    await fixture.whenStable();
    randomSpy.mockRestore();

    const tieItem = component.dataSource.data.find(
      item => item.responseId === 501
    )!;
    const modeItem = component.dataSource.data.find(
      item => item.responseId === 502
    )!;
    expect(component.getItemControl(tieItem).value).toBe('code:2');
    expect(component.getItemControl(modeItem).value).toBe('code:1');
    expect(codingService.saveDoubleCodedReviewDraft).not.toHaveBeenCalled();
  });

  it('serializes draft writes for the same response in user-action order', async () => {
    const codingService = TestBed.inject(
      TestPersonCodingService
    ) as unknown as {
      saveDoubleCodedReviewDraft: jest.Mock;
    };
    const firstSave = new Subject<never>();
    const secondSave = new Subject<never>();

    fixture.detectChanges();
    await fixture.whenStable();
    codingService.saveDoubleCodedReviewDraft
      .mockReset()
      .mockReturnValueOnce(firstSave)
      .mockReturnValueOnce(secondSave);

    const reviewItem = component.dataSource.data.find(
      item => item.responseId === 501
    )!;
    component.getItemControl(reviewItem).setValue('code:2');
    component.onSelectionChange(reviewItem, 'code:2');
    component.getItemControl(reviewItem).setValue('code:-3');
    component.onSelectionChange(reviewItem, 'code:-3');

    expect(codingService.saveDoubleCodedReviewDraft).toHaveBeenCalledTimes(1);
    firstSave.complete();
    expect(codingService.saveDoubleCodedReviewDraft).toHaveBeenCalledTimes(2);
    expect(
      codingService.saveDoubleCodedReviewDraft.mock.calls[1][2]
    ).toMatchObject({ code: -3 });
  });

  it('finishes active and queued draft writes after the dialog is destroyed', async () => {
    const codingService = TestBed.inject(
      TestPersonCodingService
    ) as unknown as {
      saveDoubleCodedReviewDraft: jest.Mock;
    };
    let completeFirstSave = (): void => undefined;
    let firstSaveUnsubscribed = false;
    const firstSave = new Observable(subscriber => {
      completeFirstSave = () => subscriber.complete();
      return () => {
        firstSaveUnsubscribed = true;
      };
    });

    fixture.detectChanges();
    await fixture.whenStable();
    codingService.saveDoubleCodedReviewDraft
      .mockReset()
      .mockReturnValueOnce(firstSave)
      .mockReturnValueOnce(
        of({
          id: 2,
          responseId: 501,
          managerUserId: 99,
          managerKey: '99',
          managerName: 'Reviewer',
          state: 'draft',
          effectiveCode: -3,
          selectedCode: -3,
          score: 0,
          comment: null,
          createdAt: '2026-05-20T12:00:00.000Z',
          updatedAt: '2026-05-20T12:00:01.000Z',
          finalizedAt: null,
          legacy: false
        })
      );

    const reviewItem = component.dataSource.data.find(
      item => item.responseId === 501
    )!;
    component.getItemControl(reviewItem).setValue('code:2');
    component.onSelectionChange(reviewItem, 'code:2');
    component.getItemControl(reviewItem).setValue('code:-3');
    component.onSelectionChange(reviewItem, 'code:-3');

    component.ngOnDestroy();

    expect(firstSaveUnsubscribed).toBe(false);
    expect(codingService.saveDoubleCodedReviewDraft).toHaveBeenCalledTimes(1);

    completeFirstSave();

    expect(firstSaveUnsubscribed).toBe(true);
    expect(codingService.saveDoubleCodedReviewDraft).toHaveBeenCalledTimes(2);
    expect(
      codingService.saveDoubleCodedReviewDraft.mock.calls[1][2]
    ).toMatchObject({ code: -3 });
  });

  it('flushes a pending debounced comment before the dialog is destroyed', async () => {
    const codingService = TestBed.inject(
      TestPersonCodingService
    ) as unknown as {
      saveDoubleCodedReviewDraft: jest.Mock;
    };
    fixture.detectChanges();
    await fixture.whenStable();
    codingService.saveDoubleCodedReviewDraft.mockClear();

    const reviewItem = component.dataSource.data.find(
      item => item.responseId === 502
    )!;
    component.selectionForm
      .get(component.getCommentControlName(reviewItem))
      ?.setValue('Last comment');

    component.ngOnDestroy();

    expect(codingService.saveDoubleCodedReviewDraft).toHaveBeenCalledWith(
      1,
      502,
      expect.objectContaining({
        sourceUnitId: 1502,
        code: 1,
        comment: 'Last comment'
      })
    );
  });

  it('shows other managers in separate columns with their latest state', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    const reviewItem = component.dataSource.data.find(
      item => item.responseId === 502
    )!;
    expect(component.dynamicManagerColumns).toEqual(['manager_88']);
    expect(component.getManagerColumnHeader('manager_88')).toBe('Manager B');
    expect(
      component.getManagerDecisionForColumn(reviewItem, 'manager_88')
    ).toMatchObject({
      state: 'draft',
      effectiveCode: 1,
      comment: 'Second opinion'
    });
  });

  it('shows the current manager after applying a decision', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    const reviewItem = component.dataSource.data.find(
      item => item.responseId === 504
    )!;
    reviewItem.managerHistory = [{
      id: 42,
      responseId: 504,
      managerUserId: 99,
      managerKey: '99',
      managerName: 'Reviewer',
      state: 'applied',
      effectiveCode: 2,
      selectedCode: 2,
      score: 1,
      comment: 'Final decision note',
      createdAt: '2026-05-20T12:00:00.000Z',
      updatedAt: '2026-05-20T12:00:00.000Z',
      finalizedAt: '2026-05-20T12:00:00.000Z',
      legacy: false
    }];
    const harness = component as unknown as {
      updateDisplayedColumns: (items: typeof component.dataSource.data) => void;
    };

    harness.updateDisplayedColumns(component.dataSource.data);

    expect(component.dynamicManagerColumns).toContain('manager_99');
    expect(component.getManagerDecisionForColumn(
      reviewItem,
      'manager_99'
    )).toMatchObject({
      state: 'applied',
      effectiveCode: 2,
      comment: 'Final decision note'
    });
    expect(component.getSelectionColumnHeader()).toBe(
      'double-coded-review.columns.final-decision'
    );
  });

  it('shows the original general manager selection after profile resolution', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    const reviewItem = component.dataSource.data.find(
      item => item.responseId === 502
    )!;
    const decision = reviewItem.managerDrafts[0];
    decision.selectedCode = -3;
    decision.effectiveCode = -98;

    expect(component.getManagerDecisionDisplayCode(decision)).toBe(
      'code-selector.coding-issue-options.invalid-joke-answer'
    );
  });

  it('keeps decisions from different deleted managers in separate columns', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    const firstItem = component.dataSource.data.find(
      item => item.responseId === 501
    )!;
    const secondItem = component.dataSource.data.find(
      item => item.responseId === 502
    )!;
    firstItem.managerHistory = [
      {
        id: 61,
        responseId: 501,
        managerUserId: null,
        managerKey: '42',
        managerName: 'Ehemalige Managerin A',
        state: 'applied',
        effectiveCode: 1,
        selectedCode: 1,
        score: 0,
        comment: null,
        createdAt: '2026-05-20T10:00:00.000Z',
        updatedAt: '2026-05-20T10:00:00.000Z',
        finalizedAt: '2026-05-20T10:00:00.000Z',
        legacy: false
      }
    ];
    secondItem.managerHistory = [
      {
        id: 62,
        responseId: 502,
        managerUserId: null,
        managerKey: '43',
        managerName: 'Ehemaliger Manager B',
        state: 'superseded',
        effectiveCode: 2,
        selectedCode: 2,
        score: 1,
        comment: null,
        createdAt: '2026-05-20T10:05:00.000Z',
        updatedAt: '2026-05-20T10:05:00.000Z',
        finalizedAt: '2026-05-20T10:05:00.000Z',
        legacy: false
      }
    ];

    const harness = component as unknown as {
      updateDisplayedColumns: (items: typeof component.dataSource.data) => void;
    };
    harness.updateDisplayedColumns(component.dataSource.data);

    expect(component.dynamicManagerColumns).toEqual(
      expect.arrayContaining(['manager_42', 'manager_43'])
    );
    expect(
      component.getManagerDecisionForColumn(firstItem, 'manager_42')
        ?.managerName
    ).toBe('Ehemalige Managerin A');
    expect(
      component.getManagerDecisionForColumn(secondItem, 'manager_43')
        ?.managerName
    ).toBe('Ehemaliger Manager B');
  });

  it('opens replay in coding decision mode for double-coded review decisions', async () => {
    const codingStatisticsService = TestBed.inject(
      CodingStatisticsService
    ) as unknown as {
      getReplayUrl: jest.Mock;
    };
    const openSpy = jest.spyOn(window, 'open').mockImplementation(() => null);
    codingStatisticsService.getReplayUrl.mockReturnValue(
      of({
        replayUrl:
          'http://localhost:3333/#/replay/person/unit/0/VAR_1?workspaceId=1'
      })
    );

    fixture.detectChanges();
    await fixture.whenStable();
    component.openReplay(501);

    expect(codingStatisticsService.getReplayUrl).toHaveBeenCalledWith(1, 501);
    const openedUrl = openSpy.mock.calls[0][0] as string;
    expect(openedUrl).toContain(
      `${window.location.origin}/#/replay/person/unit/0/VAR_1?workspaceId=1&mode=coding-decision&originResponseId=501`
    );
    const reviewCodeSelections = new URLSearchParams(
      openedUrl.split('?')[1]
    ).get('reviewCodeSelections');
    expect(JSON.parse(reviewCodeSelections || '[]')).toEqual([
      { code: -3, coderNames: ['Coder A'] },
      { code: 2, coderNames: ['Coder B'] }
    ]);
    expect(openSpy).toHaveBeenCalledWith(openedUrl, '_blank');
  });

  it('opens resolved review cases in read-only replay mode', async () => {
    const codingStatisticsService = TestBed.inject(
      CodingStatisticsService
    ) as unknown as {
      getReplayUrl: jest.Mock;
    };
    const openSpy = jest.spyOn(window, 'open').mockImplementation(() => null);
    codingStatisticsService.getReplayUrl.mockReturnValue(
      of({
        replayUrl:
          'http://localhost:3333/#/replay/person/unit/0/VAR_4?workspaceId=1'
      })
    );

    fixture.detectChanges();
    await fixture.whenStable();
    component.openReplay(504);

    const openedUrl = openSpy.mock.calls[
      openSpy.mock.calls.length - 1
    ][0] as string;
    expect(
      new URLSearchParams(openedUrl.split('?')[1]).get('decisionReadOnly')
    ).toBe('true');
  });

  it('captures changed review selections as a recovery draft', async () => {
    const sessionRecoveryService = TestBed.inject(SessionRecoveryService);
    fixture.detectChanges();
    await fixture.whenStable();

    const reviewItem = component.dataSource.data[0];
    component.selectionForm
      .get(component.getItemControlName(reviewItem))
      ?.setValue('1002');
    component.getCommentControl(reviewItem).setValue('Recovered comment');

    sessionRecoveryService.captureRegisteredDrafts();

    expect(
      sessionRecoveryService.peekDraft('double-coded-review-active-state')
    ).toEqual({
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
    expect(
      component.selectionForm.get(component.getItemControlName(reviewItem))
        ?.value
    ).toBe('1002');
    expect(
      component.selectionForm.get(component.getCommentControlName(reviewItem))
        ?.value
    ).toBe('Recovered comment');
  });

  it('selects an available coder result from a replay code selection', async () => {
    const testPersonCodingService = TestBed.inject(
      TestPersonCodingService
    ) as unknown as {
      applyDoubleCodedResolutions: jest.Mock;
    };
    const snackBar = TestBed.inject(MatSnackBar) as unknown as {
      open: jest.Mock;
    };
    const replaySource = {} as MessageEventSource;
    const harness = component as unknown as ReplaySelectionHarness;
    fixture.detectChanges();
    await fixture.whenStable();

    snackBar.open.mockClear();
    harness.replayWindowByResponseId.set(501, replaySource);
    harness.handleReplayCodeSelected(
      {
        type: 'replayCodeSelected',
        testPerson: 'person-1@P001@Booklet 1',
        unitId: 'Unit A',
        variableId: 'VAR_1',
        code: '2',
        score: 1,
        notes: 'Replay note',
        responseId: 501
      },
      replaySource
    );

    const item = component.dataSource.data.find(
      row => row.responseId === 501
    );
    expect(component.selectionForm.get('item_501')?.value).toBe('1002');
    expect(component.selectionForm.get('comment_501')?.value).toBe(
      'Replay note'
    );
    expect(item?.selectedCoderResult?.jobId).toBe(1002);
    testPersonCodingService.applyDoubleCodedResolutions.mockClear();
    component.applySingleDecision(item!);
    expect(
      testPersonCodingService.applyDoubleCodedResolutions
    ).toHaveBeenCalledWith(1, {
      decisions: [{
        responseId: 501,
        sourceUnitId: 1501,
        selectedJobId: 1002,
        resolutionComment: 'Replay note'
      }]
    });
    expect(snackBar.open).toHaveBeenCalledWith(
      'double-coded-review.success.replay-code-selected',
      'close',
      expect.objectContaining({ panelClass: ['success-snackbar'] })
    );
  });

  it('shows a replay-only decision immediately in the open review dialog', async () => {
    const replaySource = {} as MessageEventSource;
    const harness = component as unknown as ReplaySelectionHarness;
    fixture.detectChanges();
    await fixture.whenStable();

    harness.replayWindowByResponseId.set(501, replaySource);
    harness.handleReplayCodeSelected(
      {
        type: 'replayCodeSelected',
        testPerson: 'person-1@P001@Booklet 1',
        unitId: 'Unit A',
        variableId: 'VAR_1',
        code: '3',
        score: 2,
        responseId: 501
      },
      replaySource
    );

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(getDecisionCell(501).replayDecision).toMatchObject({
      code: 3,
      score: 2
    });
    const replayTrigger = fixture.debugElement
      .queryAll(By.css('.decision-trigger'))
      .find(debugElement => debugElement.nativeElement.textContent.includes(
        'double-coded-review.decision.replay-source'
      ));
    expect(replayTrigger?.nativeElement.textContent).toContain('3');
    expect(replayTrigger?.nativeElement.textContent).toContain('(2)');
  });

  it('clears a transferred replay note when the replay sends empty notes', async () => {
    const replaySource = {} as MessageEventSource;
    const harness = component as unknown as ReplaySelectionHarness;
    fixture.detectChanges();
    await fixture.whenStable();

    harness.replayWindowByResponseId.set(501, replaySource);
    harness.handleReplayCodeSelected(
      {
        type: 'replayCodeSelected',
        testPerson: 'person-1@P001@Booklet 1',
        unitId: 'Unit A',
        variableId: 'VAR_1',
        code: '2',
        score: 1,
        notes: 'Replay note',
        responseId: 501
      },
      replaySource
    );

    expect(component.selectionForm.get('comment_501')?.value).toBe(
      'Replay note'
    );

    harness.handleReplayCodeSelected(
      {
        type: 'replayCodeSelected',
        testPerson: 'person-1@P001@Booklet 1',
        unitId: 'Unit A',
        variableId: 'VAR_1',
        code: '2',
        score: 1,
        notes: '   ',
        responseId: 501
      },
      replaySource
    );

    expect(component.selectionForm.get('comment_501')?.value).toBe('');
  });

  it('keeps existing comments when replay selections do not include notes', async () => {
    const replaySource = {} as MessageEventSource;
    const harness = component as unknown as ReplaySelectionHarness;
    fixture.detectChanges();
    await fixture.whenStable();

    const item = component.dataSource.data.find(
      row => row.responseId === 501
    )!;
    component.getCommentControl(item).setValue('Manual review comment');
    harness.replayWindowByResponseId.set(501, replaySource);

    harness.handleReplayCodeSelected(
      {
        type: 'replayCodeSelected',
        testPerson: 'person-1@P001@Booklet 1',
        unitId: 'Unit A',
        variableId: 'VAR_1',
        code: '2',
        score: 1,
        responseId: 501
      },
      replaySource
    );

    expect(component.selectionForm.get('comment_501')?.value).toBe(
      'Manual review comment'
    );
  });

  it('stores and applies a replay code selection that has no coder result', async () => {
    const testPersonCodingService = TestBed.inject(
      TestPersonCodingService
    ) as unknown as {
      applyDoubleCodedResolutions: jest.Mock;
      notifyTestResultsChanged: jest.Mock;
    };
    const replaySource = {} as MessageEventSource;
    const harness = component as unknown as ReplaySelectionHarness;
    fixture.detectChanges();
    await fixture.whenStable();

    harness.replayWindowByResponseId.set(501, replaySource);
    harness.handleReplayCodeSelected(
      {
        type: 'replayCodeSelected',
        testPerson: 'person-1@P001@Booklet 1',
        unitId: 'Unit A',
        variableId: 'VAR_1',
        code: '3',
        score: 2,
        notes: 'Replay note',
        responseId: 501
      },
      replaySource
    );

    const item = component.dataSource.data.find(
      row => row.responseId === 501
    );
    expect(item).toBeDefined();
    expect(component.selectionForm.get('item_501')?.value).toBe('replay:501');
    const selectedDecision = reviewFacade.getSelectedDecisionResult(item!);
    expect(selectedDecision?.code).toBe(3);
    expect(selectedDecision?.score).toBe(2);
    fixture.detectChanges();
    expect(
      getDecisionCell(501).getDecisionSourceLabel(selectedDecision!)
    ).toBe('double-coded-review.decision.replay-source');

    testPersonCodingService.applyDoubleCodedResolutions.mockClear();
    component.applySingleDecision(item!);

    expect(
      testPersonCodingService.applyDoubleCodedResolutions
    ).toHaveBeenCalledWith(1, {
      decisions: [
        {
          responseId: 501,
          sourceUnitId: 1501,
          code: 3,
          score: 2,
          resolutionComment: 'Replay note'
        }
      ]
    });
    expect(
      testPersonCodingService.notifyTestResultsChanged
    ).toHaveBeenCalledWith({
      workspaceId: 1,
      statisticsVersion: 'v2'
    });
  });

  it('stores a replay code selection when only the score differs from coder results', async () => {
    const testPersonCodingService = TestBed.inject(
      TestPersonCodingService
    ) as unknown as {
      applyDoubleCodedResolutions: jest.Mock;
    };
    const replaySource = {} as MessageEventSource;
    const harness = component as unknown as ReplaySelectionHarness;
    fixture.detectChanges();
    await fixture.whenStable();

    harness.replayWindowByResponseId.set(501, replaySource);
    harness.handleReplayCodeSelected(
      {
        type: 'replayCodeSelected',
        testPerson: 'person-1@P001@Booklet 1',
        unitId: 'Unit A',
        variableId: 'VAR_1',
        code: '2',
        score: 2,
        responseId: 501
      },
      replaySource
    );

    const item = component.dataSource.data.find(
      row => row.responseId === 501
    );
    expect(component.selectionForm.get('item_501')?.value).toBe('replay:501');

    testPersonCodingService.applyDoubleCodedResolutions.mockClear();
    component.applySingleDecision(item!);

    expect(
      testPersonCodingService.applyDoubleCodedResolutions
    ).toHaveBeenCalledWith(1, {
      decisions: [{
        responseId: 501, sourceUnitId: 1501, code: 2, score: 2
      }]
    });
  });

  it('stores a replay code selection when the score is explicitly null', async () => {
    const testPersonCodingService = TestBed.inject(
      TestPersonCodingService
    ) as unknown as {
      applyDoubleCodedResolutions: jest.Mock;
    };
    const replaySource = {} as MessageEventSource;
    const harness = component as unknown as ReplaySelectionHarness;
    fixture.detectChanges();
    await fixture.whenStable();

    harness.replayWindowByResponseId.set(501, replaySource);
    harness.handleReplayCodeSelected(
      {
        type: 'replayCodeSelected',
        testPerson: 'person-1@P001@Booklet 1',
        unitId: 'Unit A',
        variableId: 'VAR_1',
        code: '2',
        score: null,
        responseId: 501
      },
      replaySource
    );

    const item = component.dataSource.data.find(
      row => row.responseId === 501
    );
    expect(component.selectionForm.get('item_501')?.value).toBe('replay:501');

    testPersonCodingService.applyDoubleCodedResolutions.mockClear();
    component.applySingleDecision(item!);

    expect(
      testPersonCodingService.applyDoubleCodedResolutions
    ).toHaveBeenCalledWith(1, {
      decisions: [{
        responseId: 501, sourceUnitId: 1501, code: 2, score: null
      }]
    });
  });

  it('reports skipped or failed resolution results instead of showing success', async () => {
    const testPersonCodingService = TestBed.inject(
      TestPersonCodingService
    ) as unknown as {
      applyDoubleCodedResolutions: jest.Mock;
      notifyTestResultsChanged: jest.Mock;
    };
    const snackBar = TestBed.inject(MatSnackBar) as unknown as {
      open: jest.Mock;
    };
    fixture.detectChanges();
    await fixture.whenStable();

    const item = component.dataSource.data.find(
      row => row.responseId === 501
    )!;
    component.getItemControl(item).setValue('code:2');
    testPersonCodingService.applyDoubleCodedResolutions.mockReturnValueOnce(
      of({
        success: false,
        appliedCount: 0,
        failedCount: 1,
        skippedCount: 1,
        message: 'not applied',
        results: [{ responseId: 501, status: 'failed', message: 'conflict' }]
      })
    );
    testPersonCodingService.notifyTestResultsChanged.mockClear();
    snackBar.open.mockClear();

    component.applySingleDecision(item);

    expect(snackBar.open).toHaveBeenCalledWith(
      'double-coded-review.errors.resolutions-partially-applied',
      'close',
      expect.objectContaining({ panelClass: ['error-snackbar'] })
    );
    expect(
      testPersonCodingService.notifyTestResultsChanged
    ).not.toHaveBeenCalled();
  });

  it('ignores malformed replay code selections without crashing', async () => {
    const snackBar = TestBed.inject(MatSnackBar) as unknown as {
      open: jest.Mock;
    };
    const replaySource = {} as MessageEventSource;
    const harness = component as unknown as ReplaySelectionHarness;
    fixture.detectChanges();
    await fixture.whenStable();
    const initialValue = component.selectionForm.get('item_501')?.value;

    snackBar.open.mockClear();
    harness.replayWindowByResponseId.set(501, replaySource);
    expect(() => harness.handleReplayCodeSelected(
      {
        type: 'replayCodeSelected',
        testPerson: 'person-1@P001@Booklet 1',
        unitId: 'Unit A',
        variableId: { invalid: true },
        code: { invalid: true },
        responseId: 501
      },
      replaySource
    )
    ).not.toThrow();

    expect(component.selectionForm.get('item_501')?.value).toBe(initialValue);
    expect(snackBar.open).toHaveBeenCalledWith(
      'double-coded-review.errors.replay-code-not-in-decisions',
      'close',
      expect.objectContaining({ panelClass: ['error-snackbar'] })
    );
  });

  it('ignores replay code selections with malformed scores', async () => {
    const snackBar = TestBed.inject(MatSnackBar) as unknown as {
      open: jest.Mock;
    };
    const replaySource = {} as MessageEventSource;
    const harness = component as unknown as ReplaySelectionHarness;
    fixture.detectChanges();
    await fixture.whenStable();
    const initialValue = component.selectionForm.get('item_501')?.value;

    snackBar.open.mockClear();
    harness.replayWindowByResponseId.set(501, replaySource);
    harness.handleReplayCodeSelected(
      {
        type: 'replayCodeSelected',
        testPerson: 'person-1@P001@Booklet 1',
        unitId: 'Unit A',
        variableId: 'VAR_1',
        code: '2',
        score: { invalid: true },
        responseId: 501
      },
      replaySource
    );

    expect(component.selectionForm.get('item_501')?.value).toBe(initialValue);
    expect(snackBar.open).toHaveBeenCalledWith(
      'double-coded-review.errors.replay-code-not-in-decisions',
      'close',
      expect.objectContaining({ panelClass: ['error-snackbar'] })
    );
  });

  it('ignores replay code selections from stale replay windows', async () => {
    const snackBar = TestBed.inject(MatSnackBar) as unknown as {
      open: jest.Mock;
    };
    const expectedReplaySource = {} as MessageEventSource;
    const staleReplaySource = {} as MessageEventSource;
    const harness = component as unknown as ReplaySelectionHarness;
    fixture.detectChanges();
    await fixture.whenStable();
    const initialValue = component.selectionForm.get('item_501')?.value;
    const initialDecision = reviewFacade.getSelectedDecisionResult(
      component.dataSource.data[0]
    );

    snackBar.open.mockClear();
    harness.replayWindowByResponseId.set(501, expectedReplaySource);
    harness.handleReplayCodeSelected(
      {
        type: 'replayCodeSelected',
        testPerson: 'person-1@P001@Booklet 1',
        unitId: 'Unit A',
        variableId: 'VAR_1',
        code: '3',
        score: 2,
        responseId: 501
      },
      staleReplaySource
    );

    expect(component.selectionForm.get('item_501')?.value).toBe(initialValue);
    expect(
      reviewFacade.getSelectedDecisionResult(component.dataSource.data[0])
    ).toEqual(initialDecision);
    expect(snackBar.open).not.toHaveBeenCalled();
  });

  it('ignores replay code selections from another origin', async () => {
    const snackBar = TestBed.inject(MatSnackBar) as unknown as {
      open: jest.Mock;
    };
    const replaySource = {} as MessageEventSource;
    const harness = component as unknown as ReplaySelectionHarness;
    fixture.detectChanges();
    await fixture.whenStable();
    const initialValue = component.selectionForm.get('item_501')?.value;
    const initialDecision = reviewFacade.getSelectedDecisionResult(
      component.dataSource.data[0]
    );

    snackBar.open.mockClear();
    harness.replayWindowByResponseId.set(501, replaySource);
    harness.handleReplayCodeSelected(
      {
        type: 'replayCodeSelected',
        testPerson: 'person-1@P001@Booklet 1',
        unitId: 'Unit A',
        variableId: 'VAR_1',
        code: '3',
        score: 2,
        responseId: 501
      },
      replaySource,
      'https://example.test'
    );

    expect(component.selectionForm.get('item_501')?.value).toBe(initialValue);
    expect(
      reviewFacade.getSelectedDecisionResult(component.dataSource.data[0])
    ).toEqual(initialDecision);
    expect(snackBar.open).not.toHaveBeenCalled();
  });

  it('shows multiple results from the same coder in one coder column cell', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const nativeElement = fixture.nativeElement as HTMLElement;
    const rows = Array.from(
      nativeElement.querySelectorAll('tbody tr')
    ) as HTMLElement[];
    const duplicateCoderRow = rows[2];
    const coderACell = duplicateCoderRow.querySelector(
      'td.mat-column-coder_10'
    ) as HTMLElement;
    const coderBCell = duplicateCoderRow.querySelector(
      'td.mat-column-coder_20'
    ) as HTMLElement;

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
    const rows = Array.from(
      nativeElement.querySelectorAll('tbody tr')
    ) as HTMLElement[];
    const resolvedRow = rows[3];

    expect(resolvedRow.querySelector('.applied-result')?.textContent).toContain(
      '2'
    );
    expect(resolvedRow.querySelector('.applied-result')?.textContent).toContain(
      'Final decision note'
    );
    expect(
      resolvedRow.querySelector('.applied-result-source')?.textContent
    ).toContain('double-coded-review.applied-result.final-source');
    expect(
      resolvedRow.querySelector('.decision-status.resolved')?.textContent
    ).toContain('double-coded-review.applied');

    const coderACell = resolvedRow.querySelector(
      'td.mat-column-coder_10'
    ) as HTMLElement;
    const coderBCell = resolvedRow.querySelector(
      'td.mat-column-coder_20'
    ) as HTMLElement;

    expect(coderACell.querySelector('.applied-code-match')).toBeNull();
    expect(coderBCell.querySelector('.applied-code-match')).toBeTruthy();
    expect(coderBCell.querySelector('.applied-match-icon')).toBeTruthy();
    expect(coderBCell.querySelector('.supervisor-comment-icon')).toBeNull();
  });

  it('labels duplicate coder decisions with job source and counts progress by unique coders', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const regularItem = component.dataSource.data[0];
    const duplicateCoderItem = component.dataSource.data[2];

    expect(
      getDecisionCell(regularItem.responseId).getDecisionSourceLabel(
        regularItem.coderResults[0]
      )
    ).toBe('Coder A');
    expect(
      getDecisionCell(duplicateCoderItem.responseId).getDecisionSourceLabel(
        duplicateCoderItem.coderResults[0]
      )
    ).toBe('Coder A - Definition 101 / A (#3001)');
    expect(
      getDecisionCell(duplicateCoderItem.responseId).getDecisionSourceLabel(
        duplicateCoderItem.coderResults[1]
      )
    ).toBe('Coder A renamed - Definition 102 / A (#3002)');

    expect(component.getCoderCount(duplicateCoderItem)).toBe(1);
    expect(component.getCodedCount(duplicateCoderItem)).toBe(1);
    expect(component.getCoderCompletionStates(duplicateCoderItem)).toEqual([
      true
    ]);

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
    expect(
      component.getCoderCompletionStates(partiallyPendingDuplicateCoderItem)
    ).toEqual([false]);
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
    expect(component.getConflictType(interCoderConflictItem)).toBe(
      'inter-coder'
    );
    expect(component.getConflictType(mixedConflictItem)).toBe('mixed');
    expect(component.hasConflict(sameCoderMatchItem)).toBe(false);
    expect(component.hasConflict(sameCoderConflictItem)).toBe(true);

    expect(getDecisionCell(sameCoderConflictItem.responseId).statusLabel).toBe(
      'double-coded-review.decision.status-same-coder-conflict'
    );
    expect(getDecisionCell(interCoderConflictItem.responseId).statusLabel).toBe(
      'double-coded-review.decision.status-inter-coder-conflict'
    );
  });
});
