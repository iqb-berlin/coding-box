import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { catchError, Observable, of } from 'rxjs';
import { map } from 'rxjs/operators';
import { VariableInfo } from '@iqbspecs/variable-info/variable-info.interface';
import { FilesInListDto } from 'api-dto/files/files-in-list.dto';
import { UnitNoteDto } from 'api-dto/unit-notes/unit-note.dto';
import { UnitTagDto } from 'api-dto/unit-tags/unit-tag.dto';
import { CreateUnitTagDto } from 'api-dto/unit-tags/create-unit-tag.dto';
import { CreateWorkspaceDto } from 'api-dto/workspaces/create-workspace-dto';
import { PaginatedWorkspacesDto } from 'api-dto/workspaces/paginated-workspaces-dto';
import { CodingJob, Variable, VariableBundle } from '../coding/models/coding-job.model';
import { AppService } from './app.service';
import { TestGroupsInfoDto } from '../../../../../api-dto/files/test-groups-info.dto';
import { SERVER_URL } from '../injection-tokens';
import { UserService } from './user.service';
import { WorkspaceService } from './workspace.service';
import { FileService, BookletUnit } from './file.service';
import { CodingService } from './coding.service';
import { UnitTagService } from './unit-tag.service';
import { UnitNoteService } from './unit-note.service';
import { ResponseService } from './response.service';
import { TestResultService, TestResultsResponse, PersonTestResult } from './test-result.service';
import { ResourcePackageService } from './resource-package.service';
import { ValidationService } from './validation.service';
import { UnitService } from './unit.service';
import { ImportService, ImportOptions, Result } from './import.service';
import { AuthenticationService, ServerResponse } from './authentication.service';
import { VariableAnalysisService, VariableAnalysisResultDto } from './variable-analysis.service';
import { VariableAnalysisJobDto } from '../models/variable-analysis-job.dto';
import { ValidationTaskDto } from '../models/validation-task.dto';
import { FilesDto } from '../../../../../api-dto/files/files.dto';
import { CreateUnitNoteDto } from '../../../../../api-dto/unit-notes/create-unit-note.dto';
import { WorkspaceFullDto } from '../../../../../api-dto/workspaces/workspace-full-dto';
import { CodingStatistics } from '../../../../../api-dto/coding/coding-statistics';
import { FileValidationResultDto } from '../../../../../api-dto/files/file-validation-result.dto';
import { FileDownloadDto } from '../../../../../api-dto/files/file-download.dto';
import { PaginatedWorkspaceUserDto } from '../../../../../api-dto/workspaces/paginated-workspace-user-dto';
import { UserFullDto } from '../../../../../api-dto/user/user-full-dto';
import { CreateUserDto } from '../../../../../api-dto/user/create-user-dto';
import { UserWorkspaceAccessDto } from '../../../../../api-dto/workspaces/user-workspace-access-dto';
import { UserInListDto } from '../../../../../api-dto/user/user-in-list-dto';
import { ResourcePackageDto } from '../../../../../api-dto/resource-package/resource-package-dto';
import { TestTakersValidationDto } from '../../../../../api-dto/files/testtakers-validation.dto';
import { ResponseDto } from '../../../../../api-dto/responses/response-dto';
import { InvalidVariableDto } from '../../../../../api-dto/files/variable-validation.dto';
import { BookletInfoDto } from '../../../../../api-dto/booklet-info/booklet-info.dto';
import { UnitInfoDto } from '../../../../../api-dto/unit-info/unit-info.dto';
import { CodeBookContentSetting } from '../../../../../api-dto/coding/codebook-content-setting';
import { UnitVariableDetailsDto } from '../models/unit-variable-details.dto';
import { MissingsProfilesDto } from '../../../../../api-dto/coding/missings-profiles.dto';
import { VariableAnalysisItemDto } from '../../../../../api-dto/coding/variable-analysis-item.dto';
import { ResponseEntity } from '../shared/models/response-entity.model';

type ReplayStatisticsResponse = {
  id: number;
  timestamp: string;
  workspaceId: number;
  unitId: string;
  bookletId?: string;
  testPersonLogin?: string;
  testPersonCode?: string;
  durationMilliseconds: number;
  replayUrl?: string;
  success?: boolean;
  errorMessage?: string;
};

type AuthResponse = Required<Pick<ServerResponse, 'token' | 'claims'>>;

interface JobDefinitionApiResponse {
  id?: number;
  status?: 'draft' | 'pending_review' | 'approved';
  assigned_variables?: import('../coding/models/coding-job.model').Variable[];
  assigned_variable_bundles?: import('../coding/models/coding-job.model').VariableBundle[];
  assigned_coders?: number[];
  duration_seconds?: number;
  max_coding_cases?: number;
  double_coding_absolute?: number;
  double_coding_percentage?: number;
  created_at?: Date;
  updated_at?: Date;
}

interface JobDefinition {
  id?: number;
  status?: 'draft' | 'pending_review' | 'approved';
  assignedVariables?: import('../coding/models/coding-job.model').Variable[];
  assignedVariableBundles?: import('../coding/models/coding-job.model').VariableBundle[];
  assignedCoders?: number[];
  durationSeconds?: number;
  maxCodingCases?: number;
  doubleCodingAbsolute?: number;
  doubleCodingPercentage?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export interface CodingListItem {
  unit_key: string;
  unit_alias: string;
  login_name: string;
  login_code: string;
  booklet_id: string;
  variable_id: string;
  variable_page: string;
  variable_anchor: string;
  url: string;
}

@Injectable({
  providedIn: 'root'
})
export class BackendService {
  readonly serverUrl = inject(SERVER_URL);
  appService = inject(AppService);
  private http = inject(HttpClient);
  private userService = inject(UserService);
  private workspaceService = inject(WorkspaceService);
  private fileService = inject(FileService);
  private codingService = inject(CodingService);
  private unitTagService = inject(UnitTagService);
  private unitNoteService = inject(UnitNoteService);
  private responseService = inject(ResponseService);
  private testResultService = inject(TestResultService);
  private resourcePackageService = inject(ResourcePackageService);
  private validationService = inject(ValidationService);
  private unitService = inject(UnitService);
  private importService = inject(ImportService);
  private authenticationService = inject(AuthenticationService);
  private variableAnalysisService = inject(VariableAnalysisService);

  authHeader = { Authorization: `Bearer ${localStorage.getItem('id_token')}` };

  getDirectDownloadLink(): string {
    return this.fileService.getDirectDownloadLink();
  }

  getUsers(workspaceId: number): Observable<UserInListDto[]> {
    return this.userService.getUsers(workspaceId);
  }

  saveUsers(workspaceId: number, users: UserWorkspaceAccessDto[]): Observable<UserWorkspaceAccessDto[]> {
    return this.userService.saveUsers(workspaceId, users);
  }

  getUsersFull(): Observable<UserFullDto[]> {
    return this.userService.getUsersFull();
  }

  addUser(newUser: CreateUserDto): Observable<boolean> {
    return this.userService.addUser(newUser);
  }

  changeUserData(userId: number, newData: UserFullDto): Observable<boolean> {
    return this.userService.changeUserData(userId, newData);
  }

  deleteUsers(users: number[]): Observable<boolean> {
    return this.userService.deleteUsers(users);
  }

  getAllWorkspacesList(): Observable<PaginatedWorkspacesDto> {
    return this.workspaceService.getAllWorkspacesList();
  }

  getWorkspacesByUserList(userId: number): Observable<number[]> {
    return this.userService.getWorkspacesByUserList(userId);
  }

  getWorkspaceUsers(workspaceId: number): Observable<PaginatedWorkspaceUserDto> {
    return this.workspaceService.getWorkspaceUsers(workspaceId);
  }

  addWorkspace(workspaceData: CreateWorkspaceDto): Observable<boolean> {
    return this.workspaceService.addWorkspace(workspaceData);
  }

  deleteWorkspace(ids: number[]): Observable<boolean> {
    return this.workspaceService.deleteWorkspace(ids);
  }

  deleteFiles(workspaceId: number, fileIds: number[]): Observable<boolean> {
    return this.fileService.deleteFiles(workspaceId, fileIds);
  }

  downloadFile(workspaceId: number, fileId: number): Observable<FileDownloadDto> {
    return this.fileService.downloadFile(workspaceId, fileId);
  }

  validateFiles(workspace_id: number): Observable<boolean | FileValidationResultDto> {
    return this.fileService.validateFiles(workspace_id);
  }

  deleteTestPersons(workspace_id: number, testPersonIds: number[]): Observable<boolean> {
    return this.responseService.deleteTestPersons(workspace_id, testPersonIds);
  }

  codeTestPersons(workspace_id: number, testPersonIds: number[]): Observable<{
    totalResponses: number;
    statusCounts: {
      [key: string]: number;
    };
    jobId?: string;
    message?: string;
  }> {
    return this.codingService.codeTestPersons(workspace_id, testPersonIds);
  }

  getCodingJobStatus(workspace_id: number, jobId: string): Observable<{
    status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'paused';
    progress: number;
    result?: {
      totalResponses: number;
      statusCounts: {
        [key: string]: number;
      };
    };
    error?: string;
  }> {
    return this.codingService.getCodingJobStatus(workspace_id, jobId);
  }

  getCodingListAsCsv(workspace_id: number): Observable<Blob> {
    return this.codingService.getCodingListAsCsv(workspace_id);
  }

  getCodingListAsExcel(workspace_id: number): Observable<Blob> {
    return this.codingService.getCodingListAsExcel(workspace_id);
  }

  getCodingStatistics(workspace_id: number, version: 'v1' | 'v2' | 'v3' = 'v1'): Observable<CodingStatistics> {
    return this.codingService.getCodingStatistics(workspace_id, version);
  }

  createCodingStatisticsJob(workspace_id: number): Observable<{ jobId: string; message: string }> {
    return this.codingService.createCodingStatisticsJob(workspace_id);
  }

  getVariableAnalysis(
    workspace_id: number,
    page: number = 1,
    limit: number = 100,
    unitId?: string,
    variableId?: string,
    derivation?: string
  ): Observable<PaginatedResponse<VariableAnalysisItemDto>> {
    return this.codingService.getVariableAnalysis(workspace_id, page, limit, unitId, variableId, derivation);
  }

  getResponsesByStatus(workspace_id: number, status: string, version: 'v1' | 'v2' | 'v3' = 'v1', page: number = 1, limit: number = 100): Observable<PaginatedResponse<ResponseEntity>> {
    return this.codingService.getResponsesByStatus(workspace_id, status, version, page, limit);
  }

  resetCodingVersion(
    workspace_id: number,
    version: 'v1' | 'v2' | 'v3',
    unitFilters?: string[],
    variableFilters?: string[]
  ): Observable<{
      affectedResponseCount: number;
      cascadeResetVersions: ('v2' | 'v3')[];
      message: string;
    }> {
    return this.codingService.resetCodingVersion(workspace_id, version, unitFilters, variableFilters);
  }

  changeWorkspace(workspaceData: WorkspaceFullDto): Observable<boolean> {
    return this.workspaceService.changeWorkspace(workspaceData);
  }

  uploadTestFiles(workspaceId: number, files: FileList | FormData | null): Observable<number> {
    return this.fileService.uploadTestFiles(workspaceId, files);
  }

  uploadTestResults(
    workspaceId: number,
    files: FileList | null,
    resultType: 'logs' | 'responses',
    overwriteExisting: boolean = true
  ): Observable<number> {
    return this.fileService.uploadTestResults(workspaceId, files, resultType, overwriteExisting);
  }

  setUserWorkspaceAccessRight(userId: number, workspaceIds: number[]): Observable<boolean> {
    return this.userService.setUserWorkspaceAccessRight(userId, workspaceIds);
  }

  createUnitTag(workspaceId: number, createUnitTagDto: CreateUnitTagDto): Observable<UnitTagDto> {
    return this.unitTagService.createUnitTag(workspaceId, createUnitTagDto);
  }

  deleteUnitTag(workspaceId: number, tagId: number): Observable<boolean> {
    return this.unitTagService.deleteUnitTag(workspaceId, tagId);
  }

  createUnitNote(workspaceId: number, createUnitNoteDto: CreateUnitNoteDto): Observable<UnitNoteDto> {
    return this.unitNoteService.createUnitNote(workspaceId, createUnitNoteDto);
  }

  getUnitNotes(workspaceId: number, unitId: number): Observable<UnitNoteDto[]> {
    return this.unitNoteService.getUnitNotes(workspaceId, unitId);
  }

  getNotesForMultipleUnits(workspaceId: number, unitIds: number[]): Observable<{ [unitId: number]: UnitNoteDto[] }> {
    return this.unitNoteService.getNotesForMultipleUnits(workspaceId, unitIds);
  }

  deleteUnitNote(workspaceId: number, noteId: number): Observable<boolean> {
    return this.unitNoteService.deleteUnitNote(workspaceId, noteId);
  }

  setWorkspaceUsersAccessRight(workspaceId: number, userIds: number[]): Observable<boolean> {
    return this.workspaceService.setWorkspaceUsersAccessRight(workspaceId, userIds);
  }

  getFilesList(
    workspaceId: number,
    page: number = 1,
    limit: number = 10000,
    fileType?: string,
    fileSize?: string,
    searchText?: string
  ): Observable<PaginatedResponse<FilesInListDto> & { fileTypes: string[] }> {
    return this.fileService.getFilesList(workspaceId, page, limit, fileType, fileSize, searchText);
  }

  getUnitDef(workspaceId: number, unit: string, authToken?: string): Observable<FilesDto[]> {
    return this.fileService.getUnitDef(workspaceId, unit, authToken);
  }

  getPlayer(workspaceId: number, player: string, authToken?: string): Observable<FilesDto[]> {
    return this.fileService.getPlayer(workspaceId, player, authToken);
  }

  getResponses(workspaceId: number, testPerson: string, unitId: string, authToken?: string): Observable<ResponseDto[]> {
    return this.responseService.getResponses(workspaceId, testPerson, unitId, authToken);
  }

  getUnit(workspaceId: number, unitId: string, authToken?: string): Observable<FilesDto[]> {
    return this.fileService.getUnit(workspaceId, unitId, authToken);
  }

  getVocs(workspaceId: number, unitId: string, authToken?: string): Observable<FilesDto[]> {
    const headers = authToken ? { Authorization: `Bearer ${authToken}` } : this.authHeader;
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/files/coding-scheme/${unitId}`;
    return this.http.get<FileDownloadDto | null>(url, { headers }).pipe(
      map(fileDownload => {
        if (!fileDownload) {
          return [];
        }
        const data = fileDownload?.base64Data;
        return [{ file_id: fileDownload?.filename, data }];
      }),
      catchError(() => of([]))
    );
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

  getTestPersons(workspaceId: number): Observable<number[]> {
    return this.testResultService.getTestPersons(workspaceId);
  }

  getTestResults(workspaceId: number, page: number, limit: number, searchText?: string): Observable<TestResultsResponse> {
    return this.testResultService.getTestResults(workspaceId, page, limit, searchText);
  }

  getExportOptions(workspaceId: number): Observable<{
    testPersons: { id: number; code: string; groupName: string; login: string }[];
    booklets: string[];
    units: string[];
  }> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/results/export/options`;
    return this.http.get<{
      testPersons: { id: number; code: string; groupName: string; login: string }[];
      booklets: string[];
      units: string[];
    }>(url, {
      headers: this.authHeader
    });
  }

  exportTestResults(workspaceId: number): Observable<Blob> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/results/export`;
    return this.http.get(url, {
      responseType: 'blob',
      headers: this.authHeader
    });
  }

  startExportTestResultsJob(
    workspaceId: number,
    filters?: { groupNames?: string[]; bookletNames?: string[]; unitNames?: string[]; personIds?: number[] }
  ): Observable<{ jobId: string; message: string }> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/results/export/job`;
    return this.http.post<{ jobId: string; message: string }>(url, filters || {}, {
      headers: this.authHeader
    });
  }

  getExportTestResultsJobs(workspaceId: number): Observable<Array<{
    jobId: string;
    status: string;
    progress: number;
    exportType: string;
    createdAt: number;
  }>> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/results/export/jobs`;
    return this.http.get<Array<{
      jobId: string;
      status: string;
      progress: number;
      exportType: string;
      createdAt: number;
    }>>(url, {
      headers: this.authHeader
    });
  }

  downloadExportTestResultsJob(workspaceId: number, jobId: string): Observable<Blob> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/results/export/jobs/${jobId}/download`;
    return this.http.get(url, {
      responseType: 'blob',
      headers: this.authHeader
    });
  }

  deleteTestResultExportJob(workspaceId: number, jobId: string): Observable<{ success: boolean; message: string }> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/results/export/jobs/${jobId}`;
    return this.http.delete<{ success: boolean; message: string }>(url, {
      headers: this.authHeader
    });
  }

  getPersonTestResults(workspaceId: number, personId: number): Observable<PersonTestResult[]> {
    return this.testResultService.getPersonTestResults(workspaceId, personId);
  }

  authenticate(username:string, password:string, server:string, url:string): Observable<AuthResponse> {
    return this.authenticationService.authenticate(username, password, server, url) as Observable<AuthResponse>;
  }

  importWorkspaceFiles(workspace_id: number,
                       testCenterWorkspace: string,
                       server:string,
                       url:string,
                       token:string,
                       importOptions:ImportOptions,
                       testGroups: string[],
                       overwriteExistingLogs:boolean = false
  ): Observable<Result> {
    return this.importService.importWorkspaceFiles(
      workspace_id,
      testCenterWorkspace,
      server,
      url,
      token,
      importOptions,
      testGroups,
      overwriteExistingLogs
    );
  }

  importTestcenterGroups(workspace_id: number,
                         testCenterWorkspace: string,
                         server:string,
                         url:string,
                         authToken:string
  ): Observable<TestGroupsInfoDto[]> {
    return this.importService.importTestcenterGroups(
      workspace_id,
      testCenterWorkspace,
      server,
      url,
      authToken
    );
  }

  getResourcePackages(workspaceId:number): Observable<ResourcePackageDto[]> {
    return this.resourcePackageService.getResourcePackages(workspaceId);
  }

  deleteResourcePackages(workspaceId:number, ids: number[]): Observable<boolean> {
    return this.resourcePackageService.deleteResourcePackages(workspaceId, ids);
  }

  downloadResourcePackage(workspaceId:number, name: string): Observable<Blob> {
    return this.resourcePackageService.downloadResourcePackage(workspaceId, name);
  }

  uploadResourcePackage(workspaceId:number, file: File): Observable<number> {
    return this.resourcePackageService.uploadResourcePackage(workspaceId, file);
  }

  getCodingSchemeFile(workspaceId: number, codingSchemeRef: string): Observable<FileDownloadDto | null> {
    return this.fileService.getCodingSchemeFile(workspaceId, codingSchemeRef);
  }

  getUnitContentXml(workspaceId: number, unitId: string): Observable<string | null> {
    return this.fileService.getUnitContentXml(workspaceId, unitId);
  }

  searchResponses(
    workspaceId: number,
    searchParams: { value?: string; variableId?: string; unitName?: string; bookletName?: string; status?: string; codedStatus?: string; group?: string; code?: string; version?: 'v1' | 'v2' | 'v3' },
    page?: number,
    limit?: number
  ): Observable<{
      data: {
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
      }[];
      total: number;
    }> {
    return this.responseService.searchResponses(workspaceId, searchParams, page, limit);
  }

  searchBookletsByName(
    workspaceId: number,
    bookletName: string,
    page?: number,
    limit?: number
  ): Observable<{
      data: {
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
      }[];
      total: number;
    }> {
    return this.testResultService.searchBookletsByName(workspaceId, bookletName, page, limit);
  }

  searchUnitsByName(
    workspaceId: number,
    unitName: string,
    page?: number,
    limit?: number
  ): Observable<{
      data: {
        unitId: number;
        unitName: string;
        unitAlias: string | null;
        bookletId: number;
        bookletName: string;
        personId: number;
        personLogin: string;
        personCode: string;
        personGroup: string;
        tags: { id: number; unitId: number; tag: string; color?: string; createdAt: Date }[];
        responses: { variableId: string; value: string; status: string; code?: number; score?: number; codedStatus?: string }[];
      }[];
      total: number;
    }> {
    return this.testResultService.searchUnitsByName(workspaceId, unitName, page, limit);
  }

  deleteUnit(workspaceId: number, unitId: number): Observable<{
    success: boolean;
    report: {
      deletedUnit: number | null;
      warnings: string[];
    };
  }> {
    return this.unitService.deleteUnit(workspaceId, unitId);
  }

  deleteMultipleUnits(workspaceId: number, unitIds: number[]): Observable<{
    success: boolean;
    report: {
      deletedUnits: number[];
      warnings: string[];
    };
  }> {
    return this.unitService.deleteMultipleUnits(workspaceId, unitIds);
  }

  deleteResponse(workspaceId: number, responseId: number): Observable<{
    success: boolean;
    report: {
      deletedResponse: number | null;
      warnings: string[];
    };
  }> {
    return this.responseService.deleteResponse(workspaceId, responseId);
  }

  deleteBooklet(workspaceId: number, bookletId: number): Observable<{
    success: boolean;
    report: {
      deletedBooklet: number | null;
      warnings: string[];
    };
  }> {
    return this.testResultService.deleteBooklet(workspaceId, bookletId);
  }

  validateVariables(workspaceId: number, page: number = 1, limit: number = 10): Observable<PaginatedResponse<InvalidVariableDto>> {
    return this.validationService.validateVariables(workspaceId, page, limit);
  }

  validateVariableTypes(workspaceId: number, page: number = 1, limit: number = 10): Observable<PaginatedResponse<InvalidVariableDto>> {
    return this.validationService.validateVariableTypes(workspaceId, page, limit);
  }

  validateResponseStatus(workspaceId: number, page: number = 1, limit: number = 10): Observable<PaginatedResponse<InvalidVariableDto>> {
    return this.validationService.validateResponseStatus(workspaceId, page, limit);
  }

  validateTestTakers(workspaceId: number): Observable<TestTakersValidationDto> {
    return this.validationService.validateTestTakers(workspaceId);
  }

  validateGroupResponses(workspaceId: number, page: number = 1, limit: number = 10): Observable<{
    testTakersFound: boolean;
    groupsWithResponses: { group: string; hasResponse: boolean }[];
    allGroupsHaveResponses: boolean;
    total: number;
    page: number;
    limit: number;
  }> {
    return this.validationService.validateGroupResponses(workspaceId, page, limit);
  }

  createVariableAnalysisJob(
    workspaceId: number,
    unitId?: number,
    variableId?: string
  ): Observable<VariableAnalysisJobDto> {
    return this.variableAnalysisService.createAnalysisJob(
      workspaceId,
      unitId,
      variableId
    );
  }

  getVariableAnalysisResults(
    workspaceId: number,
    jobId: number
  ): Observable<VariableAnalysisResultDto> {
    return this.variableAnalysisService.getAnalysisResults(workspaceId, jobId);
  }

  getAllVariableAnalysisJobs(workspaceId: number): Observable<VariableAnalysisJobDto[]> {
    return this.variableAnalysisService.getAllJobs(workspaceId);
  }

  cancelVariableAnalysisJob(workspaceId: number, jobId: number): Observable<{ success: boolean; message: string }> {
    return this.variableAnalysisService.cancelJob(workspaceId, jobId);
  }

  deleteVariableAnalysisJob(workspaceId: number, jobId: number): Observable<{ success: boolean; message: string }> {
    return this.variableAnalysisService.deleteJob(workspaceId, jobId);
  }

  createDistributedCodingJobs(
    workspaceId: number,
    selectedVariables: { unitName: string; variableId: string }[],
    selectedCoders: { id: number; name: string; username: string }[],
    doubleCodingAbsolute?: number,
    doubleCodingPercentage?: number,
    selectedVariableBundles?: { id: number; name: string; variables: { unitName: string; variableId: string }[] }[]
  ): Observable<{
      success: boolean;
      jobsCreated: number;
      message: string;
      distribution: Record<string, Record<string, number>>;
      doubleCodingInfo: Record<string, { totalCases: number; doubleCodedCases: number; singleCodedCasesAssigned: number; doubleCodedCasesPerCoder: Record<string, number> }>;
      aggregationInfo: Record<string, { uniqueCases: number; totalResponses: number }>;
      matchingFlags: string[];
      jobs: {
        coderId: number;
        coderName: string;
        variable: { unitName: string; variableId: string };
        jobId: number;
        jobName: string;
        caseCount: number;
      }[];
    }> {
    return this.codingService.createDistributedCodingJobs(workspaceId, selectedVariables, selectedCoders, doubleCodingAbsolute, doubleCodingPercentage, selectedVariableBundles);
  }

  calculateDistribution(
    workspaceId: number,
    selectedVariables: { unitName: string; variableId: string }[],
    selectedCoders: { id: number; name: string; username: string }[],
    doubleCodingAbsolute?: number,
    doubleCodingPercentage?: number,
    selectedVariableBundles?: { id: number; name: string; variables: { unitName: string; variableId: string }[] }[]
  ): Observable<{
      distribution: Record<string, Record<string, number>>;
      doubleCodingInfo: Record<string, { totalCases: number; doubleCodedCases: number; singleCodedCasesAssigned: number; doubleCodedCasesPerCoder: Record<string, number> }>;
      aggregationInfo: Record<string, { uniqueCases: number; totalResponses: number }>;
      matchingFlags: string[];
    }> {
    return this.codingService.calculateDistribution(workspaceId, selectedVariables, selectedCoders, doubleCodingAbsolute, doubleCodingPercentage, selectedVariableBundles);
  }

  createValidationTask(
    workspaceId: number,
    type: 'variables' | 'variableTypes' | 'responseStatus' | 'testTakers' | 'groupResponses' | 'deleteResponses' | 'deleteAllResponses' | 'duplicateResponses',
    page?: number,
    limit?: number,
    additionalData?: Record<string, unknown>
  ): Observable<ValidationTaskDto> {
    return this.validationService.createValidationTask(workspaceId, type, page, limit, additionalData);
  }

  createDeleteResponsesTask(
    workspaceId: number,
    responseIds: number[]
  ): Observable<ValidationTaskDto> {
    return this.validationService.createDeleteResponsesTask(workspaceId, responseIds);
  }

  createDeleteAllResponsesTask(
    workspaceId: number,
    validationType: 'variables' | 'variableTypes' | 'responseStatus' | 'duplicateResponses'
  ): Observable<ValidationTaskDto> {
    return this.validationService.createDeleteAllResponsesTask(workspaceId, validationType);
  }

  getValidationTask(workspaceId: number, taskId: number): Observable<ValidationTaskDto> {
    return this.validationService.getValidationTask(workspaceId, taskId);
  }

  getValidationResults(workspaceId: number, taskId: number): Observable<unknown> {
    return this.validationService.getValidationResults(workspaceId, taskId);
  }

  pollValidationTask(
    workspaceId: number,
    taskId: number,
    pollInterval: number = 2000
  ): Observable<ValidationTaskDto> {
    return this.validationService.pollValidationTask(workspaceId, taskId, pollInterval);
  }

  createDummyTestTakerFile(workspaceId: number): Observable<boolean> {
    return this.fileService.createDummyTestTakerFile(workspaceId);
  }

  getMissingsProfiles(workspaceId: number): Observable<{ label: string; id: number }[]> {
    return this.codingService.getMissingsProfiles(workspaceId);
  }

  getMissingsProfileDetails(workspaceId: number, id: number | string): Observable<MissingsProfilesDto | null> {
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

  getCodingBook(
    workspaceId: number,
    missingsProfile: string,
    contentOptions: CodeBookContentSetting,
    unitList: number[]
  ): Observable<Blob | null> {
    return this.codingService.getCodingBook(workspaceId, missingsProfile, contentOptions, unitList);
  }

  getUnitsWithFileIds(workspaceId: number): Observable<{ id: number; unitId: string; fileName: string; data: string }[]> {
    return this.fileService.getUnitsWithFileIds(workspaceId);
  }

  getVariableInfoForScheme(workspaceId: number, schemeFileId: string): Observable<VariableInfo[]> {
    const fileId = schemeFileId.endsWith('.vocs') ?
      schemeFileId.slice(0, -5) :
      schemeFileId;

    return this.fileService.getVariableInfoForScheme(workspaceId, fileId);
  }

  storeReplayStatistics(
    workspaceId: number,
    data: {
      unitId: string;
      bookletId?: string;
      testPersonLogin?: string;
      testPersonCode?: string;
      durationMilliseconds: number;
      replayUrl?: string;
      success?: boolean;
      errorMessage?: string;
    }
  ): Observable<ReplayStatisticsResponse> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/replay-statistics`;
    return this.http.post<ReplayStatisticsResponse>(url, data);
  }

  getReplayFrequencyByUnit(workspaceId: number): Observable<Record<string, number>> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/replay-statistics/frequency`;
    return this.http.get<Record<string, number>>(url);
  }

  getReplayDurationStatistics(
    workspaceId: number,
    unitId?: string
  ): Observable<{
      min: number;
      max: number;
      average: number;
      distribution: Record<string, number>;
      unitAverages?: Record<string, number>;
    }> {
    let url = `${this.serverUrl}admin/workspace/${workspaceId}/replay-statistics/duration`;
    if (unitId) {
      url += `?unitId=${encodeURIComponent(unitId)}`;
    }
    return this.http.get<{
      min: number;
      max: number;
      average: number;
      distribution: Record<string, number>;
      unitAverages?: Record<string, number>;
    }>(url);
  }

  getReplayDistributionByDay(workspaceId: number): Observable<Record<string, number>> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/replay-statistics/distribution/day`;
    return this.http.get<Record<string, number>>(url);
  }

  getReplayDistributionByHour(workspaceId: number): Observable<Record<string, number>> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/replay-statistics/distribution/hour`;
    return this.http.get<Record<string, number>>(url);
  }

  getReplayErrorStatistics(workspaceId: number): Observable<{
    successRate: number;
    totalReplays: number;
    successfulReplays: number;
    failedReplays: number;
    commonErrors: Array<{ message: string; count: number }>;
  }> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/replay-statistics/errors`;
    return this.http.get<{
      successRate: number;
      totalReplays: number;
      successfulReplays: number;
      failedReplays: number;
      commonErrors: Array<{ message: string; count: number }>;
    }>(url);
  }

  getFailureDistributionByUnit(workspaceId: number): Observable<Record<string, number>> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/replay-statistics/failures/unit`;
    return this.http.get<Record<string, number>>(url);
  }

  getFailureDistributionByDay(workspaceId: number): Observable<Record<string, number>> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/replay-statistics/failures/day`;
    return this.http.get<Record<string, number>>(url);
  }

  getFailureDistributionByHour(workspaceId: number): Observable<Record<string, number>> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/replay-statistics/failures/hour`;
    return this.http.get<Record<string, number>>(url);
  }

  getVariableBundles(workspaceId: number): Observable<VariableBundle[]> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/variable-bundle`;
    return this.http.get<PaginatedResponse<VariableBundle>>(url)
      .pipe(
        map(response => response.data)
      );
  }

  private mapApiCodingJob(job: unknown): CodingJob {
    if (!job) {
      return job as CodingJob;
    }

    const apiJob = job as Record<string, unknown>;

    const mapped: Partial<CodingJob> = {
      ...apiJob,
      assignedCoders: (apiJob.assignedCoders ?? apiJob.assigned_coders ?? []) as number[],
      assignedVariables: (apiJob.assignedVariables ?? apiJob.assigned_variables ?? apiJob.variables ?? []) as Variable[],
      variables: (apiJob.variables ?? apiJob.assigned_variables ?? apiJob.assignedVariables ?? []) as Variable[],
      assignedVariableBundles: (apiJob.assignedVariableBundles ?? apiJob.assigned_variable_bundles ?? apiJob.variableBundles ?? apiJob.variable_bundles ?? []) as VariableBundle[],
      variableBundles: (apiJob.variableBundles ?? apiJob.variable_bundles ?? apiJob.assigned_variable_bundles ?? apiJob.assignedVariableBundles ?? []) as VariableBundle[],
      progress: (apiJob.progress ?? 0) as number,
      codedUnits: (apiJob.codedUnits ?? apiJob.coded_units ?? apiJob.coded ?? 0) as number,
      totalUnits: (apiJob.totalUnits ?? apiJob.total_units ?? apiJob.total ?? 0) as number,
      openUnits: (apiJob.openUnits ?? apiJob.open_units ?? apiJob.open ?? 0) as number,
      created_at: (apiJob.created_at ?? apiJob.createdAt) as Date,
      updated_at: (apiJob.updated_at ?? apiJob.updatedAt) as Date,
      workspace_id: (apiJob.workspace_id ?? apiJob.workspaceId) as number
    };

    return mapped as CodingJob;
  }

  getCodingJobs(
    workspaceId: number,
    page?: number,
    limit?: number
  ): Observable<PaginatedResponse<CodingJob>> {
    const url = `${this.serverUrl}wsg-admin/workspace/${workspaceId}/coding-job`;
    let params = new HttpParams();

    if (page !== undefined) {
      params = params.set('page', page.toString());
    }

    if (limit !== undefined) {
      params = params.set('limit', limit.toString());
    }

    return this.http.get<PaginatedResponse<unknown>>(url, { params }).pipe(
      map(response => ({
        ...response,
        data: (response.data || []).map((j: unknown) => this.mapApiCodingJob(j))
      }))
    );
  }

  getCodingJob(workspaceId: number, codingJobId: number): Observable<CodingJob> {
    const url = `${this.serverUrl}wsg-admin/workspace/${workspaceId}/coding-job/${codingJobId}`;
    return this.http.get<unknown>(url).pipe(
      map(job => this.mapApiCodingJob(job))
    );
  }

  createCodingJob(workspaceId: number, codingJob: Omit<CodingJob, 'id' | 'createdAt' | 'updatedAt'>): Observable<CodingJob> {
    const url = `${this.serverUrl}wsg-admin/workspace/${workspaceId}/coding-job`;
    return this.http.post<CodingJob>(url, codingJob);
  }

  updateCodingJob(
    workspaceId: number,
    codingJobId: number,
    codingJob: Partial<Omit<CodingJob, 'id' | 'createdAt' | 'updatedAt'>>
  ): Observable<CodingJob> {
    const url = `${this.serverUrl}wsg-admin/workspace/${workspaceId}/coding-job/${codingJobId}`;
    return this.http.put<CodingJob>(url, codingJob);
  }

  deleteCodingJob(workspaceId: number, codingJobId: number): Observable<{ success: boolean }> {
    const url = `${this.serverUrl}wsg-admin/workspace/${workspaceId}/coding-job/${codingJobId}`;
    return this.http.delete<{ success: boolean }>(url);
  }

  startCodingJob(
    workspaceId: number,
    codingJobId: number
  ): Observable<{ total: number; items: Array<{ responseId: number; unitName: string; unitAlias: string | null; variableId: string; variableAnchor: string; bookletName: string; personLogin: string; personCode: string; personGroup: string }> }> {
    const url = `${this.serverUrl}wsg-admin/workspace/${workspaceId}/coding-job/${codingJobId}/start`;
    return this.http.post<{ total: number; items: Array<{ responseId: number; unitName: string; unitAlias: string | null; variableId: string; variableAnchor: string; bookletName: string; personLogin: string; personCode: string; personGroup: string }> }>(url, {});
  }

  getCodingIncompleteVariables(
    workspaceId: number,
    unitName?: string
  ): Observable<{ unitName: string; variableId: string; responseCount: number }[]> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/incomplete-variables`;
    let params = new HttpParams();
    if (unitName) {
      params = params.set('unitName', unitName);
    }
    // Add cache-busting parameter to ensure fresh data after job definition changes
    params = params.set('_t', Date.now().toString());
    return this.http.get<{ unitName: string; variableId: string; responseCount: number }[]>(url, { params });
  }

  getAppliedResultsCount(
    workspaceId: number,
    incompleteVariables: { unitName: string; variableId: string }[]
  ): Observable<number> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/applied-results-count`;
    return this.http.post<number>(url, { incompleteVariables });
  }

  createCoderTrainingJobs(
    workspaceId: number,
    selectedCoders: { id: number; name: string }[],
    variableConfigs: { variableId: string; unitId: string; sampleCount: number }[],
    trainingLabel: string,
    missingsProfileId?: number
  ): Observable<{ success: boolean; jobsCreated: number; message: string; jobs: { coderId: number; coderName: string; jobId: number; jobName: string }[]; trainingId?: number }> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/coder-training-jobs`;
    return this.http.post<{ success: boolean; jobsCreated: number; message: string; jobs: { coderId: number; coderName: string; jobId: number; jobName: string }[]; trainingId?: number }>(url, {
      trainingLabel,
      selectedCoders,
      variableConfigs,
      missingsProfileId
    });
  }

  getCoderTrainings(workspaceId: number): Observable<{
    id: number;
    workspace_id: number;
    label: string;
    created_at: Date;
    updated_at: Date;
    jobsCount: number;
  }[]> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/coder-trainings`;
    return this.http.get<{
      id: number;
      workspace_id: number;
      label: string;
      created_at: Date;
      updated_at: Date;
      jobsCount: number;
    }[]>(url);
  }

  updateCoderTrainingLabel(workspaceId: number, trainingId: number, newLabel: string): Observable<{ success: boolean; message: string }> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/coder-trainings/${trainingId}`;
    return this.http.put<{ success: boolean; message: string }>(url, { label: newLabel });
  }

  deleteCoderTraining(workspaceId: number, trainingId: number): Observable<{ success: boolean; message: string }> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/coder-trainings/${trainingId}`;
    return this.http.delete<{ success: boolean; message: string }>(url);
  }

  compareTrainingCodingResults(
    workspaceId: number,
    trainingIds: string
  ): Observable<Array<{
      unitName: string;
      variableId: string;
      trainings: Array<{
        trainingId: number;
        trainingLabel: string;
        code: string | null;
        score: number | null;
      }>;
    }>> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/compare-training-results?trainingIds=${encodeURIComponent(trainingIds)}`;
    return this.http.get<Array<{
      unitName: string;
      variableId: string;
      trainings: Array<{
        trainingId: number;
        trainingLabel: string;
        code: string | null;
        score: number | null;
      }>;
    }>>(url);
  }

  compareWithinTrainingCodingResults(
    workspaceId: number,
    trainingId: number
  ): Observable<Array<{
      unitName: string;
      variableId: string;
      personCode: string;
      testPerson: string;
      givenAnswer: string;
      coders: Array<{
        jobId: number;
        coderName: string;
        code: string | null;
        score: number | null;
      }>;
    }>> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/compare-within-training?trainingId=${trainingId}`;
    return this.http.get<Array<{
      unitName: string;
      variableId: string;
      personCode: string;
      testPerson: string;
      givenAnswer: string;
      coders: Array<{
        jobId: number;
        coderName: string;
        code: string | null;
        score: number | null;
      }>;
    }>>(url);
  }

  getCodingJobsForTraining(
    workspaceId: number,
    trainingId: number
  ): Observable<Array<{
      id: number;
      name: string;
      description?: string;
      status: string;
      created_at: Date;
      coder: {
        userId: number;
        username: string;
      };
      unitsCount: number;
    }>> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/coder-trainings/${trainingId}/jobs`;
    return this.http.get<Array<{
      id: number;
      name: string;
      description?: string;
      status: string;
      created_at: Date;
      coder: {
        userId: number;
        username: string;
      };
      unitsCount: number;
    }>>(url);
  }

  downloadWorkspaceFilesAsZip(workspaceId: number): Observable<Blob> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/files/download-zip`;
    return this.http.get(url, {
      responseType: 'blob',
      headers: {
        Authorization: `Bearer ${localStorage.getItem('id_token')}`
      }
    });
  }

  saveCodingProgress(
    workspaceId: number,
    codingJobId: number,
    progressData: {
      testPerson: string;
      unitId: string;
      variableId: string;
      selectedCode: {
        id: number;
        code: string;
        label: string;
        [key: string]: unknown;
      };
      isOpen?: boolean;
      notes?: string;
    }
  ): Observable<CodingJob> {
    const url = `${this.serverUrl}wsg-admin/workspace/${workspaceId}/coding-job/${codingJobId}/progress`;
    return this.http.post<CodingJob>(url, progressData);
  }

  restartCodingJobWithOpenUnits(workspaceId: number, codingJobId: number): Observable<CodingJob> {
    const url = `${this.serverUrl}wsg-admin/workspace/${workspaceId}/coding-job/${codingJobId}/restart-open-units`;
    return this.http.post<CodingJob>(url, {});
  }

  getCodingProgress(workspaceId: number, codingJobId: number): Observable<Record<string, unknown>> {
    const url = `${this.serverUrl}wsg-admin/workspace/${workspaceId}/coding-job/${codingJobId}/progress`;
    return this.http.get<Record<string, unknown>>(url, { headers: this.authHeader });
  }

  getBulkCodingProgress(workspaceId: number, jobIds: number[]): Observable<Record<number, Record<string, unknown>>> {
    const jobIdsParam = jobIds.join(',');
    const url = `${this.serverUrl}wsg-admin/workspace/${workspaceId}/coding-job/progress/bulk?jobIds=${jobIdsParam}`;
    return this.http.get<Record<number, Record<string, unknown>>>(url, { headers: this.authHeader });
  }

  getCodingNotes(workspaceId: number, codingJobId: number): Observable<Record<string, string> | null> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding-job/${codingJobId}/notes`;
    return this.http.get<Record<string, string> | null>(url, { headers: this.authHeader });
  }

  getCodingJobUnits(
    workspaceId: number,
    codingJobId: number
  ): Observable<Array<{ responseId: number; unitName: string; unitAlias: string | null; variableId: string; variableAnchor: string; bookletName: string; personLogin: string; personCode: string; personGroup: string }>> {
    const url = `${this.serverUrl}wsg-admin/workspace/${workspaceId}/coding-job/${codingJobId}/units`;
    return this.http.get<Array<{ responseId: number; unitName: string; unitAlias: string | null; variableId: string; variableAnchor: string; bookletName: string; personLogin: string; personCode: string; personGroup: string }>>(url);
  }

  applyCodingResults(
    workspaceId: number,
    codingJobId: number
  ): Observable<{
      success: boolean;
      updatedResponsesCount: number;
      skippedReviewCount: number;
      messageKey: string;
      messageParams?: Record<string, unknown>;
    }> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/jobs/${codingJobId}/apply-results`;
    return this.http.post<{
      success: boolean;
      updatedResponsesCount: number;
      skippedReviewCount: number;
      messageKey: string;
      messageParams?: Record<string, unknown>;
    }>(url, {});
  }

  bulkApplyCodingResults(
    workspaceId: number
  ): Observable<{
      success: boolean;
      jobsProcessed: number;
      totalUpdatedResponses: number;
      totalSkippedReview: number;
      message: string;
      results: Array<{
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
      }>;
    }> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/jobs/bulk-apply-results`;
    return this.http.post<{
      success: boolean;
      jobsProcessed: number;
      totalUpdatedResponses: number;
      totalSkippedReview: number;
      message: string;
      results: Array<{
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
      }>;
    }>(url, {});
  }

  getUnitVariables(workspaceId: number): Observable<UnitVariableDetailsDto[]> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/files/unit-variables`;
    return this.http.get<UnitVariableDetailsDto[]>(url);
  }

  createJobDefinition(workspaceId: number, jobDefinition: Omit<import('../coding/components/coding-job-definition-dialog/coding-job-definition-dialog.component').JobDefinition, 'id'>): Observable<JobDefinition> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/job-definitions`;
    return this.http.post<JobDefinition>(url, jobDefinition);
  }

  updateJobDefinition(workspaceId: number, jobDefinitionId: number, jobDefinition: Partial<import('../coding/components/coding-job-definition-dialog/coding-job-definition-dialog.component').JobDefinition>): Observable<JobDefinition> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/job-definitions/${jobDefinitionId}`;
    return this.http.put<JobDefinition>(url, jobDefinition);
  }

  approveJobDefinition(workspaceId: number, jobDefinitionId: number, status: 'pending_review' | 'approved'): Observable<JobDefinition> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/job-definitions/${jobDefinitionId}/approve`;
    return this.http.put<JobDefinition>(url, { status });
  }

  getJobDefinitions(workspaceId: number): Observable<JobDefinition[]> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/job-definitions`;
    return this.http.get<JobDefinitionApiResponse[]>(url).pipe(
      map((definitions: JobDefinitionApiResponse[]) => definitions.map(def => ({
        id: def.id,
        status: def.status,
        assignedVariables: def.assigned_variables,
        assignedVariableBundles: def.assigned_variable_bundles,
        assignedCoders: def.assigned_coders,
        durationSeconds: def.duration_seconds,
        maxCodingCases: def.max_coding_cases,
        doubleCodingAbsolute: def.double_coding_absolute,
        doubleCodingPercentage: def.double_coding_percentage,
        createdAt: def.created_at,
        updatedAt: def.updated_at
      })))
    );
  }

  deleteJobDefinition(workspaceId: number, jobDefinitionId: number): Observable<{ success: boolean; message: string }> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/job-definitions/${jobDefinitionId}`;
    return this.http.delete<{ success: boolean; message: string }>(url);
  }

  exportCodingResultsAggregated(workspaceId: number): Observable<Blob> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/export/aggregated`;
    return this.http.get(url, {
      responseType: 'blob',
      headers: this.authHeader
    });
  }

  exportCodingResultsByCoder(workspaceId: number): Observable<Blob> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/export/by-coder`;
    return this.http.get(url, {
      responseType: 'blob',
      headers: this.authHeader
    });
  }

  exportCodingResultsByVariable(workspaceId: number): Observable<Blob> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/export/by-variable`;
    return this.http.get(url, {
      responseType: 'blob',
      headers: this.authHeader
    });
  }

  exportCodingResultsDetailed(workspaceId: number): Observable<Blob> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/export/detailed`;
    return this.http.get(url, {
      responseType: 'blob',
      headers: this.authHeader
    });
  }

  exportCodingTimesReport(workspaceId: number): Observable<Blob> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/export/coding-times`;
    return this.http.get(url, {
      responseType: 'blob',
      headers: this.authHeader
    });
  }

  // Background export job methods
  startExportJob(workspaceId: number, exportConfig: {
    exportType: 'aggregated' | 'by-coder' | 'by-variable' | 'detailed' | 'coding-times';
    userId: number;
    outputCommentsInsteadOfCodes?: boolean;
    includeReplayUrl?: boolean;
    anonymizeCoders?: boolean;
    usePseudoCoders?: boolean;
    doubleCodingMethod?: 'new-row-per-variable' | 'new-column-per-coder' | 'most-frequent';
    includeComments?: boolean;
    includeModalValue?: boolean;
    includeDoubleCoded?: boolean;
    excludeAutoCoded?: boolean;
    authToken?: string;
  }): Observable<{ jobId: string; message: string }> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/export/start`;
    return this.http.post<{ jobId: string; message: string }>(url, exportConfig, {
      headers: this.authHeader
    });
  }

  getExportJobStatus(workspaceId: number, jobId: string): Observable<{
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
  }> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/export/job/${jobId}`;
    return this.http.get<{
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
    }>(url, {
      headers: this.authHeader
    });
  }

  downloadExportFile(workspaceId: number, jobId: string): Observable<Blob> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/export/job/${jobId}/download`;
    return this.http.get(url, {
      responseType: 'blob',
      headers: this.authHeader
    });
  }

  getExportJobs(workspaceId: number): Observable<Array<{
    jobId: string;
    status: string;
    progress: number;
    exportType: string;
    createdAt: number;
  }>> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/export/jobs`;
    return this.http.get<Array<{
      jobId: string;
      status: string;
      progress: number;
      exportType: string;
      createdAt: number;
    }>>(url, {
      headers: this.authHeader
    });
  }

  deleteExportJob(workspaceId: number, jobId: string): Observable<{ success: boolean; message: string }> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/export/job/${jobId}`;
    return this.http.delete<{ success: boolean; message: string }>(url, {
      headers: this.authHeader
    });
  }

  cancelExportJob(workspaceId: number, jobId: string): Observable<{ success: boolean; message: string }> {
    const url = `${this.serverUrl}admin/workspace/${workspaceId}/coding/export/job/${jobId}/cancel`;
    return this.http.post<{ success: boolean; message: string }>(url, {}, {
      headers: this.authHeader
    });
  }
}
