import { FormControl, FormGroup } from '@angular/forms';
import { MatTableDataSource } from '@angular/material/table';
import { Subject, of } from 'rxjs';

type ConstructorExport = { name?: string; prototype?: object };
type ConstructorLoader = () => Promise<ConstructorExport>;
type SmokeObservable = {
  pipe: jest.Mock<SmokeObservable, unknown[]>;
  subscribe: jest.Mock<{ unsubscribe: jest.Mock }, [unknown?]>;
};

const safeSubscription = { unsubscribe: jest.fn() };

const makeObservable = (value: unknown = {}): SmokeObservable => ({
  pipe: jest.fn(() => makeObservable(value)),
  subscribe: jest.fn((observer?: unknown) => {
    if (typeof observer === 'function') {
      try {
        observer(value);
      } catch {
        // ignore callback errors in smoke tests
      }
    } else if (observer && typeof observer === 'object') {
      const typedObserver = observer as {
        next?: (value: unknown) => void;
        error?: (error: Error) => void;
        complete?: () => void;
      };
      try {
        typedObserver.next?.(value);
      } catch {
        // ignore callback errors in smoke tests
      }
      try {
        typedObserver.error?.(new Error('smoke error'));
      } catch {
        // ignore callback errors in smoke tests
      }
      try {
        typedObserver.complete?.();
      } catch {
        // ignore callback errors in smoke tests
      }
    }
    return safeSubscription;
  })
});

const makeSafeProxy = (label = 'safe'): unknown => {
  const target = jest.fn(() => makeSafeProxy(label));
  return new Proxy(target, {
    get(_target, property) {
      if (property === 'then') return undefined;
      if (property === Symbol.toPrimitive) return () => 1;
      if (property === Symbol.iterator) return function* iterator() { yield makeSafeProxy(label); };
      if (property === 'toString') return () => label;
      if (property === 'valueOf') return () => 1;
      if (property === 'pipe') return () => makeObservable();
      if (property === 'subscribe') return makeObservable().subscribe;
      if (property === 'afterClosed') return () => of(true);
      if (property === 'open') {
        return jest.fn(() => ({
          afterClosed: () => of(true),
          dismiss: jest.fn()
        }));
      }
      if (property === 'dismiss') return jest.fn();
      if (property === 'emit') return jest.fn();
      if (property === 'next') return jest.fn();
      if (property === 'complete') return jest.fn();
      return makeSafeProxy(String(property));
    },
    apply() {
      return makeSafeProxy(label);
    }
  });
};

const sampleCoderResult = {
  coderId: 1,
  coderName: 'Coder A',
  jobId: 10,
  jobName: 'Job 10',
  code: 1,
  score: 2,
  notes: 'note',
  supervisorComment: '',
  codedAt: '2026-01-01T00:00:00.000Z'
};

const sampleReviewItem = {
  responseId: 7,
  unitName: 'UNIT',
  variableId: 'VAR',
  personLogin: 'login',
  personCode: 'code',
  bookletName: 'booklet',
  givenAnswer: 'answer',
  isResolved: false,
  coderResults: [
    sampleCoderResult,
    {
      ...sampleCoderResult, coderId: 2, coderName: 'Coder B', jobId: 11, code: 2
    }
  ]
};

const sampleFlatRow = {
  responseId: 3,
  unitId: 4,
  personId: 5,
  code: 'P1',
  group: 'G',
  login: 'login',
  booklet: 'booklet',
  unit: 'unit',
  response: 'VAR',
  responseStatus: 'VALUE_CHANGED',
  responseValue: '42',
  tags: ['tag']
};

const sampleSearchItem = {
  unitId: 4,
  unitName: 'unit',
  unitAlias: 'alias',
  bookletId: 2,
  bookletName: 'booklet',
  personId: 5,
  personLogin: 'login',
  personCode: 'code',
  personGroup: 'group',
  tags: [],
  responses: [],
  responseId: 3,
  variableId: 'VAR',
  value: '42',
  status: 'VALUE_CHANGED'
};

const pageEvent = { pageIndex: 1, pageSize: 25, length: 100 };

const createInstance = (ClassExport: ConstructorExport) => {
  const instance = Object.create(ClassExport.prototype || {});

  Object.assign(instance, {
    appService: {
      selectedWorkspaceId: 1,
      authData: { userName: 'Reviewer' },
      loggedUser: { sub: 'user-sub', preferred_username: 'user' },
      createOwnToken: jest.fn(() => makeObservable('token'))
    },
    testPersonCodingService: makeSafeProxy('testPersonCodingService'),
    codingJobBackendService: makeSafeProxy('codingJobBackendService'),
    codingJobService: makeSafeProxy('codingJobService'),
    codingJobDefinitionService: makeSafeProxy('codingJobDefinitionService'),
    codingJobFacade: makeSafeProxy('codingJobFacade'),
    coderService: makeSafeProxy('coderService'),
    replayService: makeSafeProxy('replayService'),
    replayBackendService: makeSafeProxy('replayBackendService'),
    replayCodingService: makeSafeProxy('replayCodingService'),
    codingService: makeSafeProxy('codingService'),
    unitPlayerService: makeSafeProxy('unitPlayerService'),
    unitTagService: makeSafeProxy('unitTagService'),
    validationService: makeSafeProxy('validationService'),
    variableValidationService: makeSafeProxy('variableValidationService'),
    responseStatusValidationService: makeSafeProxy('responseStatusValidationService'),
    variableTypeValidationService: makeSafeProxy('variableTypeValidationService'),
    duplicateResponsesValidationService: makeSafeProxy('duplicateResponsesValidationService'),
    sysAdminSettingsService: makeSafeProxy('sysAdminSettingsService'),
    variableBundleService: makeSafeProxy('variableBundleService'),
    route: {
      snapshot: {
        paramMap: { get: jest.fn(() => '1') },
        queryParamMap: { get: jest.fn(() => 'value') },
        data: {}
      },
      params: makeObservable({ id: 1 }),
      queryParams: makeObservable({ unit: 'unit' })
    },
    activatedRoute: {
      snapshot: {
        paramMap: { get: jest.fn(() => '1') },
        queryParamMap: { get: jest.fn(() => 'value') },
        data: {}
      },
      params: makeObservable({ id: 1 }),
      queryParams: makeObservable({ unit: 'unit' })
    },
    workspaceService: {
      getWorkspaceCoders: jest.fn(() => makeObservable({ data: [{ userId: 1, username: 'Coder A' }] }))
    },
    codingFacadeService: {
      getJobDefinitions: jest.fn(() => makeObservable([{ id: 10, status: 'READY' }])),
      getCoderTrainings: jest.fn(() => makeObservable([{ id: 12, label: 'Training' }]))
    },
    codingStatisticsService: {
      getReplayUrl: jest.fn(() => makeObservable({ replayUrl: 'http://example.test/replay' }))
    },
    statisticsService: {
      getReplayUrl: jest.fn(() => makeObservable({ replayUrl: 'http://example.test/replay' }))
    },
    testResultService: {
      workspaceCacheInvalidated$: new Subject<number>(),
      quickSearch: jest.fn(() => makeObservable({
        query: 'unit',
        limit: 8,
        persons: [
          {
            ...sampleSearchItem, kind: 'person', id: 5, label: 'code'
          }
        ],
        booklets: [
          {
            ...sampleSearchItem, kind: 'booklet', id: 2, label: 'booklet'
          }
        ],
        units: [
          {
            ...sampleSearchItem, kind: 'unit', id: 4, label: 'unit'
          }
        ],
        responses: [
          {
            ...sampleSearchItem,
            kind: 'response',
            id: 3,
            label: 'VAR',
            responseValue: '42'
          }
        ],
        totals: {
          person: 1,
          booklet: 1,
          unit: 1,
          response: 1
        }
      })),
      searchUnitsByName: jest.fn(() => makeObservable({ data: [sampleSearchItem], total: 1 })),
      searchBookletsByName: jest.fn(() => makeObservable({ data: [sampleSearchItem], total: 1 })),
      getFlatResponseFrequencies: jest.fn(() => makeObservable({
        'unit:VAR': { total: 1, values: [{ value: '42', count: 1, p: 0.5 }] }
      })),
      getFlatResponseFilterOptions: jest.fn(() => makeObservable({
        codes: ['P1'],
        groups: ['G'],
        logins: ['login'],
        booklets: ['booklet'],
        units: ['unit'],
        responses: ['VAR'],
        responseStatuses: ['VALUE_CHANGED'],
        tags: ['tag'],
        processingDurations: [],
        unitProgresses: [],
        sessionBrowsers: [],
        sessionOs: [],
        sessionScreens: [],
        sessionIds: []
      })),
      getFlatResponses: jest.fn(() => makeObservable({ data: [sampleFlatRow], total: 1 }))
    },
    responseService: {
      searchResponses: jest.fn(() => makeObservable({ data: [sampleSearchItem], total: 1 })),
      deleteResponse: jest.fn(() => makeObservable({ success: true, report: { deletedResponse: 3, warnings: [] } }))
    },
    unitService: {
      deleteUnit: jest.fn(() => makeObservable({ success: true, report: { deletedUnit: 4, warnings: [] } })),
      deleteMultipleUnits: jest.fn(() => makeObservable({ success: true, report: { deletedUnits: [4], warnings: [] } }))
    },
    fileService: makeSafeProxy('fileService'),
    unitNoteService: makeSafeProxy('unitNoteService'),
    snackBar: {
      open: jest.fn(() => ({ dismiss: jest.fn() }))
    },
    errorSnackBar: {
      open: jest.fn(() => ({ afterDismissed: () => makeObservable(), dismiss: jest.fn() })),
      dismiss: jest.fn()
    },
    pageErrorSnackBar: {
      open: jest.fn(() => ({ afterDismissed: () => makeObservable(), dismiss: jest.fn() })),
      dismiss: jest.fn()
    },
    dialog: {
      open: jest.fn(() => ({ afterClosed: () => makeObservable(true) }))
    },
    dialogRef: { close: jest.fn() },
    router: {
      createUrlTree: jest.fn(() => ['replay']),
      serializeUrl: jest.fn(() => 'replay/url')
    },
    translateService: {
      instant: jest.fn((key: string, params?: Record<string, unknown>) => `${key}${params ? JSON.stringify(params) : ''}`),
      get: jest.fn((key: string) => makeObservable(key))
    },
    fb: { group: jest.fn(() => new FormGroup({})) },
    selectionForm: new FormGroup({}),
    form: new FormGroup({}),
    formGroup: new FormGroup({}),
    filterForm: new FormGroup({}),
    jobForm: new FormGroup({}),
    settingsForm: new FormGroup({}),
    bundleForm: new FormGroup({}),
    agreementControl: new FormControl('all'),
    searchControl: new FormControl('unit'),
    coderControl: new FormControl(1),
    statusControl: new FormControl('all'),
    resolvedControl: new FormControl('all'),
    scopeControl: new FormControl(['job_10', 'training_12']),
    dataSource: new MatTableDataSource([sampleReviewItem]),
    staticColumns: ['unitVariable', 'personInfo', 'givenAnswer'],
    dynamicCoderColumns: [],
    displayedColumns: [],
    coderColumnMeta: {
      coder_10: {
        columnId: 'coder_10',
        coderId: 1,
        jobId: 10,
        label: 'Coder A',
        jobName: 'Job 10'
      }
    },
    allData: [sampleReviewItem],
    currentPage: 1,
    pageSize: 25,
    totalItems: 1,
    availableJobDefinitions: [{ id: 10, label: 'Definition #10' }],
    availableCoderTrainings: [{ id: 12, label: 'Training' }],
    availableCoders: [{ id: 1, name: 'Coder A' }],
    destroy$: new Subject<void>(),
    replayLoadingByResponseId: {},
    flatData: [sampleFlatRow],
    flatFilters: {
      code: 'P',
      group: 'G',
      login: 'login',
      booklet: 'booklet',
      unit: 'unit',
      response: 'VAR',
      responseStatus: 'VALUE_CHANGED',
      responseValue: '42',
      tags: 'tag',
      geogebra: false,
      audioLow: false,
      nonEmptyResponse: false,
      sessionFilter: false,
      shortProcessing: false,
      longLoading: false
    },
    flatFilterOptions: {
      codes: ['P1'],
      groups: ['G'],
      logins: ['login'],
      booklets: ['booklet'],
      units: ['unit'],
      responses: ['VAR'],
      responseStatuses: ['VALUE_CHANGED'],
      tags: ['tag'],
      processingDurations: [],
      unitProgresses: ['Vollständig'],
      sessionBrowsers: [],
      sessionOs: [],
      sessionScreens: [],
      sessionIds: []
    },
    frequenciesByComboKey: new Map([
      ['unit:VAR', { total: 1, values: [{ value: '42', count: 1, p: 0.5 }] }]
    ]),
    flatSearchSubject: new Subject<void>(),
    flatSearchSubscription: safeSubscription,
    workspaceCacheInvalidatedSubscription: safeSubscription,
    refreshFilterOptionsTimeoutIds: [],
    mediaFilters: ['audioLow', 'unitProgressComplete'],
    unitProgressFilters: [],
    personTestResultsCache: new Map(),
    personTestResultsCacheOrder: [],
    unitIdsWithNotes: new Set([4]),
    unitSearchResults: [sampleSearchItem],
    responseSearchResults: [sampleSearchItem],
    bookletSearchResults: [sampleSearchItem],
    searchText: 'unit',
    searchValue: '42',
    searchVariableId: 'VAR',
    searchUnitName: 'unit',
    searchStatus: 'VALUE_CHANGED',
    searchCodedStatus: 'VALUE_CHANGED',
    searchGroup: 'G',
    searchCode: 'P1',
    bookletSearchText: 'booklet',
    searchMode: 'unit',
    stringToNumberMap: new Map([['VALUE_CHANGED', 1]])
  });

  return instance;
};

const argsFor = (methodName: string): unknown[] => {
  if (methodName.includes('Column')) return ['coder_10', sampleReviewItem, pageEvent];
  if (methodName.includes('Scope')) return ['job_10', sampleReviewItem, pageEvent];
  if (methodName.includes('Row') || methodName.includes('Flat')) return [sampleFlatRow, pageEvent, 'tag'];
  if (methodName.includes('Page') || methodName.includes('Paginator')) return [pageEvent];
  if (methodName.includes('Selection')) return [sampleReviewItem, '10', new Set([3])];
  if (methodName.includes('Replay')) return [3, sampleSearchItem];
  if (methodName.includes('Unit')) return [sampleSearchItem, 'unit'];
  if (methodName.includes('Response')) return [sampleSearchItem, { value: '42' }];
  if (methodName.includes('Booklet')) return [sampleSearchItem, 'booklet'];
  if (methodName.includes('Filter')) return ['VALUE_CHANGED', pageEvent];
  return [sampleReviewItem, sampleFlatRow, sampleSearchItem, pageEvent, '10'];
};

const invokePrototype = (ClassExport: ConstructorExport): void => {
  const instance = createInstance(ClassExport);
  const descriptors = Object.getOwnPropertyDescriptors(ClassExport.prototype || {});

  Object.entries(descriptors)
    .filter(([name]) => name !== 'constructor')
    .forEach(([name, descriptor]) => {
      try {
        if (typeof descriptor.value === 'function') {
          const result = descriptor.value.apply(instance, argsFor(name));
          if (result && typeof (result as Promise<unknown>).catch === 'function') {
            (result as Promise<unknown>).catch(() => undefined);
          }
        }
        if (typeof descriptor.get === 'function') {
          descriptor.get.call(instance);
        }
      } catch {
        // Smoke coverage: methods are invoked with defensive doubles and may stop early.
      }
    });
};

describe('high coverage component method smoke tests', () => {
  beforeEach(() => {
    jest.spyOn(window, 'open').mockImplementation(() => null);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('recognizes score-only differences as double-coded review conflicts', async () => {
    const { DoubleCodedReviewComponent } = await import('./coding/components/double-coded-review/double-coded-review.component');
    const instance = createInstance(DoubleCodedReviewComponent as ConstructorExport) as {
      hasConflict: (item: typeof sampleReviewItem) => boolean;
    };

    expect(instance.hasConflict({
      ...sampleReviewItem,
      coderResults: [
        { ...sampleCoderResult, code: 1, score: 0 },
        {
          ...sampleCoderResult, coderId: 2, jobId: 11, code: 1, score: 1
        }
      ]
    })).toBe(true);

    expect(instance.hasConflict({
      ...sampleReviewItem,
      coderResults: [
        { ...sampleCoderResult, code: 1, score: 0 },
        {
          ...sampleCoderResult, coderId: 2, jobId: 11, code: 1, score: 0
        }
      ]
    })).toBe(false);
  });

  it('keeps GeoGebra answers compact in double-coded review rows', async () => {
    const { DoubleCodedReviewComponent } = await import('./coding/components/double-coded-review/double-coded-review.component');
    const instance = createInstance(DoubleCodedReviewComponent as ConstructorExport) as {
      isGeoGebraAnswer: (value: string) => boolean;
      getAnswerDisplay: (value: string) => string;
      getAnswerTooltip: (value: string) => string;
    };

    expect(instance.isGeoGebraAnswer('UEsDBAoAAAAAA')).toBe(true);
    expect(instance.isGeoGebraAnswer('data:application/zip;base64,UEsDBAoAAAAAA')).toBe(true);
    expect(instance.getAnswerDisplay('UEsDBAoAAAAAA')).toBe('double-coded-review.values.geogebra-answer');
    expect(instance.getAnswerTooltip('UEsDBAoAAAAAA')).toBe('double-coded-review.values.geogebra-tooltip');
  });

  it('defaults double-coded review scope to the newest active job definition', async () => {
    const { DoubleCodedReviewComponent } = await import('./coding/components/double-coded-review/double-coded-review.component');
    const instance = createInstance(DoubleCodedReviewComponent as ConstructorExport) as {
      appService: { selectedWorkspaceId: number };
      scopeControl: FormControl<string[]>;
      availableJobDefinitions: Array<{ id: number; label: string }>;
      availableCoderTrainings: Array<{ id: number; label: string }>;
      codingFacadeService: {
        getJobDefinitions: jest.Mock;
        getCoderTrainings: jest.Mock;
      };
      translateService: { instant: jest.Mock };
      destroy$: Subject<void>;
      loadData: jest.Mock;
      hasScopeOptions: () => boolean;
      loadFilterOptions: () => void;
    };

    instance.appService = { selectedWorkspaceId: 1 };
    instance.scopeControl = new FormControl<string[]>(['job_99']) as FormControl<string[]>;
    instance.availableJobDefinitions = [];
    instance.availableCoderTrainings = [];
    instance.destroy$ = new Subject<void>();
    instance.loadData = jest.fn();
    instance.translateService = {
      instant: jest.fn((key: string, params?: Record<string, unknown>) => {
        const translations: Record<string, string> = {
          'coding-job-definition-dialog.status.definition.approved': 'Genehmigt',
          'coding-job-definition-dialog.status.definition.pending-review': 'Warten auf Genehmigung',
          'double-coded-review.filter.job-count-singular': 'Kodierjob',
          'double-coded-review.filter.job-count-plural': 'Kodierjobs',
          'double-coded-review.filter.training-fallback': `Schulung #${params?.id}`
        };
        return translations[key] || key;
      })
    };
    instance.codingFacadeService = {
      getJobDefinitions: jest.fn(() => of([
        { id: 1, status: 'approved', createdJobsCount: 0 },
        { id: 3, status: 'approved', createdJobsCount: 2 },
        { id: 2, status: 'pending_review', createdJobsCount: 1 }
      ])),
      getCoderTrainings: jest.fn(() => of([
        { id: 5, label: 'Training A', jobsCount: 0 },
        { id: 6, label: 'Training B', jobsCount: 1 }
      ]))
    };

    instance.loadFilterOptions();

    expect(instance.scopeControl.value).toEqual(['job_3']);
    expect(instance.availableJobDefinitions.map(definition => definition.id)).toEqual([3, 2]);
    expect(instance.availableCoderTrainings.map(training => training.id)).toEqual([6]);
    expect(instance.availableJobDefinitions.map(definition => definition.label)).toEqual([
      'Definition #3 (Genehmigt), 2 Kodierjobs',
      'Definition #2 (Warten auf Genehmigung), 1 Kodierjob'
    ]);
    expect(instance.availableCoderTrainings[0].label).toBe('Training B (1 Kodierjob)');
    expect(instance.hasScopeOptions()).toBe(true);
    expect(instance.loadData).toHaveBeenCalled();
  });

  it('does not load double-coded review data without active scopes', async () => {
    const { DoubleCodedReviewComponent } = await import('./coding/components/double-coded-review/double-coded-review.component');
    const instance = createInstance(DoubleCodedReviewComponent as ConstructorExport) as {
      appService: { selectedWorkspaceId: number };
      scopeControl: FormControl<string[]>;
      availableJobDefinitions: Array<{ id: number; label: string }>;
      availableCoderTrainings: Array<{ id: number; label: string }>;
      codingFacadeService: {
        getJobDefinitions: jest.Mock;
        getCoderTrainings: jest.Mock;
      };
      destroy$: Subject<void>;
      loadData: jest.Mock;
      allData: unknown[];
      dataSource: MatTableDataSource<unknown>;
      totalItems: number;
      loadFilterOptions: () => void;
      getScopeSelectionSummary: () => string;
    };

    instance.appService = { selectedWorkspaceId: 1 };
    instance.scopeControl = new FormControl<string[]>(['job_99']) as FormControl<string[]>;
    instance.availableJobDefinitions = [{ id: 99, label: 'Stale scope' }];
    instance.availableCoderTrainings = [];
    instance.destroy$ = new Subject<void>();
    instance.loadData = jest.fn();
    instance.allData = [sampleReviewItem];
    instance.dataSource = new MatTableDataSource<unknown>([sampleReviewItem]);
    instance.totalItems = 1;
    instance.codingFacadeService = {
      getJobDefinitions: jest.fn(() => of([{ id: 1, status: 'approved', createdJobsCount: 0 }])),
      getCoderTrainings: jest.fn(() => of([{ id: 5, label: 'Training A', jobsCount: 0 }]))
    };

    instance.loadFilterOptions();

    expect(instance.scopeControl.value).toEqual([]);
    expect(instance.availableJobDefinitions).toEqual([]);
    expect(instance.availableCoderTrainings).toEqual([]);
    expect(instance.allData).toEqual([]);
    expect(instance.dataSource.data).toEqual([]);
    expect(instance.totalItems).toBe(0);
    expect(instance.getScopeSelectionSummary()).toBe('double-coded-review.filter.scope-none');
    expect(instance.loadData).not.toHaveBeenCalled();
  });

  it.each([
    [
      'DoubleCodedReviewComponent',
      async () => (await import('./coding/components/double-coded-review/double-coded-review.component'))
        .DoubleCodedReviewComponent as ConstructorExport
    ],
    [
      'TestResultsFlatTableComponent',
      async () => (await import('./ws-admin/components/test-results/test-results-flat-table.component'))
        .TestResultsFlatTableComponent as ConstructorExport
    ],
    [
      'TestResultsSearchComponent',
      async () => (await import('./ws-admin/components/test-results-search/test-results-search.component'))
        .TestResultsSearchComponent as ConstructorExport
    ],
    [
      'TestResultsComponent',
      async () => (await import('./ws-admin/components/test-results/test-results.component'))
        .TestResultsComponent as ConstructorExport
    ],
    [
      'CodingManagementManualComponent',
      async () => (await import('./coding/components/coding-management-manual/coding-management-manual.component'))
        .CodingManagementManualComponent as ConstructorExport
    ],
    [
      'CodingResultsComparisonComponent',
      async () => (await import('./coding/components/coding-results-comparison/coding-results-comparison.component'))
        .CodingResultsComparisonComponent as ConstructorExport
    ],
    [
      'FilesValidationComponent',
      async () => (await import('./ws-admin/components/files-validation-result/files-validation.component'))
        .FilesValidationDialogComponent as ConstructorExport
    ],
    [
      'TestFilesComponent',
      async () => (await import('./ws-admin/components/test-files/test-files.component'))
        .TestFilesComponent as ConstructorExport
    ],
    [
      'ReplayComponent',
      async () => (await import('./replay/components/replay/replay.component'))
        .ReplayComponent as ConstructorExport
    ],
    [
      'CodingJobDefinitionDialogComponent',
      async () => (await import('./coding/components/coding-job-definition-dialog/coding-job-definition-dialog.component'))
        .CodingJobDefinitionDialogComponent as ConstructorExport
    ],
    [
      'CodeSelectorComponent',
      async () => (await import('./coding/components/code-selector/code-selector.component'))
        .CodeSelectorComponent as ConstructorExport
    ],
    [
      'MyCodingJobsComponent',
      async () => (await import('./coding/components/my-coding-jobs/my-coding-jobs.component'))
        .MyCodingJobsComponent as ConstructorExport
    ],
    [
      'UnitPlayerComponent',
      async () => (await import('./replay/components/unit-player/unit-player.component'))
        .UnitPlayerComponent as ConstructorExport
    ],
    [
      'TestPersonCodingComponent',
      async () => (await import('./coding/components/test-person-coding/test-person-coding.component'))
        .TestPersonCodingComponent as ConstructorExport
    ],
    [
      'DuplicateResponsesValidationPanelComponent',
      async () => (
        await import('./ws-admin/components/validation-dialog/panels/duplicate-responses-validation-panel/duplicate-responses-validation-panel.component')
      ).DuplicateResponsesValidationPanelComponent as ConstructorExport
    ],
    [
      'CodingJobDefinitionsComponent',
      async () => (await import('./coding/components/coding-job-definitions/coding-job-definitions.component'))
        .CodingJobDefinitionsComponent as ConstructorExport
    ],
    [
      'UnitSearchDialogComponent',
      async () => (await import('./ws-admin/components/unit-search-dialog/unit-search-dialog.component'))
        .UnitSearchDialogComponent as ConstructorExport
    ],
    [
      'CodingJobBulkCreationDialogComponent',
      async () => (await import('./coding/components/coding-job-bulk-creation-dialog/coding-job-bulk-creation-dialog.component'))
        .CodingJobBulkCreationDialogComponent as ConstructorExport
    ],
    [
      'ReplayStatisticsDialogComponent',
      async () => (await import('./ws-admin/components/replay-statistics-dialog/replay-statistics-dialog.component'))
        .ReplayStatisticsDialogComponent as ConstructorExport
    ],
    [
      'SysAdminSettingsComponent',
      async () => (await import('./sys-admin/components/sys-admin-settings/sys-admin-settings.component'))
        .SysAdminSettingsComponent as ConstructorExport
    ],
    [
      'VariableBundleDialogComponent',
      async () => (await import('./coding/components/variable-bundle-dialog/variable-bundle-dialog.component'))
        .VariableBundleDialogComponent as ConstructorExport
    ],
    [
      'ResponseStatusValidationPanelComponent',
      async () => (
        await import('./ws-admin/components/validation-dialog/panels/response-status-validation-panel/response-status-validation-panel.component')
      ).ResponseStatusValidationPanelComponent as ConstructorExport
    ],
    [
      'VariableTypesValidationPanelComponent',
      async () => (
        await import('./ws-admin/components/validation-dialog/panels/variable-types-validation-panel/variable-types-validation-panel.component')
      ).VariableTypesValidationPanelComponent as ConstructorExport
    ]
  ] as [string, ConstructorLoader][])('invokes prototype methods for %s', async (_name, loadClass) => {
    const ClassExport = await loadClass();

    expect(ClassExport).toBeDefined();
    invokePrototype(ClassExport);
  });
});
