import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { BackendService } from './backend.service';
import { AppService } from '../core/services/app.service';
import { CodingFacadeService } from './facades/coding-facade.service';
import { TestResultFacadeService } from './facades/test-result-facade.service';
import { WorkspaceFacadeService } from './facades/workspace-facade.service';
import { ValidationFacadeService } from './facades/validation-facade.service';

describe('BackendService', () => {
  let service: BackendService;

  const mockCodingFacade = {
    getCodingJobStatus: jest.fn(),
    getCodingListAsCsv: jest.fn(),
    getCodingListAsExcel: jest.fn(),
    getCodingResultsByVersion: jest.fn(),
    getCodingResultsByVersionAsExcel: jest.fn(),
    getCodingStatistics: jest.fn(),
    createCodingStatisticsJob: jest.fn(),
    getResponsesByStatus: jest.fn(),
    getReplayUrl: jest.fn(),
    getVariableBundles: jest.fn(),
    getCodingJobs: jest.fn(),
    getCodingJob: jest.fn(),
    createCodingJob: jest.fn(),
    updateCodingJob: jest.fn(),
    deleteCodingJob: jest.fn(),
    startCodingJob: jest.fn(),
    getAppliedResultsCount: jest.fn(),
    getCodingIncompleteVariables: jest.fn(),
    createCoderTrainingJobs: jest.fn(),
    getCoderTrainings: jest.fn(),
    updateCoderTrainingLabel: jest.fn(),
    deleteCoderTraining: jest.fn(),
    compareTrainingCodingResults: jest.fn(),
    compareWithinTrainingCodingResults: jest.fn(),
    getCodingJobsForTraining: jest.fn(),
    saveCodingProgress: jest.fn(),
    restartCodingJobWithOpenUnits: jest.fn(),
    getCodingProgress: jest.fn(),
    getBulkCodingProgress: jest.fn(),
    getCodingNotes: jest.fn(),
    getCodingJobUnits: jest.fn(),
    applyCodingResults: jest.fn(),
    bulkApplyCodingResults: jest.fn(),
    createJobDefinition: jest.fn(),
    updateJobDefinition: jest.fn(),
    approveJobDefinition: jest.fn(),
    getJobDefinitions: jest.fn(),
    deleteJobDefinition: jest.fn(),
    startExportJob: jest.fn(),
    getExportJobStatus: jest.fn(),
    downloadExportFile: jest.fn(),
    cancelExportJob: jest.fn(),
    getMissingsProfiles: jest.fn(),
    getMissingsProfileDetails: jest.fn(),
    createMissingsProfile: jest.fn(),
    updateMissingsProfile: jest.fn(),
    deleteMissingsProfile: jest.fn(),
    getCodingBook: jest.fn(),
    storeReplayStatistics: jest.fn(),
    getReplayFrequencyByUnit: jest.fn(),
    getReplayDurationStatistics: jest.fn(),
    getReplayDistributionByDay: jest.fn(),
    getReplayDistributionByHour: jest.fn(),
    getReplayErrorStatistics: jest.fn(),
    getFailureDistributionByUnit: jest.fn(),
    getFailureDistributionByDay: jest.fn(),
    getFailureDistributionByHour: jest.fn(),
    getVariableAnalysis: jest.fn(),
    createDistributedCodingJobs: jest.fn(),
    calculateDistribution: jest.fn(),
    resetCodingVersion: jest.fn(),
    deleteVariableAnalysisJob: jest.fn(),
    cancelVariableAnalysisJob: jest.fn(),
    getAllVariableAnalysisJobs: jest.fn(),
    createVariableAnalysisJob: jest.fn(),
    getVariableAnalysisResults: jest.fn()
  };

  const mockTestResultFacade = {
    getTestPersons: jest.fn(),
    getUnitLogs: jest.fn(),
    getBookletLogsForUnit: jest.fn(),
    getExportOptions: jest.fn(),
    startExportTestResultsJob: jest.fn(),
    startExportTestLogsJob: jest.fn(),
    getExportTestResultsJobs: jest.fn(),
    downloadExportTestResultsJob: jest.fn(),
    deleteTestResultExportJob: jest.fn(),
    getPersonTestResults: jest.fn(),
    searchBookletsByName: jest.fn(),
    searchUnitsByName: jest.fn(),
    deleteBooklet: jest.fn(),
    getResponsesForUnit: jest.fn(),
    deleteResponse: jest.fn(),
    searchResponses: jest.fn(),
    deleteTestPersons: jest.fn(),
    uploadTestResults: jest.fn()
  };

  const mockWorkspaceFacade = {
    getDirectDownloadLink: jest.fn(),
    getUsers: jest.fn(),
    saveUsers: jest.fn(),
    getUsersFull: jest.fn(),
    addUser: jest.fn(),
    changeUserData: jest.fn(),
    deleteUsers: jest.fn(),
    getAllWorkspacesList: jest.fn(),
    getWorkspacesByUserList: jest.fn(),
    getWorkspaceUsers: jest.fn(),
    addWorkspace: jest.fn(),
    deleteWorkspace: jest.fn(),
    changeWorkspace: jest.fn(),
    setWorkspaceUsersAccessRight: jest.fn(),
    setUserWorkspaceAccessRight: jest.fn(),
    createUnitTag: jest.fn(),
    deleteUnitTag: jest.fn(),
    createUnitNote: jest.fn(),
    getUnitNotes: jest.fn(),
    deleteUnitNote: jest.fn(),
    getNotesForMultipleUnits: jest.fn(),
    deleteFiles: jest.fn(),
    downloadFile: jest.fn(),
    validateFiles: jest.fn(),
    uploadTestFiles: jest.fn(),
    getFilesList: jest.fn(),
    getUnitDef: jest.fn(),
    getPlayer: jest.fn(),
    getUnit: jest.fn(),
    getVocs: jest.fn(),
    getBookletUnits: jest.fn(),
    getBookletInfo: jest.fn(),
    getUnitInfo: jest.fn(),
    getResourcePackages: jest.fn(),
    uploadResourcePackage: jest.fn(),
    deleteResourcePackages: jest.fn(),
    downloadResourcePackage: jest.fn(),
    deleteUnit: jest.fn(),
    deleteMultipleUnits: jest.fn(),
    importWorkspaceFiles: jest.fn(),
    importTestcenterGroups: jest.fn(),
    downloadWorkspaceFilesAsZip: jest.fn(),
    getUnitVariables: jest.fn(),
    getUnitContentXml: jest.fn(),
    getTestTakerContentXml: jest.fn(),
    getCodingSchemeFile: jest.fn(),
    getUnitsWithFileIds: jest.fn(),
    getVariableInfoForScheme: jest.fn(),
    authenticate: jest.fn(),
    createDummyTestTakerFile: jest.fn()
  };

  const mockValidationFacade = {
    createDeleteAllResponsesTask: jest.fn(),
    createDeleteResponsesTask: jest.fn(),
    createValidationTask: jest.fn(),
    getValidationTask: jest.fn(),
    getValidationResults: jest.fn(),
    pollValidationTask: jest.fn()
  };

  const mockAppService = {};

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        BackendService,
        provideHttpClient(withInterceptorsFromDi()),
        { provide: AppService, useValue: mockAppService },
        { provide: CodingFacadeService, useValue: mockCodingFacade },
        { provide: TestResultFacadeService, useValue: mockTestResultFacade },
        { provide: WorkspaceFacadeService, useValue: mockWorkspaceFacade },
        { provide: ValidationFacadeService, useValue: mockValidationFacade }
      ]
    });
    service = TestBed.inject(BackendService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('Delegation', () => {
    it('should delegate getDirectDownloadLink to workspaceFacade', () => {
      service.getDirectDownloadLink();
      expect(mockWorkspaceFacade.getDirectDownloadLink).toHaveBeenCalled();
    });

    it('should delegate getCodingJobs to codingFacade', () => {
      service.getCodingJobs(1, 1, 10);
      expect(mockCodingFacade.getCodingJobs).toHaveBeenCalledWith(1, 1, 10);
    });

    it('should delegate getTestPersons to testResultFacade', () => {
      service.getTestPersons(1);
      expect(mockTestResultFacade.getTestPersons).toHaveBeenCalledWith(1);
    });

    it('should delegate createValidationTask to validationFacade', () => {
      service.createValidationTask(1, 'variables');
      expect(mockValidationFacade.createValidationTask).toHaveBeenCalledWith(1, 'variables', undefined, undefined, undefined);
    });
  });
});
