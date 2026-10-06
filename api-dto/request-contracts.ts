import { array, boolean, either, number, object, string, values, InferRequest } from './request-schema';
import { ResponseMatchingFlag } from './coding/response-matching-flag';

const trainingDiscussionApplySource = values('manual', 'auto_agreement');

const exportTransport = {
  authToken: string,
  serverUrl: string,
  includeReplayUrl: boolean
};

// Runtime contracts for bodies whose TypeScript types are erased (interfaces,
// inline objects and arrays) or whose shared DTOs only carry Swagger metadata.
export const requestBodySchemas = {
  ExternalCodingImportDto: object({
    file: string,
    fileName: string,
    previewOnly: boolean,
    sourceFormat: values('external-coding', 'coding-list', 'coding-results'),
    sourceVersion: values('v1', 'v2', 'v3'),
    scoreMode: values('import', 'derive'),
    existingCodingMode: values('skip-conflicts', 'fill-empty', 'overwrite')
  }, ['file']),
  BackgroundExportRequest: either(
    object({
      ...exportTransport,
      exportType: values('results-by-version'),
      version: values('v1', 'v2', 'v3'),
      format: values('csv', 'excel'),
      missingsProfileId: number,
      includeResponseValues: boolean,
      includeGeoGebraResponseValues: boolean,
      includeGeoGebraFiles: boolean
    }, ['exportType', 'missingsProfileId']),
    object({
      ...exportTransport,
      exportType: values('item-matrix'),
      version: values('v1', 'v2', 'v3'),
      format: values('csv', 'excel'),
      matrixValue: values('code', 'score'),
      missingsProfileId: number,
      notReachedScope: values('unit', 'testlet', 'booklet'),
      recodeTrailingOmissions: boolean,
      items: array(object({ unitId: string, itemId: string }, ['unitId', 'itemId']))
    }, ['exportType', 'missingsProfileId']),
    object({
      ...exportTransport,
      exportType: values('psychometrics'),
      version: values('v1', 'v2', 'v3'),
      format: values('csv', 'excel'),
      partWholeCorrection: boolean,
      missingsProfileId: number,
      maxCategoryCount: number,
      domain: either(
        object({ mode: values('workspace') }, ['mode']),
        object({
          mode: values('vomd-field'),
          scope: values('UNIT', 'ITEM'),
          profileId: string,
          entryId: string
        }, ['mode', 'scope', 'profileId', 'entryId'])
      )
    }, ['exportType']),
    object({
      ...exportTransport,
      exportType: values(
        'aggregated', 'by-coder', 'by-variable', 'by-variable-compact', 'detailed', 'coding-times', 'test-results', 'test-logs', 'coding-list'
      ),
      format: values('csv', 'json', 'excel'),
      outputCommentsInsteadOfCodes: boolean,
      anonymizeCoders: boolean,
      usePseudoCoders: boolean,
      doubleCodingMethod: values('new-row-per-variable', 'new-column-per-coder', 'most-frequent'),
      includeComments: boolean,
      includeModalValue: boolean,
      includeDoubleCoded: boolean,
      includeResponseValues: boolean,
      excludeAutoCoded: boolean,
      trainingRequired: boolean,
      testResultFilters: object({
        groupNames: array(string),
        bookletNames: array(string),
        unitNames: array(string),
        personIds: array(number),
        includeLogAnomalies: boolean
      }),
      jobDefinitionIds: array(number),
      coderTrainingIds: array(number),
      coderIds: array(number)
    }, ['exportType'])
  ),
  AppController_authenticateTestCenter: object({
    username: string,
    password: string,
    server: string,
    url: string
  }, ['username', 'password', 'server', 'url']),
  WorkspaceFilesController_excludePersons: object({
    logins: array(string)
  }, ['logins']),
  WorkspaceFilesController_considerPersons: object({
    logins: array(string)
  }, ['logins']),
  WorkspaceFilesController_downloadWorkspaceFilesAsZip: object({
    fileTypes: array(string)
  }),
  WorkspaceFilesController_updateIgnoredUnits: object({
    ignoredUnits: array(string)
  }, ['ignoredUnits']),
  WorkspaceSettingsDto: object({
    ignoredUnits: array(string),
    ignoredBooklets: array(string),
    ignoredTestlets: array(object({
      bookletId: string,
      testletId: string
    }, ['bookletId', 'testletId']))
  }),
  CodingReplayAnchorOverride: object({
    unitName: string,
    variableId: string,
    replayAnchor: string
  }, ['unitName', 'variableId', 'replayAnchor']),
  GithubReleasesController_installRelease: object({
    url: string
  }, ['url']),
  ImportAcpDto: object({
    acpId: string,
    overwriteExisting: boolean,
    overwriteFileIds: array(string)
  }, ['acpId']),
  UploadFilesToAcpDto: object({
    acpId: string,
    fileIds: array(number),
    changelog: string
  }, ['acpId', 'fileIds']),
  TestResultsDeleteRequestDto: object({
    scope: values('persons', 'filteredPersons', 'groups', 'booklets', 'units'),
    personIds: array(number),
    searchText: string,
    groups: array(string),
    bookletNames: array(string),
    unitNames: array(string)
  }, ['scope']),
  TestResultsResponseCleanupRequestDto: object({
    unitNames: array(string),
    answeredBefore: either(string, number),
    answeredFrom: either(string, number),
    variableIds: array(string),
    subforms: array(string)
  }, ['unitNames', 'answeredBefore']),
  ResolveDuplicateResponsesRequest: object({
    resolutionMap: { type: 'object', additionalProperties: number }
  }, ['resolutionMap']),
  FlatResponseFrequenciesRequest: object({
    combos: array(object({
      unitKey: string,
      variableId: string,
      values: array(string)
    }, ['unitKey', 'variableId', 'values']))
  }, ['combos']),
  ChunkedUploadInitRequestDto: object({
    fileName: string,
    fileSize: number,
    mimeType: string
  }, ['fileName', 'fileSize', 'mimeType']),
  ChunkedUploadCompleteRequestDto: object({
    overwriteExisting: boolean,
    personMatchMode: string,
    overwriteMode: string,
    scope: string,
    groupName: string,
    bookletName: string,
    unitNameOrAlias: string,
    variableId: string,
    subform: string
  }),
  WorkspaceTestResultsExportController_startExportTestResultsJob: object({
    groupNames: array(string),
    bookletNames: array(string),
    unitNames: array(string),
    personIds: array(number),
    includeLogAnomalies: boolean
  }),
  WorkspaceTestResultsExportController_startExportTestLogsJob: object({
    groupNames: array(string),
    bookletNames: array(string),
    unitNames: array(string),
    personIds: array(number)
  }),
  StartCodingFreshnessJobDto: object({
    version: values('v1', 'v3'),
    states: array(values('PENDING', 'STALE'))
  }, ['version']),
  WorkspaceCodingStatisticsController_calculateDistribution: object({
    selectedVariables: array(object({
      unitName: string,
      variableId: string,
      includeDeriveError: boolean
    }, ['unitName', 'variableId'])),
    selectedVariableBundles: array(object({
      id: number,
      name: string,
      caseOrderingMode: values('continuous', 'alternating'),
      variables: array(object({
        unitName: string,
        variableId: string,
        includeDeriveError: boolean
      }, ['unitName', 'variableId']))
    }, ['id', 'name', 'variables'])),
    selectedCoders: array(object({
      id: number,
      name: string,
      username: string,
      weight: number,
      capacityPercent: number
    }, ['id', 'name', 'username'])),
    doubleCodingAbsolute: number,
    doubleCodingPercentage: number,
    caseOrderingMode: values('continuous', 'alternating'),
    maxCodingCases: either({ type: 'null' }, number),
    distributionSeed: either(string, number)
  }, ['selectedVariables', 'selectedCoders']),
  WorkspaceCodingStatisticsController_createDistributedCodingJobs: object({
    selectedVariables: array(object({
      unitName: string,
      variableId: string,
      includeDeriveError: boolean
    }, ['unitName', 'variableId'])),
    selectedVariableBundles: array(object({
      id: number,
      name: string,
      caseOrderingMode: values('continuous', 'alternating'),
      variables: array(object({
        unitName: string,
        variableId: string,
        includeDeriveError: boolean
      }, ['unitName', 'variableId']))
    }, ['id', 'name', 'variables'])),
    selectedCoders: array(object({
      id: number,
      name: string,
      username: string,
      weight: number,
      capacityPercent: number
    }, ['id', 'name', 'username'])),
    doubleCodingAbsolute: number,
    doubleCodingPercentage: number,
    caseOrderingMode: values('continuous', 'alternating'),
    maxCodingCases: either({ type: 'null' }, number),
    distributionSeed: either(string, number),
    showScore: boolean,
    allowComments: boolean,
    suppressGeneralInstructions: boolean
  }, ['selectedVariables', 'selectedCoders']),
  ValidateCodingCompletenessRequestDto: object({
    expectedCombinations: array(object({
      unit_key: string,
      unit_alias: string,
      login_name: string,
      login_code: string,
      person_group: string,
      booklet_id: string,
      variable_id: string,
      variable_page: string,
      variable_anchor: string
    }, ['unit_key', 'login_name', 'login_code', 'booklet_id', 'variable_id'])),
    page: number,
    pageSize: number
  }, ['expectedCombinations']),
  ExportValidationResultsRequestDto: object({
    cacheKey: string
  }, ['cacheKey']),
  WorkspaceCodingAnalysisController_getAppliedResultsCount: object({
    incompleteVariables: array(object({
      unitName: string,
      variableId: string
    }, ['unitName', 'variableId']))
  }, ['incompleteVariables']),
  WorkspaceCodingAnalysisController_saveAggregationSettings: object({
    threshold: number,
    flags: array(values(ResponseMatchingFlag.NO_AGGREGATION, ResponseMatchingFlag.IGNORE_CASE, ResponseMatchingFlag.IGNORE_WHITESPACE))
  }),
  WorkspaceCodingAnalysisController_applyDuplicateAggregation: object({
    threshold: number,
    aggregateMode: boolean
  }, ['threshold', 'aggregateMode']),
  WorkspaceCodingAnalysisController_postTriggerResponseAnalysis: object({
    threshold: number
  }),

  WorkspaceCodingVersionController_resetCodingVersion: object({
    version: values('v1', 'v2', 'v3'),
    unitFilters: array(string),
    variableFilters: array(string)
  }, ['version']),
  WorkspaceCoderTrainingController_generateCoderTrainingPackages: object({
    selectedCoders: array(object({
      id: number,
      name: string
    }, ['id', 'name'])),
    variableConfigs: array(object({
      variableId: string,
      unitId: string,
      sampleCount: number,
      includeDeriveError: boolean
    }, ['variableId', 'unitId', 'sampleCount']))
  }, ['selectedCoders', 'variableConfigs']),
  WorkspaceCoderTrainingController_createCoderTrainingJobs: object({
    trainingLabel: string,
    missingsProfileId: number,
    selectedCoders: array(object({
      id: number,
      name: string
    }, ['id', 'name'])),
    variableConfigs: array(object({
      variableId: string,
      unitId: string,
      sampleCount: number,
      includeDeriveError: boolean
    }, ['variableId', 'unitId', 'sampleCount'])),
    assignedVariables: array(object({
      unitName: string,
      variableId: string,
      sampleCount: number,
      includeDeriveError: boolean
    }, ['unitName', 'variableId'])),
    assignedVariableBundles: array(object({
      id: number,
      name: string,
      variables: array(object({
        unitName: string,
        variableId: string,
        sampleCount: number,
        includeDeriveError: boolean
      }, ['unitName', 'variableId'])),
      sampleCount: number,
      caseOrderingMode: values('continuous', 'alternating')
    }, ['id', 'name'])),
    caseOrderingMode: values('continuous', 'alternating'),
    caseSelectionMode: values('oldest_first', 'newest_first', 'random', 'random_per_testgroup', 'random_testgroups'),
    referenceTrainingIds: array(number),
    referenceMode: values('same', 'different'),
    showScore: boolean,
    allowComments: boolean,
    suppressGeneralInstructions: boolean
  }, ['trainingLabel', 'selectedCoders', 'variableConfigs']),
  WorkspaceCoderTrainingController_saveDiscussionResult: object({
    responseId: number,
    code: either({ type: 'null' }, number),
    score: either({ type: 'null' }, number),
    notes: either({ type: 'null' }, string)
  }, ['responseId', 'code', 'score']),
  TrainingDiscussionApplySource: trainingDiscussionApplySource,
  TrainingDiscussionApplyPreviewRequest: object({ source: trainingDiscussionApplySource }, ['source']),
  ApplyTrainingDiscussionResultsRequestDto: object({
    source: trainingDiscussionApplySource,
    existingResultStrategy: values('skip', 'overwrite'),
    jobConflictStrategy: values('skip', 'removeFromJobs')
  }, ['source']),
  WorkspaceCoderTrainingController_updateCoderTraining: object({
    label: string,
    missingsProfileId: number,
    selectedCoders: array(object({
      id: number,
      name: string
    }, ['id', 'name'])),
    variableConfigs: array(object({
      variableId: string,
      unitId: string,
      sampleCount: number,
      includeDeriveError: boolean
    }, ['variableId', 'unitId', 'sampleCount'])),
    assignedVariables: array(object({
      unitName: string,
      variableId: string,
      sampleCount: number,
      includeDeriveError: boolean
    }, ['unitName', 'variableId'])),
    assignedVariableBundles: array(object({
      id: number,
      name: string,
      variables: array(object({
        unitName: string,
        variableId: string,
        sampleCount: number,
        includeDeriveError: boolean
      }, ['unitName', 'variableId'])),
      sampleCount: number,
      caseOrderingMode: values('continuous', 'alternating')
    }, ['id', 'name'])),
    caseOrderingMode: values('continuous', 'alternating'),
    caseSelectionMode: values('oldest_first', 'newest_first', 'random', 'random_per_testgroup', 'random_testgroups'),
    referenceTrainingIds: array(number),
    referenceMode: values('same', 'different'),
    showScore: boolean,
    allowComments: boolean,
    suppressGeneralInstructions: boolean
  }, ['label', 'selectedCoders', 'variableConfigs']),
  WorkspaceCoderTrainingController_updateCoderTrainingLabel: object({
    label: string
  }, ['label']),
  boolean: boolean,
  WorkspaceUsersController_setWorkspaceUsers: array(number),
  WorkspaceFullDto: object({
    id: { type: 'integer', minimum: 1 },
    name: string,
    settings: object({
      ignoredUnits: array(string),
      ignoredBooklets: array(string),
      ignoredTestlets: array(object({
        bookletId: string,
        testletId: string
      }, ['bookletId', 'testletId']))
    })
  }, ['id']),
  CreateWorkspaceDto: object({
    name: string,
    settings: { type: 'object', additionalProperties: true }
  }, ['name']),
  CreateValidationTaskRequestDto: object({
    additionalData: { type: 'object', additionalProperties: true }
  }),
  MissingsProfilesDto: object({
    id: number,
    label: string,
    missings: either(string, array(object({
      id: string,
      label: string,
      description: string,
      code: number,
      score: either({ type: 'null' }, number)
    }, ['id', 'label', 'description', 'code', 'score'])))
  }, ['label', 'missings']),
  UsersController_updateUsersAccess: array(object({
    id: number,
    name: string,
    isAdmin: boolean,
    accessLevel: number,
    canCode: boolean,
    description: string,
    displayName: string,
    email: string
  }, ['id', 'accessLevel'])),
  UserFullDto: object({
    id: number,
    username: string,
    isAdmin: boolean,
    description: string
  }),
  UsersController_assignUserWorkspaces: array(number),
  CreateUserDto: object({
    username: string,
    isAdmin: boolean,
    email: string,
    lastName: string,
    firstName: string,
    issuer: string,
    identity: string
  }, ['username']),
  AppLogoDto: object({
    data: string,
    alt: string,
    bodyBackground: string,
    boxBackground: string
  }),
  CreateUnitTagDto: object({
    unitId: number,
    tag: string,
    color: string
  }, ['unitId', 'tag']),
  UpdateUnitTagDto: object({
    tag: string,
    color: string
  }, ['tag']),
  CreateUnitNoteDto: object({
    unitId: number,
    note: string
  }, ['unitId', 'note']),
  UnitNotesController_findAllByUnitIds: object({
    unitIds: array(number)
  }, ['unitIds']),
  UpdateUnitNoteDto: object({
    note: string
  }, ['note']),
  UpdateContentPoolSettingsInput: object({
    enabled: boolean,
    baseUrl: string,
    applicationToken: string,
    clearApplicationToken: boolean
  }, ['enabled', 'baseUrl']),
  TestContentPoolConnectionInput: object({
    baseUrl: string,
    applicationToken: string,
    clearApplicationToken: boolean
  }),
  UpdateLegalNoticeDto: object({
    html: string
  }, ['html']),
  WorkspaceSettingsBatchDto: object({
    settings: array(object({
      key: string,
      value: string,
      description: string
    }, ['key', 'value']))
  }, ['settings']),
  WorkspaceSettingWriteDto: object({
    key: string,
    value: string,
    description: string
  }, ['key', 'value']),
  WorkspaceSettingsController_updateWorkspaceSetting: object({
    value: string
  }, ['value'])
};

export type RequestBodyName = keyof typeof requestBodySchemas;

export type RequestBody<Name extends RequestBodyName> = InferRequest<typeof requestBodySchemas[Name]>;
