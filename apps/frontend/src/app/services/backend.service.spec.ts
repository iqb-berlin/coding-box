import { TestBed } from '@angular/core/testing';
import { BackendService } from './backend.service';
import { AppService } from './app.service';
import { FileService } from './file.service';
import { CodingService } from './coding.service';
import { UnitTagService } from './unit-tag.service';
import { UnitNoteService } from './unit-note.service';
import { ResponseService } from './response.service';
import { TestResultService } from './test-result.service';
import { ResourcePackageService } from './resource-package.service';
import { UnitService } from './unit.service';
import { ValidationService } from './validation.service';
import { ImportService } from './import.service';
import { VariableAnalysisService } from './variable-analysis.service';
import { UserBackendService } from './user-backend.service';
import { WorkspaceBackendService } from './workspace-backend.service';
import { CodingJobBackendService } from './coding-job-backend.service';
import { ReplayBackendService } from './replay-backend.service';
import { TestResultBackendService } from './test-result-backend.service';
import { CodingTrainingBackendService } from './coding-training-backend.service';
import { FileBackendService } from './file-backend.service';
import { SERVER_URL } from '../injection-tokens';

describe('BackendService', () => {
  let service: BackendService;

  const mockServices = {
    AppService: {},
    FileService: {
      getDirectDownloadLink: jest.fn(),
      deleteFiles: jest.fn(),
      downloadFile: jest.fn(),
      validateFiles: jest.fn(),
      uploadTestFiles: jest.fn(),
      uploadTestResults: jest.fn(),
      getFilesList: jest.fn(),
      getUnitDef: jest.fn(),
      getPlayer: jest.fn(),
      getUnit: jest.fn(),
      getBookletUnits: jest.fn(),
      getBookletInfo: jest.fn(),
      getUnitInfo: jest.fn(),
      getUnitContentXml: jest.fn(),
      getTestTakerContentXml: jest.fn(),
      getCodingSchemeFile: jest.fn(),
      getUnitsWithFileIds: jest.fn(),
      getVariableInfoForScheme: jest.fn()
    },
    CodingService: {
      getCodingJobStatus: jest.fn(),
      getCodingListAsCsv: jest.fn(),
      getCodingListAsExcel: jest.fn(),
      getCodingResultsByVersion: jest.fn(),
      getCodingResultsByVersionAsExcel: jest.fn(),
      getCodingStatistics: jest.fn(),
      createCodingStatisticsJob: jest.fn(),
      getResponsesByStatus: jest.fn(),
      getReplayUrl: jest.fn(),
      getMissingsProfiles: jest.fn(),
      getMissingsProfileDetails: jest.fn(),
      createMissingsProfile: jest.fn(),
      updateMissingsProfile: jest.fn(),
      deleteMissingsProfile: jest.fn(),
      getCodingBook: jest.fn()
    },
    UnitTagService: {
      createUnitTag: jest.fn(),
      deleteUnitTag: jest.fn()
    },
    UnitNoteService: {
      createUnitNote: jest.fn(),
      getUnitNotes: jest.fn(),
      deleteUnitNote: jest.fn(),
      getNotesForMultipleUnits: jest.fn()
    },
    ResponseService: {
      getResponses: jest.fn(),
      deleteResponse: jest.fn(),
      searchResponses: jest.fn(),
      deleteTestPersons: jest.fn()
    },
    TestResultService: {
      getTestPersons: jest.fn(),
      getUnitLogs: jest.fn(),
      getBookletLogsForUnit: jest.fn(),
      getPersonTestResults: jest.fn(),
      searchBookletsByName: jest.fn(),
      searchUnitsByName: jest.fn(),
      deleteBooklet: jest.fn()
    },
    ResourcePackageService: {
      getResourcePackages: jest.fn(),
      uploadResourcePackage: jest.fn(),
      deleteResourcePackages: jest.fn(),
      downloadResourcePackage: jest.fn()
    },
    UnitService: {
      deleteUnit: jest.fn(),
      deleteMultipleUnits: jest.fn()
    },
    ValidationService: {
      createDeleteAllResponsesTask: jest.fn(),
      createDeleteResponsesTask: jest.fn(),
      createValidationTask: jest.fn(),
      getValidationTask: jest.fn(),
      getValidationResults: jest.fn(),
      pollValidationTask: jest.fn()
    },
    ImportService: {
      importWorkspaceFiles: jest.fn(),
      importTestcenterGroups: jest.fn()
    },
    VariableAnalysisService: {},
    UserBackendService: {
      getUsers: jest.fn(),
      saveUsers: jest.fn(),
      getUsersFull: jest.fn(),
      addUser: jest.fn(),
      changeUserData: jest.fn(),
      deleteUsers: jest.fn(),
      getWorkspacesByUserList: jest.fn(),
      setUserWorkspaceAccessRight: jest.fn(),
      authenticate: jest.fn()
    },
    WorkspaceBackendService: {
      getAllWorkspacesList: jest.fn(),
      getWorkspaceUsers: jest.fn(),
      addWorkspace: jest.fn(),
      deleteWorkspace: jest.fn(),
      changeWorkspace: jest.fn(),
      setWorkspaceUsersAccessRight: jest.fn()
    },
    CodingJobBackendService: {
      getVariableBundles: jest.fn(),
      getCodingJobs: jest.fn(),
      getCodingJob: jest.fn(),
      createCodingJob: jest.fn(),
      updateCodingJob: jest.fn(),
      deleteCodingJob: jest.fn(),
      startCodingJob: jest.fn(),
      getAppliedResultsCount: jest.fn(),
      getCodingIncompleteVariables: jest.fn(),
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
      cancelExportJob: jest.fn()
    },
    ReplayBackendService: {
      storeReplayStatistics: jest.fn(),
      getReplayFrequencyByUnit: jest.fn(),
      getReplayDurationStatistics: jest.fn(),
      getReplayDistributionByDay: jest.fn(),
      getReplayDistributionByHour: jest.fn(),
      getReplayErrorStatistics: jest.fn(),
      getFailureDistributionByUnit: jest.fn(),
      getFailureDistributionByDay: jest.fn(),
      getFailureDistributionByHour: jest.fn()
    },
    TestResultBackendService: {
      getExportOptions: jest.fn(),
      startExportTestResultsJob: jest.fn(),
      startExportTestLogsJob: jest.fn(),
      getExportTestResultsJobs: jest.fn(),
      downloadExportTestResultsJob: jest.fn(),
      deleteTestResultExportJob: jest.fn()
    },
    CodingTrainingBackendService: {
      createCoderTrainingJobs: jest.fn(),
      getCoderTrainings: jest.fn(),
      updateCoderTrainingLabel: jest.fn(),
      deleteCoderTraining: jest.fn(),
      compareTrainingCodingResults: jest.fn(),
      compareWithinTrainingCodingResults: jest.fn(),
      getCodingJobsForTraining: jest.fn()
    },
    FileBackendService: {
      getVocs: jest.fn(),
      downloadWorkspaceFilesAsZip: jest.fn(),
      getUnitVariables: jest.fn()
    }
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        BackendService,
        { provide: SERVER_URL, useValue: 'http://test-server' },
        { provide: AppService, useValue: mockServices.AppService },
        { provide: FileService, useValue: mockServices.FileService },
        { provide: CodingService, useValue: mockServices.CodingService },
        { provide: UnitTagService, useValue: mockServices.UnitTagService },
        { provide: UnitNoteService, useValue: mockServices.UnitNoteService },
        { provide: ResponseService, useValue: mockServices.ResponseService },
        { provide: TestResultService, useValue: mockServices.TestResultService },
        { provide: ResourcePackageService, useValue: mockServices.ResourcePackageService },
        { provide: UnitService, useValue: mockServices.UnitService },
        { provide: ValidationService, useValue: mockServices.ValidationService },
        { provide: ImportService, useValue: mockServices.ImportService },
        { provide: VariableAnalysisService, useValue: mockServices.VariableAnalysisService },
        { provide: UserBackendService, useValue: mockServices.UserBackendService },
        { provide: WorkspaceBackendService, useValue: mockServices.WorkspaceBackendService },
        { provide: CodingJobBackendService, useValue: mockServices.CodingJobBackendService },
        { provide: ReplayBackendService, useValue: mockServices.ReplayBackendService },
        { provide: TestResultBackendService, useValue: mockServices.TestResultBackendService },
        { provide: CodingTrainingBackendService, useValue: mockServices.CodingTrainingBackendService },
        { provide: FileBackendService, useValue: mockServices.FileBackendService }
      ]
    });
    service = TestBed.inject(BackendService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  // Sample tests for delegation to verify the pattern
  describe('FileService delegation', () => {
    it('should delegate getDirectDownloadLink', () => {
      service.getDirectDownloadLink();
      expect(mockServices.FileService.getDirectDownloadLink).toHaveBeenCalled();
    });

    it('should delegate deleteFiles', () => {
      const workspaceId = 1;
      const fileIds = [1, 2];
      service.deleteFiles(workspaceId, fileIds);
      expect(mockServices.FileService.deleteFiles).toHaveBeenCalledWith(workspaceId, fileIds);
    });
  });

  describe('UserBackendService delegation', () => {
    it('should delegate getUsers', () => {
      service.getUsers(1);
      expect(mockServices.UserBackendService.getUsers).toHaveBeenCalledWith(1);
    });
  });

  describe('CodingJobBackendService delegation', () => {
    it('should delegate getCodingJobs', () => {
      service.getCodingJobs(1, 0, 10);
      expect(mockServices.CodingJobBackendService.getCodingJobs).toHaveBeenCalledWith(1, 0, 10);
    });
  });

  describe('TestResultService delegation', () => {
    it('should delegate getTestPersons', () => {
      service.getTestPersons(1);
      expect(mockServices.TestResultService.getTestPersons).toHaveBeenCalledWith(1);
    });
  });
});
