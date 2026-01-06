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
import { AppService } from './app.service';
import { TestGroupsInfoDto } from '../../../../../api-dto/files/test-groups-info.dto';
import { ResponseEntity } from '../shared/models/response-entity.model';
import { ServerResponse } from './authentication.service';
import { SERVER_URL } from '../injection-tokens';
import { FileService, BookletUnit } from './file.service';
import { CodingService } from './coding.service';
import { UnitTagService } from './unit-tag.service';
import { UnitNoteService } from './unit-note.service';
import { ResponseService } from './response.service';
import {
  TestResultService, PersonTestResult, UnitLogRow, BookletLogsForUnitResponse
} from './test-result.service';
import { ResourcePackageService } from './resource-package.service';
import { UnitService } from './unit.service';
import { ValidationService } from './validation.service';
import { ResponseDto } from '../../../../../api-dto/responses/response-dto';
import { UserBackendService } from './user-backend.service';
import { WorkspaceBackendService } from './workspace-backend.service';
import { ImportService, ImportOptions, Result } from './import.service';
import { VariableAnalysisService, VariableAnalysisResultDto, JobCancelResult } from './variable-analysis.service';
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
  CodingJobBackendService,
  JobDefinition,
  CodingExportConfig
} from './coding-job-backend.service';
import { ReplayBackendService, ReplayStatisticsResponse } from './replay-backend.service';
import { TestResultBackendService } from './test-result-backend.service';
import type { TestResultExportJob } from './test-result-backend.service';
import { CodingTrainingBackendService } from './coding-training-backend.service';
import type {
  CreateCoderTrainingJobsResponse,
  TrainingCodingResult,
  WithinTrainingCodingResult,
  CodingJobForTraining
} from './coding-training-backend.service';
import { FileBackendService } from './file-backend.service';
import { CoderTraining } from '../coding/models/coder-training.model';

interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export interface CodingJobItem {
  responseId: number;
  unitName: string;
  unitAlias: string | null;
  variableId: string;
  variableAnchor: string;
  bookletName: string;
  personLogin: string;
  personCode: string;
  personGroup: string;
  replayUrl: string;
}

export interface CodingJobStatus {
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'paused';
  progress: number;
  result?: {
    totalResponses: number;
    statusCounts: Record<string, number>;
  };
  error?: string;
}

export interface BulkApplyResultItem {
  jobId: number;
  jobName: string;
  hasIssues: boolean;
  skipped: boolean;
  result?: {
    success: boolean;
    updatedResponsesCount: number;
    skippedReviewCount: number;
    message: string;
  };
}

export interface BulkApplyCodingResultsResponse {
  success: boolean;
  jobsProcessed: number;
  totalUpdatedResponses: number;
  totalSkippedReview: number;
  message: string;
  results: BulkApplyResultItem[];
}

export interface ExportJobStatus {
  status: string;
  progress: number;
  result?: {
    fileId: string;
    fileName: string;
    filePath: string;
    fileSize: number;
    workspaceId: number;
    userId: number;
    exportType: string;
    createdAt: number;
  };
  error?: string;
}

export interface SearchResponsesParams {
  value?: string;
  variableId?: string;
  unitName?: string;
  bookletName?: string;
  status?: string;
  codedStatus?: string;
  group?: string;
  code?: string;
  version?: 'v1' | 'v2' | 'v3';
}

export interface SearchResponseItem {
  responseId: number;
  variableId: string;
  value: string;
  status: string;
  code?: number;
  score?: number;
  codedStatus?: string;
  unitId: number;
  unitName: string;
  unitAlias: string | null;
  bookletId: number;
  bookletName: string;
  personId: number;
  personLogin: string;
  personCode: string;
  personGroup: string;
  variablePage?: string;
}

export interface SearchBookletItem {
  bookletId: number;
  bookletName: string;
  personId: number;
  personLogin: string;
  personCode: string;
  personGroup: string;
  units: {
    unitId: number;
    unitName: string;
    unitAlias: string | null;
  }[];
}

export interface SearchUnitItem {
  unitId: number;
  unitName: string;
  unitAlias: string | null;
  bookletId: number;
  bookletName: string;
  personId: number;
  personLogin: string;
  personCode: string;
  personGroup: string;
  tags: {
    id: number;
    unitId: number;
    tag: string;
    color?: string;
    createdAt: Date;
  }[];
  responses: {
    variableId: string;
    value: string;
    status: string;
    code?: number;
    score?: number;
    codedStatus?: string;
  }[];
}

@Injectable({
  providedIn: 'root'
})
export class BackendService {
  readonly serverUrl = inject(SERVER_URL);
  appService = inject(AppService);

  private fileService = inject(FileService);
  private codingService = inject(CodingService);
  private unitTagService = inject(UnitTagService);
  private unitNoteService = inject(UnitNoteService);
  private responseService = inject(ResponseService);
  private testResultService = inject(TestResultService);
  private resourcePackageService = inject(ResourcePackageService);
  private unitService = inject(UnitService);
  private validationService = inject(ValidationService);
  private importService = inject(ImportService);
  private variableAnalysisService = inject(VariableAnalysisService);

  private userBackendService = inject(UserBackendService);
  private workspaceBackendService = inject(WorkspaceBackendService);
  private codingJobBackendService = inject(CodingJobBackendService);
  private replayBackendService = inject(ReplayBackendService);
  private testResultBackendService = inject(TestResultBackendService);
  private codingTrainingBackendService = inject(CodingTrainingBackendService);
  private fileBackendService = inject(FileBackendService);

  getDirectDownloadLink(): string {
    return this.fileService.getDirectDownloadLink();
  }

  getUsers(workspaceId: number): Observable<UserInListDto[]> {
    return this.userBackendService.getUsers(workspaceId);
  }

  saveUsers(workspaceId: number, users: UserWorkspaceAccessDto[]): Observable<UserWorkspaceAccessDto[]> {
    return this.userBackendService.saveUsers(workspaceId, users);
  }

  getUsersFull(): Observable<UserFullDto[]> {
    return this.userBackendService.getUsersFull();
  }

  addUser(newUser: CreateUserDto): Observable<boolean> {
    return this.userBackendService.addUser(newUser);
  }

  changeUserData(userId: number, newData: UserFullDto): Observable<boolean> {
    return this.userBackendService.changeUserData(userId, newData);
  }

  deleteUsers(users: number[]): Observable<boolean> {
    return this.userBackendService.deleteUsers(users);
  }

  getAllWorkspacesList(): Observable<PaginatedWorkspacesDto> {
    return this.workspaceBackendService.getAllWorkspacesList();
  }

  getWorkspacesByUserList(userId: number): Observable<number[]> {
    return this.userBackendService.getWorkspacesByUserList(userId);
  }

  getWorkspaceUsers(workspaceId: number): Observable<PaginatedWorkspaceUserDto> {
    return this.workspaceBackendService.getWorkspaceUsers(workspaceId);
  }

  addWorkspace(workspaceData: CreateWorkspaceDto): Observable<boolean> {
    return this.workspaceBackendService.addWorkspace(workspaceData);
  }

  deleteWorkspace(ids: number[]): Observable<boolean> {
    return this.workspaceBackendService.deleteWorkspace(ids);
  }

  changeWorkspace(workspaceData: WorkspaceFullDto): Observable<boolean> {
    return this.workspaceBackendService.changeWorkspace(workspaceData);
  }

  setWorkspaceUsersAccessRight(workspaceId: number, userIds: number[]): Observable<boolean> {
    return this.workspaceBackendService.setWorkspaceUsersAccessRight(workspaceId, userIds);
  }

  setUserWorkspaceAccessRight(userId: number, workspaceIds: number[]): Observable<boolean> {
    return this.userBackendService.setUserWorkspaceAccessRight(userId, workspaceIds);
  }

  createUnitTag(workspaceId: number, unitTag: CreateUnitTagDto): Observable<UnitTagDto> {
    return this.unitTagService.createUnitTag(workspaceId, unitTag);
  }

  deleteUnitTag(workspaceId: number, tagId: number): Observable<boolean> {
    return this.unitTagService.deleteUnitTag(workspaceId, tagId);
  }

  createUnitNote(workspaceId: number, unitNote: CreateUnitNoteDto): Observable<UnitNoteDto> {
    return this.unitNoteService.createUnitNote(workspaceId, unitNote);
  }

  getUnitNotes(workspaceId: number, unitId: number): Observable<UnitNoteDto[]> {
    return this.unitNoteService.getUnitNotes(workspaceId, unitId);
  }

  deleteUnitNote(workspaceId: number, noteId: number): Observable<boolean> {
    return this.unitNoteService.deleteUnitNote(workspaceId, noteId);
  }

  deleteFiles(workspaceId: number, fileIds: number[]): Observable<boolean> {
    return this.fileService.deleteFiles(workspaceId, fileIds);
  }

  downloadFile(workspaceId: number, fileId: number): Observable<FileDownloadDto> {
    return this.fileService.downloadFile(workspaceId, fileId);
  }

  validateFiles(workspaceId: number): Observable<boolean | FileValidationResultDto> {
    return this.fileService.validateFiles(workspaceId);
  }

  uploadTestFiles(workspaceId: number, files: FileList | FormData | null, overwriteExisting: boolean = false, overwriteFileIds?: string[]): Observable<TestFilesUploadResultDto> {
    return this.fileService.uploadTestFiles(workspaceId, files, overwriteExisting, overwriteFileIds);
  }

  uploadTestResults(workspaceId: number, files: FileList | null, resultType: 'logs' | 'responses', overwriteExisting: boolean = true, overwriteMode: 'skip' | 'merge' | 'replace' = 'skip', scope: string = 'person', filters?: Record<string, unknown>): Observable<TestResultsUploadResultDto> {
    return this.fileService.uploadTestResults(workspaceId, files, resultType, overwriteExisting, overwriteMode, scope, filters);
  }

  getFilesList(workspaceId: number, page: number = 1, limit: number = 10000, fileType?: string, fileSize?: string, searchText?: string): Observable<PaginatedResponse<FilesInListDto> & { fileTypes: string[] }> {
    return this.fileService.getFilesList(workspaceId, page, limit, fileType, fileSize, searchText);
  }

  getUnitDef(workspaceId: number, unit: string, authToken?: string): Observable<FilesDto[]> {
    return this.fileService.getUnitDef(workspaceId, unit, authToken);
  }

  getPlayer(workspaceId: number, player: string, authToken?: string): Observable<FilesDto[]> {
    return this.fileService.getPlayer(workspaceId, player, authToken);
  }

  getUnit(workspaceId: number, unitId: string, authToken?: string): Observable<FilesDto[]> {
    return this.fileService.getUnit(workspaceId, unitId, authToken);
  }

  getVocs(workspaceId: number, vocs: string): Observable<FilesDto[]> {
    return this.fileBackendService.getVocs(workspaceId, vocs);
  }

  getBookletUnits(workspaceId: number, bookletId: string, authToken?: string): Observable<BookletUnit[]> {
    return this.fileService.getBookletUnits(workspaceId, bookletId, authToken);
  }

  getBookletInfo(workspaceId: number, bookletId: string, authToken?: string): Observable<BookletInfoDto> {
    return this.fileService.getBookletInfo(workspaceId, bookletId, authToken);
  }

  getUnitInfo(workspaceId: number, unitId: string, authToken?: string): Observable<UnitInfoDto> {
    return this.fileService.getUnitInfo(workspaceId, unitId, authToken);
  }

  getResponsesForUnit(workspaceId: number, testPerson: string, unitId: string, authToken?: string): Observable<ResponseDto[]> {
    return this.responseService.getResponses(workspaceId, testPerson, unitId, authToken);
  }

  deleteResponse(workspaceId: number, responseId: number): Observable<{ success: boolean; report: { deletedResponse: number | null; warnings: string[] } }> {
    return this.responseService.deleteResponse(workspaceId, responseId);
  }

  searchResponses(
    workspaceId: number,
    searchParams: SearchResponsesParams,
    page?: number,
    limit?: number
  ): Observable<{ data: SearchResponseItem[]; total: number }> {
    return this.responseService.searchResponses(workspaceId, searchParams, page, limit);
  }

  getTestPersons(workspaceId: number): Observable<number[]> {
    return this.testResultService.getTestPersons(workspaceId);
  }

  deleteTestPersons(workspaceId: number, testPersonIds: number[]): Observable<boolean> {
    return this.responseService.deleteTestPersons(workspaceId, testPersonIds);
  }

  getResourcePackages(workspaceId: number): Observable<ResourcePackageDto[]> {
    return this.resourcePackageService.getResourcePackages(workspaceId);
  }

  uploadResourcePackage(workspaceId: number, file: File): Observable<number> {
    return this.resourcePackageService.uploadResourcePackage(workspaceId, file);
  }

  deleteResourcePackages(workspaceId: number, ids: number[]): Observable<boolean> {
    return this.resourcePackageService.deleteResourcePackages(workspaceId, ids);
  }

  downloadResourcePackage(workspaceId: number, name: string): Observable<Blob> {
    return this.resourcePackageService.downloadResourcePackage(workspaceId, name);
  }

  createDeleteAllResponsesTask(workspaceId: number, validationType: 'variables' | 'variableTypes' | 'responseStatus' | 'duplicateResponses'): Observable<ValidationTaskDto> {
    return this.validationService.createDeleteAllResponsesTask(workspaceId, validationType);
  }

  createDeleteResponsesTask(workspaceId: number, responseIds: number[]): Observable<ValidationTaskDto> {
    return this.validationService.createDeleteResponsesTask(workspaceId, responseIds);
  }

  createValidationTask(workspaceId: number, type: 'variables' | 'variableTypes' | 'responseStatus' | 'testTakers' | 'groupResponses' | 'deleteResponses' | 'deleteAllResponses' | 'duplicateResponses', page?: number, limit?: number, additionalData?: Record<string, unknown>): Observable<ValidationTaskDto> {
    return this.validationService.createValidationTask(workspaceId, type, page, limit, additionalData);
  }

  getValidationTask(workspaceId: number, taskId: number): Observable<ValidationTaskDto> {
    return this.validationService.getValidationTask(workspaceId, taskId);
  }

  getValidationResults(workspaceId: number, taskId: number): Observable<unknown> {
    return this.validationService.getValidationResults(workspaceId, taskId);
  }

  pollValidationTask(workspaceId: number, taskId: number, pollInterval: number = 2000): Observable<ValidationTaskDto> {
    return this.validationService.pollValidationTask(workspaceId, taskId, pollInterval);
  }

  getUnitLogs(workspaceId: number, unitId: number): Observable<UnitLogRow[]> {
    return this.testResultService.getUnitLogs(workspaceId, unitId);
  }

  getNotesForMultipleUnits(workspaceId: number, unitIds: number[]): Observable<{ [unitId: number]: UnitNoteDto[] }> {
    return this.unitNoteService.getNotesForMultipleUnits(workspaceId, unitIds);
  }

  getBookletLogsForUnit(workspaceId: number, unitId: number): Observable<BookletLogsForUnitResponse | null> {
    return this.testResultService.getBookletLogsForUnit(workspaceId, unitId);
  }

  getExportOptions(workspaceId: number) {
    return this.testResultBackendService.getExportOptions(workspaceId);
  }

  startExportTestResultsJob(workspaceId: number, filters?: Record<string, unknown>): Observable<{ jobId: string; message: string }> {
    return this.testResultBackendService.startExportTestResultsJob(workspaceId, filters);
  }

  startExportTestLogsJob(workspaceId: number, filters?: Record<string, unknown>): Observable<{ jobId: string; message: string }> {
    return this.testResultBackendService.startExportTestLogsJob(workspaceId, filters);
  }

  getExportTestResultsJobs(workspaceId: number): Observable<TestResultExportJob[]> {
    return this.testResultBackendService.getExportTestResultsJobs(workspaceId);
  }

  downloadExportTestResultsJob(workspaceId: number, jobId: string): Observable<Blob> {
    return this.testResultBackendService.downloadExportTestResultsJob(workspaceId, jobId);
  }

  deleteTestResultExportJob(workspaceId: number, jobId: string): Observable<{ success: boolean; message: string }> {
    return this.testResultBackendService.deleteTestResultExportJob(workspaceId, jobId);
  }

  getPersonTestResults(workspaceId: number, personId: number): Observable<PersonTestResult[]> {
    return this.testResultService.getPersonTestResults(workspaceId, personId);
  }

  getCodingJobStatus(workspaceId: number, jobId: string): Observable<CodingJobStatus> {
    return this.codingService.getCodingJobStatus(workspaceId, jobId);
  }

  getCodingListAsCsv(workspaceId: number): Observable<Blob> {
    return this.codingService.getCodingListAsCsv(workspaceId);
  }

  getCodingListAsExcel(workspaceId: number): Observable<Blob> {
    return this.codingService.getCodingListAsExcel(workspaceId);
  }

  getCodingResultsByVersion(workspaceId: number, version: 'v1' | 'v2' | 'v3', includeReplayUrls: boolean = false): Observable<Blob> {
    return this.codingService.getCodingResultsByVersion(workspaceId, version, includeReplayUrls);
  }

  getCodingResultsByVersionAsExcel(workspaceId: number, version: 'v1' | 'v2' | 'v3', includeReplayUrls: boolean = false): Observable<Blob> {
    return this.codingService.getCodingResultsByVersionAsExcel(workspaceId, version, includeReplayUrls);
  }

  getCodingStatistics(workspaceId: number, version: 'v1' | 'v2' | 'v3' = 'v1'): Observable<CodingStatistics> {
    return this.codingService.getCodingStatistics(workspaceId, version);
  }

  createCodingStatisticsJob(workspaceId: number): Observable<{ jobId: string; message: string }> {
    return this.codingService.createCodingStatisticsJob(workspaceId);
  }

  getResponsesByStatus(workspaceId: number, status: string, version: 'v1' | 'v2' | 'v3' = 'v1', page: number = 1, limit: number = 100): Observable<PaginatedResponse<ResponseEntity>> {
    return this.codingService.getResponsesByStatus(workspaceId, status, version, page, limit);
  }

  getReplayUrl(workspaceId: number, responseId: number, authToken: string): Observable<{ replayUrl: string }> {
    return this.codingService.getReplayUrl(workspaceId, responseId, authToken);
  }

  searchBookletsByName(workspaceId: number, bookletName: string, page?: number, limit?: number): Observable<{ data: SearchBookletItem[]; total: number }> {
    return this.testResultService.searchBookletsByName(workspaceId, bookletName, page, limit);
  }

  searchUnitsByName(workspaceId: number, unitName: string, page?: number, limit?: number): Observable<{ data: SearchUnitItem[]; total: number }> {
    return this.testResultService.searchUnitsByName(workspaceId, unitName, page, limit);
  }

  deleteUnit(workspaceId: number, unitId: number): Observable<{ success: boolean; report: { deletedUnit: number | null; warnings: string[] } }> {
    return this.unitService.deleteUnit(workspaceId, unitId);
  }

  deleteMultipleUnits(workspaceId: number, unitIds: number[]): Observable<{ success: boolean; report: { deletedUnits: number[]; warnings: string[] } }> {
    return this.unitService.deleteMultipleUnits(workspaceId, unitIds);
  }

  deleteBooklet(workspaceId: number, bookletId: number): Observable<{ success: boolean; report: { deletedBooklet: number | null; warnings: string[] } }> {
    return this.testResultService.deleteBooklet(workspaceId, bookletId);
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
    return this.importService.importWorkspaceFiles(
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
    return this.importService.importTestcenterGroups(
      workspaceId,
      testCenterWorkspace,
      server,
      url,
      authToken
    );
  }

  authenticate(username: string, password: string, server: string, url: string): Observable<ServerResponse> {
    return this.userBackendService.authenticate(username, password, server, url);
  }

  storeReplayStatistics(workspaceId: number, data: { unitId: string; bookletId?: string; testPersonLogin?: string; testPersonCode?: string; durationMilliseconds: number; replayUrl?: string; success?: boolean; errorMessage?: string }): Observable<ReplayStatisticsResponse> {
    return this.replayBackendService.storeReplayStatistics(workspaceId, data);
  }

  getReplayFrequencyByUnit(workspaceId: number, options?: Record<string, unknown>): Observable<Record<string, number>> {
    return this.replayBackendService.getReplayFrequencyByUnit(workspaceId, options);
  }

  getReplayDurationStatistics(workspaceId: number, unitId?: string, options?: Record<string, unknown>): Observable<{ min: number; max: number; average: number; distribution: Record<string, number>; unitAverages?: Record<string, number>; }> {
    return this.replayBackendService.getReplayDurationStatistics(workspaceId, unitId, options);
  }

  getReplayDistributionByDay(workspaceId: number, options?: Record<string, unknown>): Observable<Record<string, number>> {
    return this.replayBackendService.getReplayDistributionByDay(workspaceId, options);
  }

  getReplayDistributionByHour(workspaceId: number, options?: Record<string, unknown>): Observable<Record<string, number>> {
    return this.replayBackendService.getReplayDistributionByHour(workspaceId, options);
  }

  getReplayErrorStatistics(workspaceId: number, options?: Record<string, unknown>): Observable<{ successRate: number; totalReplays: number; successfulReplays: number; failedReplays: number; commonErrors: Array<{ message: string; count: number }>; }> {
    return this.replayBackendService.getReplayErrorStatistics(workspaceId, options);
  }

  getFailureDistributionByUnit(workspaceId: number, options?: Record<string, unknown>): Observable<Record<string, number>> {
    return this.replayBackendService.getFailureDistributionByUnit(workspaceId, options);
  }

  getFailureDistributionByDay(workspaceId: number, options?: Record<string, unknown>): Observable<Record<string, number>> {
    return this.replayBackendService.getFailureDistributionByDay(workspaceId, options);
  }

  getFailureDistributionByHour(workspaceId: number, options?: Record<string, unknown>): Observable<Record<string, number>> {
    return this.replayBackendService.getFailureDistributionByHour(workspaceId, options);
  }

  getVariableBundles(workspaceId: number): Observable<VariableBundle[]> {
    return this.codingJobBackendService.getVariableBundles(workspaceId);
  }

  getCodingJobs(workspaceId: number, page?: number, limit?: number): Observable<PaginatedResponse<CodingJob>> {
    return this.codingJobBackendService.getCodingJobs(workspaceId, page, limit);
  }

  getCodingJob(workspaceId: number, codingJobId: number): Observable<CodingJob> {
    return this.codingJobBackendService.getCodingJob(workspaceId, codingJobId);
  }

  createCodingJob(workspaceId: number, codingJob: Omit<CodingJob, 'id' | 'createdAt' | 'updatedAt'>): Observable<CodingJob> {
    return this.codingJobBackendService.createCodingJob(workspaceId, codingJob);
  }

  updateCodingJob(workspaceId: number, codingJobId: number, codingJob: Partial<Omit<CodingJob, 'id' | 'createdAt' | 'updatedAt'>>): Observable<CodingJob> {
    return this.codingJobBackendService.updateCodingJob(workspaceId, codingJobId, codingJob);
  }

  deleteCodingJob(workspaceId: number, codingJobId: number): Observable<{ success: boolean }> {
    return this.codingJobBackendService.deleteCodingJob(workspaceId, codingJobId);
  }

  startCodingJob(workspaceId: number, codingJobId: number): Observable<{ total: number; items: CodingJobItem[] }> {
    return this.codingJobBackendService.startCodingJob(workspaceId, codingJobId);
  }

  getAppliedResultsCount(workspaceId: number, incompleteVariables: { unitName: string; variableId: string }[]): Observable<number> {
    return this.codingJobBackendService.getAppliedResultsCount(workspaceId, incompleteVariables);
  }

  getCodingIncompleteVariables(workspaceId: number, unitName?: string): Observable<{ unitName: string; variableId: string; responseCount: number }[]> {
    return this.codingJobBackendService.getCodingIncompleteVariables(workspaceId, unitName);
  }

  createCoderTrainingJobs(workspaceId: number, selectedCoders: { id: number; name: string }[], variableConfigs: { variableId: string; unitId: string; sampleCount: number }[], trainingLabel: string, missingsProfileId?: number): Observable<CreateCoderTrainingJobsResponse> {
    return this.codingTrainingBackendService.createCoderTrainingJobs(workspaceId, selectedCoders, variableConfigs, trainingLabel, missingsProfileId);
  }

  getCoderTrainings(workspaceId: number): Observable<CoderTraining[]> {
    return this.codingTrainingBackendService.getCoderTrainings(workspaceId);
  }

  updateCoderTrainingLabel(workspaceId: number, trainingId: number, newLabel: string): Observable<{ success: boolean; message: string }> {
    return this.codingTrainingBackendService.updateCoderTrainingLabel(workspaceId, trainingId, newLabel);
  }

  deleteCoderTraining(workspaceId: number, trainingId: number): Observable<{ success: boolean; message: string }> {
    return this.codingTrainingBackendService.deleteCoderTraining(workspaceId, trainingId);
  }

  compareTrainingCodingResults(workspaceId: number, trainingIds: string): Observable<TrainingCodingResult[]> {
    return this.codingTrainingBackendService.compareTrainingCodingResults(workspaceId, trainingIds);
  }

  compareWithinTrainingCodingResults(workspaceId: number, trainingId: number): Observable<WithinTrainingCodingResult[]> {
    return this.codingTrainingBackendService.compareWithinTrainingCodingResults(workspaceId, trainingId);
  }

  getCodingJobsForTraining(workspaceId: number, trainingId: number): Observable<CodingJobForTraining[]> {
    return this.codingTrainingBackendService.getCodingJobsForTraining(workspaceId, trainingId);
  }

  downloadWorkspaceFilesAsZip(workspaceId: number, fileTypes?: string[]): Observable<Blob> {
    return this.fileBackendService.downloadWorkspaceFilesAsZip(workspaceId, fileTypes);
  }

  saveCodingProgress(workspaceId: number, codingJobId: number, progressData: { testPerson: string; unitId: string; variableId: string; selectedCode: { id: number; code: string; label: string; [key: string]: unknown }; isOpen?: boolean; notes?: string }): Observable<CodingJob> {
    return this.codingJobBackendService.saveCodingProgress(workspaceId, codingJobId, progressData);
  }

  restartCodingJobWithOpenUnits(workspaceId: number, codingJobId: number): Observable<CodingJob> {
    return this.codingJobBackendService.restartCodingJobWithOpenUnits(workspaceId, codingJobId);
  }

  getCodingProgress(workspaceId: number, codingJobId: number): Observable<Record<string, unknown>> {
    return this.codingJobBackendService.getCodingProgress(workspaceId, codingJobId);
  }

  getBulkCodingProgress(workspaceId: number, jobIds: number[]): Observable<Record<number, Record<string, unknown>>> {
    return this.codingJobBackendService.getBulkCodingProgress(workspaceId, jobIds);
  }

  getCodingNotes(workspaceId: number, codingJobId: number): Observable<Record<string, string> | null> {
    return this.codingJobBackendService.getCodingNotes(workspaceId, codingJobId);
  }

  getCodingJobUnits(workspaceId: number, codingJobId: number): Observable<Array<{ responseId: number; unitName: string; unitAlias: string | null; variableId: string; variableAnchor: string; bookletName: string; personLogin: string; personCode: string; personGroup: string }>> {
    return this.codingJobBackendService.getCodingJobUnits(workspaceId, codingJobId);
  }

  applyCodingResults(workspaceId: number, codingJobId: number): Observable<{ success: boolean; updatedResponsesCount: number; skippedReviewCount: number; messageKey: string; messageParams?: Record<string, unknown> }> {
    return this.codingJobBackendService.applyCodingResults(workspaceId, codingJobId);
  }

  bulkApplyCodingResults(workspaceId: number): Observable<BulkApplyCodingResultsResponse> {
    return this.codingJobBackendService.bulkApplyCodingResults(workspaceId);
  }

  getUnitVariables(workspaceId: number): Observable<UnitVariableDetailsDto[]> {
    return this.fileBackendService.getUnitVariables(workspaceId);
  }

  createJobDefinition(workspaceId: number, jobDefinition: JobDefinition): Observable<JobDefinition> {
    return this.codingJobBackendService.createJobDefinition(workspaceId, jobDefinition);
  }

  updateJobDefinition(workspaceId: number, jobDefinitionId: number, jobDefinition: Partial<JobDefinition>): Observable<JobDefinition> {
    return this.codingJobBackendService.updateJobDefinition(workspaceId, jobDefinitionId, jobDefinition);
  }

  approveJobDefinition(workspaceId: number, jobDefinitionId: number, status: 'pending_review' | 'approved'): Observable<JobDefinition> {
    return this.codingJobBackendService.approveJobDefinition(workspaceId, jobDefinitionId, status);
  }

  getJobDefinitions(workspaceId: number): Observable<JobDefinition[]> {
    return this.codingJobBackendService.getJobDefinitions(workspaceId);
  }

  deleteJobDefinition(workspaceId: number, jobDefinitionId: number): Observable<{ success: boolean; message: string }> {
    return this.codingJobBackendService.deleteJobDefinition(workspaceId, jobDefinitionId);
  }

  startExportJob(workspaceId: number, exportConfig: CodingExportConfig): Observable<{ jobId: string; message: string }> {
    return this.codingJobBackendService.startExportJob(workspaceId, exportConfig);
  }

  getExportJobStatus(workspaceId: number, jobId: string): Observable<ExportJobStatus> {
    return this.codingJobBackendService.getExportJobStatus(workspaceId, jobId);
  }

  downloadExportFile(workspaceId: number, jobId: string): Observable<Blob> {
    return this.codingJobBackendService.downloadExportFile(workspaceId, jobId);
  }

  cancelExportJob(workspaceId: number, jobId: string): Observable<{ success: boolean; message: string }> {
    return this.codingJobBackendService.cancelExportJob(workspaceId, jobId);
  }

  getUnitContentXml(workspaceId: number, unitId: string): Observable<string | null> {
    return this.fileService.getUnitContentXml(workspaceId, unitId);
  }

  getTestTakerContentXml(workspaceId: number, testTakerId: string): Observable<string | null> {
    return this.fileService.getTestTakerContentXml(workspaceId, testTakerId);
  }

  getCodingSchemeFile(workspaceId: number, codingSchemeRef: string): Observable<FileDownloadDto | null> {
    return this.fileService.getCodingSchemeFile(workspaceId, codingSchemeRef);
  }

  getUnitsWithFileIds(workspaceId: number): Observable<{ id: number; unitId: string; fileName: string; data: string }[]> {
    return this.fileService.getUnitsWithFileIds(workspaceId);
  }

  getVariableInfoForScheme(workspaceId: number, schemeFileId: string): Observable<VariableInfo[]> {
    return this.fileService.getVariableInfoForScheme(workspaceId, schemeFileId);
  }

  getMissingsProfiles(workspaceId: number): Observable<{ label: string; id: number }[]> {
    return this.codingService.getMissingsProfiles(workspaceId);
  }

  getMissingsProfileDetails(workspaceId: number, id: string | number): Observable<MissingsProfilesDto | null> {
    return this.codingService.getMissingsProfileDetails(workspaceId, id);
  }

  createMissingsProfile(workspaceId: number, profile: MissingsProfilesDto): Observable<MissingsProfilesDto | null> {
    return this.codingService.createMissingsProfile(workspaceId, profile);
  }

  updateMissingsProfile(workspaceId: number, label: string, profile: MissingsProfilesDto): Observable<MissingsProfilesDto | null> {
    return this.codingService.updateMissingsProfile(workspaceId, label, profile);
  }

  deleteMissingsProfile(workspaceId: number, label: string): Observable<boolean> {
    return this.codingService.deleteMissingsProfile(workspaceId, label);
  }

  getCodingBook(workspaceId: number, missingsProfile: string, contentOptions: CodeBookContentSetting, unitList: number[]): Observable<Blob | null> {
    return this.codingService.getCodingBook(workspaceId, missingsProfile, contentOptions, unitList);
  }

  getVariableAnalysis(workspaceId: number, page: number = 1, limit: number = 100, unitId?: string, variableId?: string, derivation?: string): Observable<PaginatedResponse<VariableAnalysisItemDto>> {
    return this.codingService.getVariableAnalysis(workspaceId, page, limit, unitId, variableId, derivation);
  }

  createDistributedCodingJobs(workspaceId: number, selectedVariables: { unitName: string; variableId: string }[], selectedCoders: { id: number; name: string; username: string }[], doubleCodingAbsolute?: number, doubleCodingPercentage?: number, selectedVariableBundles?: { id: number; name: string; variables: { unitName: string; variableId: string }[] }[], caseOrderingMode?: 'continuous' | 'alternating', maxCodingCases?: number): Observable<{ success: boolean; jobsCreated: number; message: string; distribution: Record<string, Record<string, number>>; doubleCodingInfo: Record<string, { totalCases: number; doubleCodedCases: number; singleCodedCasesAssigned: number; doubleCodedCasesPerCoder: Record<string, number> }>; aggregationInfo: Record<string, { uniqueCases: number; totalResponses: number }>; matchingFlags: string[]; jobs: { coderId: number; coderName: string; variable: { unitName: string; variableId: string }; jobId: number; jobName: string; caseCount: number; }[]; }> {
    return this.codingService.createDistributedCodingJobs(workspaceId, selectedVariables, selectedCoders, doubleCodingAbsolute, doubleCodingPercentage, selectedVariableBundles, caseOrderingMode, maxCodingCases);
  }

  calculateDistribution(workspaceId: number, selectedVariables: { unitName: string; variableId: string }[], selectedCoders: { id: number; name: string; username: string }[], doubleCodingAbsolute?: number, doubleCodingPercentage?: number, selectedVariableBundles?: { id: number; name: string; variables: { unitName: string; variableId: string }[] }[], maxCodingCases?: number): Observable<{
    distribution: Record<string, Record<string, number>>;
    doubleCodingInfo: Record<string, { totalCases: number; doubleCodedCases: number; singleCodedCasesAssigned: number; doubleCodedCasesPerCoder: Record<string, number> }>;
    aggregationInfo: Record<string, { uniqueCases: number; totalResponses: number }>;
    matchingFlags: string[];
    warnings: Array<{ unitName: string; variableId: string; message: string; casesInJobs: number; availableCases: number }>;
  }> {
    return this.codingService.calculateDistribution(workspaceId, selectedVariables, selectedCoders, doubleCodingAbsolute, doubleCodingPercentage, selectedVariableBundles, maxCodingCases);
  }

  resetCodingVersion(workspaceId: number, version: 'v1' | 'v2' | 'v3', unitFilters?: string[], variableFilters?: string[]): Observable<{ affectedResponseCount: number; cascadeResetVersions: ('v2' | 'v3')[]; message: string }> {
    return this.codingService.resetCodingVersion(workspaceId, version, unitFilters, variableFilters);
  }

  deleteVariableAnalysisJob(workspaceId: number, jobId: number): Observable<JobCancelResult> {
    return this.variableAnalysisService.deleteJob(workspaceId, jobId);
  }

  cancelVariableAnalysisJob(workspaceId: number, jobId: number): Observable<JobCancelResult> {
    return this.variableAnalysisService.cancelJob(workspaceId, jobId);
  }

  getAllVariableAnalysisJobs(workspaceId: number): Observable<VariableAnalysisJobDto[]> {
    return this.variableAnalysisService.getAllJobs(workspaceId);
  }

  createVariableAnalysisJob(workspaceId: number, unitId?: number, variableId?: string): Observable<VariableAnalysisJobDto> {
    return this.variableAnalysisService.createAnalysisJob(workspaceId, unitId, variableId);
  }

  getVariableAnalysisResults(workspaceId: number, jobId: number): Observable<VariableAnalysisResultDto> {
    return this.variableAnalysisService.getAnalysisResults(workspaceId, jobId);
  }

  createDummyTestTakerFile(workspaceId: number): Observable<boolean> {
    return this.fileService.createDummyTestTakerFile(workspaceId);
  }
}
