import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { VariableInfo } from '@iqbspecs/variable-info/variable-info.interface';
import { FilesInListDto } from '../../../../../api-dto/files/files-in-list.dto';
import { UnitTagDto } from '../../../../../api-dto/unit-tags/unit-tag.dto';
import { CreateUnitTagDto } from '../../../../../api-dto/unit-tags/create-unit-tag.dto';
import { TestFilesUploadResultDto } from '../../../../../api-dto/files/test-files-upload-result.dto';
import { CreateWorkspaceDto } from '../../../../../api-dto/workspaces/create-workspace-dto';
import { PaginatedWorkspacesDto } from '../../../../../api-dto/workspaces/paginated-workspaces-dto';
import {
  CodingJob,
  VariableBundle
} from '../coding/models/coding-job.model';
import { AppService } from '../core/services/app.service';
import { TestGroupsInfoDto } from '../../../../../api-dto/files/test-groups-info.dto';
import { ResponseEntity } from '../shared/models/response-entity.model';
import { ServerResponse } from './authentication.service';
import { BookletUnit } from './file.service';
import {
  PersonTestResult, UnitLogRow, BookletLogsForUnitResponse
} from './test-result.service';
import { ResponseDto } from '../../../../../api-dto/responses/response-dto';
import { ImportOptions, Result } from './import.service';
import { VariableAnalysisResultDto, JobCancelResult } from './variable-analysis.service';
import { VariableAnalysisItemDto } from '../../../../../api-dto/coding/variable-analysis-item.dto';
import { ValidationTaskDto } from '../models/validation-task.dto';
import { FilesDto } from '../../../../../api-dto/files/files.dto';
import { CodingStatistics } from '../../../../../api-dto/coding/coding-statistics';
import { FileValidationResultDto } from '../../../../../api-dto/files/file-validation-result.dto';
import { FileDownloadDto } from '../../../../../api-dto/files/file-download.dto';
import { PaginatedWorkspaceUserDto } from '../../../../../api-dto/workspaces/paginated-workspace-user-dto';
import { UserFullDto } from '../../../../../api-dto/user/user-full-dto';
import { CreateUserDto } from '../../../../../api-dto/user/create-user-dto';
import { UserWorkspaceAccessDto } from '../../../../../api-dto/workspaces/user-workspace-access-dto';
import { UserInListDto } from '../../../../../api-dto/user/user-in-list-dto';
import { BookletInfoDto } from '../../../../../api-dto/booklet-info/booklet-info.dto';
import { UnitInfoDto } from '../../../../../api-dto/unit-info/unit-info.dto';
import { CodeBookContentSetting } from '../../../../../api-dto/coding/codebook-content-setting';
import { UnitVariableDetailsDto } from '../models/unit-variable-details.dto';
import { MissingsProfilesDto } from '../../../../../api-dto/coding/missings-profiles.dto';
import { VariableAnalysisJobDto } from '../models/variable-analysis-job.dto';
import { TestResultsUploadResultDto } from '../../../../../api-dto/files/test-results-upload-result.dto';
import { ResourcePackageDto } from '../../../../../api-dto/resource-package/resource-package-dto';
import { UnitNoteDto } from '../../../../../api-dto/unit-notes/unit-note.dto';
import { CreateUnitNoteDto } from '../../../../../api-dto/unit-notes/create-unit-note.dto';
import { WorkspaceFullDto } from '../../../../../api-dto/workspaces/workspace-full-dto';
import {
  JobDefinition,
  CodingExportConfig
} from './coding-job-backend.service';
import { ReplayStatisticsResponse } from './replay-backend.service';
import { TestResultExportJob } from './test-result-backend.service';
import {
  CreateCoderTrainingJobsResponse,
  TrainingCodingResult,
  WithinTrainingCodingResult,
  CodingJobForTraining
} from './coding-training-backend.service';
import { CoderTraining } from '../coding/models/coder-training.model';

// Re-exporting interfaces from facades
import {
  CodingFacadeService,
  CodingJobItem,
  CodingJobStatus,
  BulkApplyResultItem,
  BulkApplyCodingResultsResponse,
  ExportJobStatus
} from './facades/coding-facade.service';
import {
  TestResultFacadeService,
  SearchResponsesParams,
  SearchResponseItem,
  SearchBookletItem,
  SearchUnitItem
} from './facades/test-result-facade.service';
import { WorkspaceFacadeService } from './facades/workspace-facade.service';
import { ValidationFacadeService } from './facades/validation-facade.service';

export {
  CodingJobItem,
  CodingJobStatus,
  BulkApplyResultItem,
  BulkApplyCodingResultsResponse,
  ExportJobStatus,
  SearchResponsesParams,
  SearchResponseItem,
  SearchBookletItem,
  SearchUnitItem
};

interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

@Injectable({
  providedIn: 'root'
})
export class BackendService {
  appService = inject(AppService);
  private http = inject(HttpClient);

  private codingFacade = inject(CodingFacadeService);
  private testResultFacade = inject(TestResultFacadeService);
  private workspaceFacade = inject(WorkspaceFacadeService);
  private validationFacade = inject(ValidationFacadeService);

  getAuthData(): Observable<import('../../../../../api-dto/auth-data-dto').AuthDataDto> {
    return this.http.get<import('../../../../../api-dto/auth-data-dto').AuthDataDto>(
      `${this.appService.serverUrl}auth-data`,
    { headers: this.appService.authHeader }
    );
  }

  getDirectDownloadLink(): string {
    return this.workspaceFacade.getDirectDownloadLink();
  }

  getUsers(workspaceId: number): Observable<UserInListDto[]> {
    return this.workspaceFacade.getUsers(workspaceId);
  }

  saveUsers(workspaceId: number, users: UserWorkspaceAccessDto[]): Observable<UserWorkspaceAccessDto[]> {
    return this.workspaceFacade.saveUsers(workspaceId, users);
  }

  getUsersFull(): Observable<UserFullDto[]> {
    return this.workspaceFacade.getUsersFull();
  }

  addUser(newUser: CreateUserDto): Observable<boolean> {
    return this.workspaceFacade.addUser(newUser);
  }

  changeUserData(userId: number, newData: UserFullDto): Observable<boolean> {
    return this.workspaceFacade.changeUserData(userId, newData);
  }

  deleteUsers(users: number[]): Observable<boolean> {
    return this.workspaceFacade.deleteUsers(users);
  }

  getAllWorkspacesList(): Observable<PaginatedWorkspacesDto> {
    return this.workspaceFacade.getAllWorkspacesList();
  }

  getWorkspacesByUserList(userId: number): Observable<number[]> {
    return this.workspaceFacade.getWorkspacesByUserList(userId);
  }

  getWorkspaceUsers(workspaceId: number): Observable<PaginatedWorkspaceUserDto> {
    return this.workspaceFacade.getWorkspaceUsers(workspaceId);
  }

  addWorkspace(workspaceData: CreateWorkspaceDto): Observable<boolean> {
    return this.workspaceFacade.addWorkspace(workspaceData);
  }

  deleteWorkspace(ids: number[]): Observable<boolean> {
    return this.workspaceFacade.deleteWorkspace(ids);
  }

  changeWorkspace(workspaceData: WorkspaceFullDto): Observable<boolean> {
    return this.workspaceFacade.changeWorkspace(workspaceData);
  }

  setWorkspaceUsersAccessRight(workspaceId: number, userIds: number[]): Observable<boolean> {
    return this.workspaceFacade.setWorkspaceUsersAccessRight(workspaceId, userIds);
  }

  setUserWorkspaceAccessRight(userId: number, workspaceIds: number[]): Observable<boolean> {
    return this.workspaceFacade.setUserWorkspaceAccessRight(userId, workspaceIds);
  }

  createUnitTag(workspaceId: number, unitTag: CreateUnitTagDto): Observable<UnitTagDto> {
    return this.workspaceFacade.createUnitTag(workspaceId, unitTag);
  }

  deleteUnitTag(workspaceId: number, tagId: number): Observable<boolean> {
    return this.workspaceFacade.deleteUnitTag(workspaceId, tagId);
  }

  createUnitNote(workspaceId: number, unitNote: CreateUnitNoteDto): Observable<UnitNoteDto> {
    return this.workspaceFacade.createUnitNote(workspaceId, unitNote);
  }

  getUnitNotes(workspaceId: number, unitId: number): Observable<UnitNoteDto[]> {
    return this.workspaceFacade.getUnitNotes(workspaceId, unitId);
  }

  deleteUnitNote(workspaceId: number, noteId: number): Observable<boolean> {
    return this.workspaceFacade.deleteUnitNote(workspaceId, noteId);
  }

  deleteFiles(workspaceId: number, fileIds: number[]): Observable<boolean> {
    return this.workspaceFacade.deleteFiles(workspaceId, fileIds);
  }

  downloadFile(workspaceId: number, fileId: number): Observable<FileDownloadDto> {
    return this.workspaceFacade.downloadFile(workspaceId, fileId);
  }

  validateFiles(workspaceId: number): Observable<boolean | FileValidationResultDto> {
    return this.workspaceFacade.validateFiles(workspaceId);
  }

  uploadTestFiles(workspaceId: number, files: FileList | FormData | null, overwriteExisting: boolean = false, overwriteFileIds?: string[]): Observable<TestFilesUploadResultDto> {
    return this.workspaceFacade.uploadTestFiles(workspaceId, files, overwriteExisting, overwriteFileIds);
  }

  uploadTestResults(workspaceId: number, files: FileList | null, resultType: 'logs' | 'responses', overwriteExisting: boolean = true, overwriteMode: 'skip' | 'merge' | 'replace' = 'skip', scope: string = 'person', filters?: Record<string, unknown>): Observable<TestResultsUploadResultDto> {
    return this.testResultFacade.uploadTestResults(workspaceId, files, resultType, overwriteExisting, overwriteMode, scope, filters);
  }

  getFilesList(workspaceId: number, page: number = 1, limit: number = 10000, fileType?: string, fileSize?: string, searchText?: string): Observable<PaginatedResponse<FilesInListDto> & { fileTypes: string[] }> {
    return this.workspaceFacade.getFilesList(workspaceId, page, limit, fileType, fileSize, searchText);
  }

  getUnitDef(workspaceId: number, unit: string, authToken?: string): Observable<FilesDto[]> {
    return this.workspaceFacade.getUnitDef(workspaceId, unit, authToken);
  }

  getPlayer(workspaceId: number, player: string, authToken?: string): Observable<FilesDto[]> {
    return this.workspaceFacade.getPlayer(workspaceId, player, authToken);
  }

  getUnit(workspaceId: number, unitId: string, authToken?: string): Observable<FilesDto[]> {
    return this.workspaceFacade.getUnit(workspaceId, unitId, authToken);
  }

  getVocs(workspaceId: number, vocs: string): Observable<FilesDto[]> {
    return this.workspaceFacade.getVocs(workspaceId, vocs);
  }

  getBookletUnits(workspaceId: number, bookletId: string, authToken?: string): Observable<BookletUnit[]> {
    return this.workspaceFacade.getBookletUnits(workspaceId, bookletId, authToken);
  }

  getBookletInfo(workspaceId: number, bookletId: string, authToken?: string): Observable<BookletInfoDto> {
    return this.workspaceFacade.getBookletInfo(workspaceId, bookletId, authToken);
  }

  getUnitInfo(workspaceId: number, unitId: string, authToken?: string): Observable<UnitInfoDto> {
    return this.workspaceFacade.getUnitInfo(workspaceId, unitId, authToken);
  }

  getResponsesForUnit(workspaceId: number, testPerson: string, unitId: string, authToken?: string): Observable<ResponseDto[]> {
    return this.testResultFacade.getResponsesForUnit(workspaceId, testPerson, unitId, authToken);
  }

  deleteResponse(workspaceId: number, responseId: number): Observable<{ success: boolean; report: { deletedResponse: number | null; warnings: string[] } }> {
    return this.testResultFacade.deleteResponse(workspaceId, responseId);
  }

  searchResponses(
    workspaceId: number,
    searchParams: SearchResponsesParams,
    page?: number,
    limit?: number
  ): Observable<{ data: SearchResponseItem[]; total: number }> {
    return this.testResultFacade.searchResponses(workspaceId, searchParams, page, limit);
  }

  getTestPersons(workspaceId: number): Observable<number[]> {
    return this.testResultFacade.getTestPersons(workspaceId);
  }

  deleteTestPersons(workspaceId: number, testPersonIds: number[]): Observable<boolean> {
    return this.testResultFacade.deleteTestPersons(workspaceId, testPersonIds);
  }

  getResourcePackages(workspaceId: number): Observable<ResourcePackageDto[]> {
    return this.workspaceFacade.getResourcePackages(workspaceId);
  }

  uploadResourcePackage(workspaceId: number, file: File): Observable<number> {
    return this.workspaceFacade.uploadResourcePackage(workspaceId, file);
  }

  deleteResourcePackages(workspaceId: number, ids: number[]): Observable<boolean> {
    return this.workspaceFacade.deleteResourcePackages(workspaceId, ids);
  }

  downloadResourcePackage(workspaceId: number, name: string): Observable<Blob> {
    return this.workspaceFacade.downloadResourcePackage(workspaceId, name);
  }

  createDeleteAllResponsesTask(workspaceId: number, validationType: 'variables' | 'variableTypes' | 'responseStatus' | 'duplicateResponses'): Observable<ValidationTaskDto> {
    return this.validationFacade.createDeleteAllResponsesTask(workspaceId, validationType);
  }

  createDeleteResponsesTask(workspaceId: number, responseIds: number[]): Observable<ValidationTaskDto> {
    return this.validationFacade.createDeleteResponsesTask(workspaceId, responseIds);
  }

  createValidationTask(workspaceId: number, type: 'variables' | 'variableTypes' | 'responseStatus' | 'testTakers' | 'groupResponses' | 'deleteResponses' | 'deleteAllResponses' | 'duplicateResponses', page?: number, limit?: number, additionalData?: Record<string, unknown>): Observable<ValidationTaskDto> {
    return this.validationFacade.createValidationTask(workspaceId, type, page, limit, additionalData);
  }

  getValidationTask(workspaceId: number, taskId: number): Observable<ValidationTaskDto> {
    return this.validationFacade.getValidationTask(workspaceId, taskId);
  }

  getValidationResults(workspaceId: number, taskId: number): Observable<unknown> {
    return this.validationFacade.getValidationResults(workspaceId, taskId);
  }

  pollValidationTask(workspaceId: number, taskId: number, pollInterval: number = 2000): Observable<ValidationTaskDto> {
    return this.validationFacade.pollValidationTask(workspaceId, taskId, pollInterval);
  }

  getUnitLogs(workspaceId: number, unitId: number): Observable<UnitLogRow[]> {
    return this.testResultFacade.getUnitLogs(workspaceId, unitId);
  }

  getNotesForMultipleUnits(workspaceId: number, unitIds: number[]): Observable<{ [unitId: number]: UnitNoteDto[] }> {
    return this.workspaceFacade.getNotesForMultipleUnits(workspaceId, unitIds);
  }

  getBookletLogsForUnit(workspaceId: number, unitId: number): Observable<BookletLogsForUnitResponse | null> {
    return this.testResultFacade.getBookletLogsForUnit(workspaceId, unitId);
  }

  getExportOptions(workspaceId: number) {
    return this.testResultFacade.getExportOptions(workspaceId);
  }

  startExportTestResultsJob(workspaceId: number, filters?: Record<string, unknown>): Observable<{ jobId: string; message: string }> {
    return this.testResultFacade.startExportTestResultsJob(workspaceId, filters);
  }

  startExportTestLogsJob(workspaceId: number, filters?: Record<string, unknown>): Observable<{ jobId: string; message: string }> {
    return this.testResultFacade.startExportTestLogsJob(workspaceId, filters);
  }

  getExportTestResultsJobs(workspaceId: number): Observable<TestResultExportJob[]> {
    return this.testResultFacade.getExportTestResultsJobs(workspaceId);
  }

  downloadExportTestResultsJob(workspaceId: number, jobId: string): Observable<Blob> {
    return this.testResultFacade.downloadExportTestResultsJob(workspaceId, jobId);
  }

  deleteTestResultExportJob(workspaceId: number, jobId: string): Observable<{ success: boolean; message: string }> {
    return this.testResultFacade.deleteTestResultExportJob(workspaceId, jobId);
  }

  getPersonTestResults(workspaceId: number, personId: number): Observable<PersonTestResult[]> {
    return this.testResultFacade.getPersonTestResults(workspaceId, personId);
  }

  getCodingJobStatus(workspaceId: number, jobId: string): Observable<CodingJobStatus> {
    return this.codingFacade.getCodingJobStatus(workspaceId, jobId);
  }

  getCodingListAsCsv(workspaceId: number): Observable<Blob> {
    return this.codingFacade.getCodingListAsCsv(workspaceId);
  }

  getCodingListAsExcel(workspaceId: number): Observable<Blob> {
    return this.codingFacade.getCodingListAsExcel(workspaceId);
  }

  getCodingResultsByVersion(workspaceId: number, version: 'v1' | 'v2' | 'v3', includeReplayUrls: boolean = false): Observable<Blob> {
    return this.codingFacade.getCodingResultsByVersion(workspaceId, version, includeReplayUrls);
  }

  getCodingResultsByVersionAsExcel(workspaceId: number, version: 'v1' | 'v2' | 'v3', includeReplayUrls: boolean = false): Observable<Blob> {
    return this.codingFacade.getCodingResultsByVersionAsExcel(workspaceId, version, includeReplayUrls);
  }

  getCodingStatistics(workspaceId: number, version: 'v1' | 'v2' | 'v3' = 'v1'): Observable<CodingStatistics> {
    return this.codingFacade.getCodingStatistics(workspaceId, version);
  }

  createCodingStatisticsJob(workspaceId: number): Observable<{ jobId: string; message: string }> {
    return this.codingFacade.createCodingStatisticsJob(workspaceId);
  }

  getResponsesByStatus(workspaceId: number, status: string, version: 'v1' | 'v2' | 'v3' = 'v1', page: number = 1, limit: number = 100): Observable<PaginatedResponse<ResponseEntity>> {
    return this.codingFacade.getResponsesByStatus(workspaceId, status, version, page, limit);
  }

  getReplayUrl(workspaceId: number, responseId: number, authToken: string): Observable<{ replayUrl: string }> {
    return this.codingFacade.getReplayUrl(workspaceId, responseId, authToken);
  }

  searchBookletsByName(workspaceId: number, bookletName: string, page?: number, limit?: number): Observable<{ data: SearchBookletItem[]; total: number }> {
    return this.testResultFacade.searchBookletsByName(workspaceId, bookletName, page, limit);
  }

  searchUnitsByName(workspaceId: number, unitName: string, page?: number, limit?: number): Observable<{ data: SearchUnitItem[]; total: number }> {
    return this.testResultFacade.searchUnitsByName(workspaceId, unitName, page, limit);
  }

  deleteUnit(workspaceId: number, unitId: number): Observable<{ success: boolean; report: { deletedUnit: number | null; warnings: string[] } }> {
    return this.workspaceFacade.deleteUnit(workspaceId, unitId);
  }

  deleteMultipleUnits(workspaceId: number, unitIds: number[]): Observable<{ success: boolean; report: { deletedUnits: number[]; warnings: string[] } }> {
    return this.workspaceFacade.deleteMultipleUnits(workspaceId, unitIds);
  }

  deleteBooklet(workspaceId: number, bookletId: number): Observable<{ success: boolean; report: { deletedBooklet: number | null; warnings: string[] } }> {
    return this.testResultFacade.deleteBooklet(workspaceId, bookletId);
  }

  importWorkspaceFiles(
    workspaceId: number,
    testCenterWorkspace: string,
    server: string,
    url: string,
    token: string,
    importOptions: ImportOptions,
    testGroups: string[],
    overwriteExistingLogs: boolean = false,
    overwriteFileIds?: string[]
  ): Observable<Result> {
    return this.workspaceFacade.importWorkspaceFiles(
      workspaceId,
      testCenterWorkspace,
      server,
      url,
      token,
      importOptions,
      testGroups,
      overwriteExistingLogs,
      overwriteFileIds
    );
  }

  importTestcenterGroups(
    workspaceId: number,
    testCenterWorkspace: string,
    server: string,
    url: string,
    authToken: string
  ): Observable<TestGroupsInfoDto[]> {
    return this.workspaceFacade.importTestcenterGroups(
      workspaceId,
      testCenterWorkspace,
      server,
      url,
      authToken
    );
  }

  authenticate(username: string, password: string, server: string, url: string): Observable<ServerResponse> {
    return this.workspaceFacade.authenticate(username, password, server, url);
  }

  storeReplayStatistics(workspaceId: number, data: { unitId: string; bookletId?: string; testPersonLogin?: string; testPersonCode?: string; durationMilliseconds: number; replayUrl?: string; success?: boolean; errorMessage?: string }): Observable<ReplayStatisticsResponse> {
    return this.codingFacade.storeReplayStatistics(workspaceId, data);
  }

  getReplayFrequencyByUnit(workspaceId: number, options?: Record<string, unknown>): Observable<Record<string, number>> {
    return this.codingFacade.getReplayFrequencyByUnit(workspaceId, options);
  }

  getReplayDurationStatistics(workspaceId: number, unitId?: string, options?: Record<string, unknown>): Observable<{ min: number; max: number; average: number; distribution: Record<string, number>; unitAverages?: Record<string, number>; }> {
    return this.codingFacade.getReplayDurationStatistics(workspaceId, unitId, options);
  }

  getReplayDistributionByDay(workspaceId: number, options?: Record<string, unknown>): Observable<Record<string, number>> {
    return this.codingFacade.getReplayDistributionByDay(workspaceId, options);
  }

  getReplayDistributionByHour(workspaceId: number, options?: Record<string, unknown>): Observable<Record<string, number>> {
    return this.codingFacade.getReplayDistributionByHour(workspaceId, options);
  }

  getReplayErrorStatistics(workspaceId: number, options?: Record<string, unknown>): Observable<{ successRate: number; totalReplays: number; successfulReplays: number; failedReplays: number; commonErrors: Array<{ message: string; count: number }>; }> {
    return this.codingFacade.getReplayErrorStatistics(workspaceId, options);
  }

  getFailureDistributionByUnit(workspaceId: number, options?: Record<string, unknown>): Observable<Record<string, number>> {
    return this.codingFacade.getFailureDistributionByUnit(workspaceId, options);
  }

  getFailureDistributionByDay(workspaceId: number, options?: Record<string, unknown>): Observable<Record<string, number>> {
    return this.codingFacade.getFailureDistributionByDay(workspaceId, options);
  }

  getFailureDistributionByHour(workspaceId: number, options?: Record<string, unknown>): Observable<Record<string, number>> {
    return this.codingFacade.getFailureDistributionByHour(workspaceId, options);
  }

  getVariableBundles(workspaceId: number): Observable<VariableBundle[]> {
    return this.codingFacade.getVariableBundles(workspaceId);
  }

  getCodingJobs(workspaceId: number, page?: number, limit?: number): Observable<PaginatedResponse<CodingJob>> {
    return this.codingFacade.getCodingJobs(workspaceId, page, limit);
  }

  getCodingJob(workspaceId: number, codingJobId: number): Observable<CodingJob> {
    return this.codingFacade.getCodingJob(workspaceId, codingJobId);
  }

  createCodingJob(workspaceId: number, codingJob: Omit<CodingJob, 'id' | 'createdAt' | 'updatedAt'>): Observable<CodingJob> {
    return this.codingFacade.createCodingJob(workspaceId, codingJob);
  }

  updateCodingJob(workspaceId: number, codingJobId: number, codingJob: Partial<Omit<CodingJob, 'id' | 'createdAt' | 'updatedAt'>>): Observable<CodingJob> {
    return this.codingFacade.updateCodingJob(workspaceId, codingJobId, codingJob);
  }

  deleteCodingJob(workspaceId: number, codingJobId: number): Observable<{ success: boolean }> {
    return this.codingFacade.deleteCodingJob(workspaceId, codingJobId);
  }

  startCodingJob(workspaceId: number, codingJobId: number): Observable<{ total: number; items: CodingJobItem[] }> {
    return this.codingFacade.startCodingJob(workspaceId, codingJobId);
  }

  getAppliedResultsCount(workspaceId: number, incompleteVariables: { unitName: string; variableId: string }[]): Observable<number> {
    return this.codingFacade.getAppliedResultsCount(workspaceId, incompleteVariables);
  }

  getCodingIncompleteVariables(workspaceId: number, unitName?: string): Observable<{ unitName: string; variableId: string; responseCount: number }[]> {
    return this.codingFacade.getCodingIncompleteVariables(workspaceId, unitName);
  }

  createCoderTrainingJobs(workspaceId: number, selectedCoders: { id: number; name: string }[], variableConfigs: { variableId: string; unitId: string; sampleCount: number }[], trainingLabel: string, missingsProfileId?: number): Observable<CreateCoderTrainingJobsResponse> {
    return this.codingFacade.createCoderTrainingJobs(workspaceId, selectedCoders, variableConfigs, trainingLabel, missingsProfileId);
  }

  getCoderTrainings(workspaceId: number): Observable<CoderTraining[]> {
    return this.codingFacade.getCoderTrainings(workspaceId);
  }

  updateCoderTrainingLabel(workspaceId: number, trainingId: number, newLabel: string): Observable<{ success: boolean; message: string }> {
    return this.codingFacade.updateCoderTrainingLabel(workspaceId, trainingId, newLabel);
  }

  deleteCoderTraining(workspaceId: number, trainingId: number): Observable<{ success: boolean; message: string }> {
    return this.codingFacade.deleteCoderTraining(workspaceId, trainingId);
  }

  compareTrainingCodingResults(workspaceId: number, trainingIds: string): Observable<TrainingCodingResult[]> {
    return this.codingFacade.compareTrainingCodingResults(workspaceId, trainingIds);
  }

  compareWithinTrainingCodingResults(workspaceId: number, trainingId: number): Observable<WithinTrainingCodingResult[]> {
    return this.codingFacade.compareWithinTrainingCodingResults(workspaceId, trainingId);
  }

  getCodingJobsForTraining(workspaceId: number, trainingId: number): Observable<CodingJobForTraining[]> {
    return this.codingFacade.getCodingJobsForTraining(workspaceId, trainingId);
  }

  downloadWorkspaceFilesAsZip(workspaceId: number, fileTypes?: string[]): Observable<Blob> {
    return this.workspaceFacade.downloadWorkspaceFilesAsZip(workspaceId, fileTypes);
  }

  saveCodingProgress(workspaceId: number, codingJobId: number, progressData: { testPerson: string; unitId: string; variableId: string; selectedCode: { id: number; code: string; label: string; [key: string]: unknown }; isOpen?: boolean; notes?: string }): Observable<CodingJob> {
    return this.codingFacade.saveCodingProgress(workspaceId, codingJobId, progressData);
  }

  restartCodingJobWithOpenUnits(workspaceId: number, codingJobId: number): Observable<CodingJob> {
    return this.codingFacade.restartCodingJobWithOpenUnits(workspaceId, codingJobId);
  }

  getCodingProgress(workspaceId: number, codingJobId: number): Observable<Record<string, unknown>> {
    return this.codingFacade.getCodingProgress(workspaceId, codingJobId);
  }

  getBulkCodingProgress(workspaceId: number, jobIds: number[]): Observable<Record<number, Record<string, unknown>>> {
    return this.codingFacade.getBulkCodingProgress(workspaceId, jobIds);
  }

  getCodingNotes(workspaceId: number, codingJobId: number): Observable<Record<string, string> | null> {
    return this.codingFacade.getCodingNotes(workspaceId, codingJobId);
  }

  getCodingJobUnits(workspaceId: number, codingJobId: number): Observable<Array<{ responseId: number; unitName: string; unitAlias: string | null; variableId: string; variableAnchor: string; bookletName: string; personLogin: string; personCode: string; personGroup: string }>> {
    return this.codingFacade.getCodingJobUnits(workspaceId, codingJobId);
  }

  applyCodingResults(workspaceId: number, codingJobId: number): Observable<{ success: boolean; updatedResponsesCount: number; skippedReviewCount: number; messageKey: string; messageParams?: Record<string, unknown> }> {
    return this.codingFacade.applyCodingResults(workspaceId, codingJobId);
  }

  bulkApplyCodingResults(workspaceId: number): Observable<BulkApplyCodingResultsResponse> {
    return this.codingFacade.bulkApplyCodingResults(workspaceId);
  }

  getUnitVariables(workspaceId: number): Observable<UnitVariableDetailsDto[]> {
    return this.workspaceFacade.getUnitVariables(workspaceId);
  }

  createJobDefinition(workspaceId: number, jobDefinition: JobDefinition): Observable<JobDefinition> {
    return this.codingFacade.createJobDefinition(workspaceId, jobDefinition);
  }

  updateJobDefinition(workspaceId: number, jobDefinitionId: number, jobDefinition: Partial<JobDefinition>): Observable<JobDefinition> {
    return this.codingFacade.updateJobDefinition(workspaceId, jobDefinitionId, jobDefinition);
  }

  approveJobDefinition(workspaceId: number, jobDefinitionId: number, status: 'pending_review' | 'approved'): Observable<JobDefinition> {
    return this.codingFacade.approveJobDefinition(workspaceId, jobDefinitionId, status);
  }

  getJobDefinitions(workspaceId: number): Observable<JobDefinition[]> {
    return this.codingFacade.getJobDefinitions(workspaceId);
  }

  deleteJobDefinition(workspaceId: number, jobDefinitionId: number): Observable<{ success: boolean; message: string }> {
    return this.codingFacade.deleteJobDefinition(workspaceId, jobDefinitionId);
  }

  startExportJob(workspaceId: number, exportConfig: CodingExportConfig): Observable<{ jobId: string; message: string }> {
    return this.codingFacade.startExportJob(workspaceId, exportConfig);
  }

  getExportJobStatus(workspaceId: number, jobId: string): Observable<ExportJobStatus> {
    return this.codingFacade.getExportJobStatus(workspaceId, jobId);
  }

  downloadExportFile(workspaceId: number, jobId: string): Observable<Blob> {
    return this.codingFacade.downloadExportFile(workspaceId, jobId);
  }

  cancelExportJob(workspaceId: number, jobId: string): Observable<{ success: boolean; message: string }> {
    return this.codingFacade.cancelExportJob(workspaceId, jobId);
  }

  getUnitContentXml(workspaceId: number, unitId: string): Observable<string | null> {
    return this.workspaceFacade.getUnitContentXml(workspaceId, unitId);
  }

  getTestTakerContentXml(workspaceId: number, testTakerId: string): Observable<string | null> {
    return this.workspaceFacade.getTestTakerContentXml(workspaceId, testTakerId);
  }

  getCodingSchemeFile(workspaceId: number, codingSchemeRef: string): Observable<FileDownloadDto | null> {
    return this.workspaceFacade.getCodingSchemeFile(workspaceId, codingSchemeRef);
  }

  getUnitsWithFileIds(workspaceId: number): Observable<{ id: number; unitId: string; fileName: string; data: string }[]> {
    return this.workspaceFacade.getUnitsWithFileIds(workspaceId);
  }

  getVariableInfoForScheme(workspaceId: number, schemeFileId: string): Observable<VariableInfo[]> {
    return this.workspaceFacade.getVariableInfoForScheme(workspaceId, schemeFileId);
  }

  getMissingsProfiles(workspaceId: number): Observable<{ label: string; id: number }[]> {
    return this.codingFacade.getMissingsProfiles(workspaceId);
  }

  getMissingsProfileDetails(workspaceId: number, id: string | number): Observable<MissingsProfilesDto | null> {
    return this.codingFacade.getMissingsProfileDetails(workspaceId, id);
  }

  createMissingsProfile(workspaceId: number, profile: MissingsProfilesDto): Observable<MissingsProfilesDto | null> {
    return this.codingFacade.createMissingsProfile(workspaceId, profile);
  }

  updateMissingsProfile(workspaceId: number, label: string, profile: MissingsProfilesDto): Observable<MissingsProfilesDto | null> {
    return this.codingFacade.updateMissingsProfile(workspaceId, label, profile);
  }

  deleteMissingsProfile(workspaceId: number, label: string): Observable<boolean> {
    return this.codingFacade.deleteMissingsProfile(workspaceId, label);
  }

  getCodingBook(workspaceId: number, missingsProfile: string, contentOptions: CodeBookContentSetting, unitList: number[]): Observable<Blob | null> {
    return this.codingFacade.getCodingBook(workspaceId, missingsProfile, contentOptions, unitList);
  }

  getVariableAnalysis(workspaceId: number, page: number = 1, limit: number = 100, unitId?: string, variableId?: string, derivation?: string): Observable<PaginatedResponse<VariableAnalysisItemDto>> {
    return this.codingFacade.getVariableAnalysis(workspaceId, page, limit, unitId, variableId, derivation);
  }

  createDistributedCodingJobs(workspaceId: number, selectedVariables: { unitName: string; variableId: string }[], selectedCoders: { id: number; name: string; username: string }[], doubleCodingAbsolute?: number, doubleCodingPercentage?: number, selectedVariableBundles?: { id: number; name: string; variables: { unitName: string; variableId: string }[] }[], caseOrderingMode?: 'continuous' | 'alternating', maxCodingCases?: number): Observable<{ success: boolean; jobsCreated: number; message: string; distribution: Record<string, Record<string, number>>; doubleCodingInfo: Record<string, { totalCases: number; doubleCodedCases: number; singleCodedCasesAssigned: number; doubleCodedCasesPerCoder: Record<string, number> }>; aggregationInfo: Record<string, { uniqueCases: number; totalResponses: number }>; matchingFlags: string[]; jobs: { coderId: number; coderName: string; variable: { unitName: string; variableId: string }; jobId: number; jobName: string; caseCount: number; }[]; }> {
    return this.codingFacade.createDistributedCodingJobs(workspaceId, selectedVariables, selectedCoders, doubleCodingAbsolute, doubleCodingPercentage, selectedVariableBundles, caseOrderingMode, maxCodingCases);
  }

  calculateDistribution(workspaceId: number, selectedVariables: { unitName: string; variableId: string }[], selectedCoders: { id: number; name: string; username: string }[], doubleCodingAbsolute?: number, doubleCodingPercentage?: number, selectedVariableBundles?: { id: number; name: string; variables: { unitName: string; variableId: string }[] }[], maxCodingCases?: number): Observable<{
    distribution: Record<string, Record<string, number>>;
    doubleCodingInfo: Record<string, { totalCases: number; doubleCodedCases: number; singleCodedCasesAssigned: number; doubleCodedCasesPerCoder: Record<string, number> }>;
    aggregationInfo: Record<string, { uniqueCases: number; totalResponses: number }>;
    matchingFlags: string[];
    warnings: Array<{ unitName: string; variableId: string; message: string; casesInJobs: number; availableCases: number }>;
  }> {
    return this.codingFacade.calculateDistribution(workspaceId, selectedVariables, selectedCoders, doubleCodingAbsolute, doubleCodingPercentage, selectedVariableBundles, maxCodingCases);
  }

  resetCodingVersion(workspaceId: number, version: 'v1' | 'v2' | 'v3', unitFilters?: string[], variableFilters?: string[]): Observable<{ affectedResponseCount: number; cascadeResetVersions: ('v2' | 'v3')[]; message: string }> {
    return this.codingFacade.resetCodingVersion(workspaceId, version, unitFilters, variableFilters);
  }

  deleteVariableAnalysisJob(workspaceId: number, jobId: number): Observable<JobCancelResult> {
    return this.codingFacade.deleteVariableAnalysisJob(workspaceId, jobId);
  }

  cancelVariableAnalysisJob(workspaceId: number, jobId: number): Observable<JobCancelResult> {
    return this.codingFacade.cancelVariableAnalysisJob(workspaceId, jobId);
  }

  getAllVariableAnalysisJobs(workspaceId: number): Observable<VariableAnalysisJobDto[]> {
    return this.codingFacade.getAllVariableAnalysisJobs(workspaceId);
  }

  createVariableAnalysisJob(workspaceId: number, unitId?: number, variableId?: string): Observable<VariableAnalysisJobDto> {
    return this.codingFacade.createVariableAnalysisJob(workspaceId, unitId, variableId);
  }

  getVariableAnalysisResults(workspaceId: number, jobId: number): Observable<VariableAnalysisResultDto> {
    return this.codingFacade.getVariableAnalysisResults(workspaceId, jobId);
  }

  createDummyTestTakerFile(workspaceId: number): Observable<boolean> {
    return this.workspaceFacade.createDummyTestTakerFile(workspaceId);
  }
}
