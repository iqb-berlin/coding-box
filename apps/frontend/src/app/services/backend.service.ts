import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { FilesInListDto } from 'api-dto/files/files-in-list.dto';
import { UnitNoteDto } from 'api-dto/unit-notes/unit-note.dto';
import { UpdateUnitTagDto } from 'api-dto/unit-tags/update-unit-tag.dto';
import { UnitTagDto } from 'api-dto/unit-tags/unit-tag.dto';
import { CreateUnitTagDto } from 'api-dto/unit-tags/create-unit-tag.dto';
import { CreateWorkspaceDto } from 'api-dto/workspaces/create-workspace-dto';
import { PaginatedWorkspacesDto } from 'api-dto/workspaces/paginated-workspaces-dto';
import { AppService } from './app.service';
import { TestGroupsInfoDto } from '../../../../../api-dto/files/test-groups-info.dto';
import { SERVER_URL } from '../injection-tokens';
import { UserService } from './user.service';
import { WorkspaceService } from './workspace.service';
import { FileService } from './file.service';
import { CodingService } from './coding.service';
import { UnitTagService } from './unit-tag.service';
import { UnitNoteService } from './unit-note.service';
import { ResponseService } from './response.service';
import { TestResultService } from './test-result.service';
import { ResourcePackageService } from './resource-package.service';
import { ValidationService } from './validation.service';
import { UnitService } from './unit.service';
// eslint-disable-next-line import/no-cycle
import { ImportService } from './import.service';
import { AuthenticationService } from './authentication.service';
import { VariableAnalysisService, VariableAnalysisResultDto } from './variable-analysis.service';
import { VariableAnalysisJobDto } from '../models/variable-analysis-job.dto';
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
import { ImportOptions, Result } from '../ws-admin/components/test-center-import/test-center-import.component';
import { UpdateUnitNoteDto } from '../../../../../api-dto/unit-notes/update-unit-note.dto';
import { ResponseDto } from '../../../../../api-dto/responses/response-dto';
import { InvalidVariableDto } from '../../../../../api-dto/files/variable-validation.dto';

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

interface ResponseEntity {
  id: number;
  unitId: number;
  variableId: string;
  status: string;
  value: string;
  subform: string;
  code: number;
  score: number;
  codedStatus: string;
  unit?: {
    name: string;
    alias: string;
    booklet?: {
      person?: {
        login: string;
        code: string;
      };
      bookletinfo?: {
        name: string;
      };
    };
  };
}

@Injectable({
  providedIn: 'root'
})
export class BackendService {
  readonly serverUrl = inject(SERVER_URL);
  appService = inject(AppService);

  // Inject specialized services
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
  }> {
    return this.codingService.codeTestPersons(workspace_id, testPersonIds);
  }

  getCodingList(workspace_id: number, page: number = 1, limit: number = 100): Observable<PaginatedResponse<CodingListItem>> {
    return this.codingService.getCodingList(workspace_id, page, limit);
  }

  getCodingListAsCsv(workspace_id: number): Observable<ArrayBuffer> {
    return this.codingService.getCodingListAsCsv(workspace_id);
  }

  getCodingListAsExcel(workspace_id: number): Observable<ArrayBuffer> {
    return this.codingService.getCodingListAsExcel(workspace_id);
  }

  getCodingStatistics(workspace_id: number): Observable<CodingStatistics> {
    return this.codingService.getCodingStatistics(workspace_id);
  }

  getResponsesByStatus(workspace_id: number, status: string, page: number = 1, limit: number = 100): Observable<PaginatedResponse<ResponseEntity>> {
    return this.codingService.getResponsesByStatus(workspace_id, status, page, limit);
  }

  changeWorkspace(workspaceData: WorkspaceFullDto): Observable<boolean> {
    return this.workspaceService.changeWorkspace(workspaceData);
  }

  uploadTestFiles(workspaceId: number, files: FileList | null): Observable<number> {
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

  // Unit Tags API methods

  createUnitTag(workspaceId: number, createUnitTagDto: CreateUnitTagDto): Observable<UnitTagDto> {
    return this.unitTagService.createUnitTag(workspaceId, createUnitTagDto);
  }

  getUnitTags(workspaceId: number, unitId: number): Observable<UnitTagDto[]> {
    return this.unitTagService.getUnitTags(workspaceId, unitId);
  }

  getUnitTag(workspaceId: number, tagId: number): Observable<UnitTagDto> {
    return this.unitTagService.getUnitTag(workspaceId, tagId);
  }

  updateUnitTag(workspaceId: number, tagId: number, updateUnitTagDto: UpdateUnitTagDto): Observable<UnitTagDto> {
    return this.unitTagService.updateUnitTag(workspaceId, tagId, updateUnitTagDto);
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

  getUnitNote(workspaceId: number, noteId: number): Observable<UnitNoteDto> {
    return this.unitNoteService.getUnitNote(workspaceId, noteId);
  }

  updateUnitNote(workspaceId: number, noteId: number, updateUnitNoteDto: UpdateUnitNoteDto): Observable<UnitNoteDto> {
    return this.unitNoteService.updateUnitNote(workspaceId, noteId, updateUnitNoteDto);
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

  getTestPersons(workspaceId: number): Observable<number[]> {
    return this.testResultService.getTestPersons(workspaceId);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getTestResults(workspaceId: number, page: number, limit: number, searchText?: string): Observable<any> {
    return this.testResultService.getTestResults(workspaceId, page, limit, searchText);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getPersonTestResults(workspaceId: number, personId: number): Observable<any[]> {
    return this.testResultService.getPersonTestResults(workspaceId, personId);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  authenticate(username:string, password:string, server:string, url:string): Observable<any> {
    return this.authenticationService.authenticate(username, password, server, url);
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
    searchParams: { value?: string; variableId?: string; unitName?: string; status?: string; codedStatus?: string; group?: string; code?: string },
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

  deleteMultipleResponses(workspaceId: number, responseIds: number[]): Observable<{
    success: boolean;
    report: {
      deletedResponses: number[];
      warnings: string[];
    };
  }> {
    return this.responseService.deleteMultipleResponses(workspaceId, responseIds);
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

  deleteInvalidResponses(workspaceId: number, responseIds: number[]): Observable<number> {
    return this.validationService.deleteInvalidResponses(workspaceId, responseIds);
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

  getVariableAnalysisJob(
    workspaceId: number,
    jobId: number
  ): Observable<VariableAnalysisJobDto> {
    return this.variableAnalysisService.getAnalysisJob(workspaceId, jobId);
  }

  getVariableAnalysisResults(
    workspaceId: number,
    jobId: number
  ): Observable<VariableAnalysisResultDto> {
    return this.variableAnalysisService.getAnalysisResults(workspaceId, jobId);
  }
}
