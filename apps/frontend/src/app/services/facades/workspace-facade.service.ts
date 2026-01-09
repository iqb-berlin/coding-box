import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { VariableInfo } from '@iqbspecs/variable-info/variable-info.interface';
import { UserBackendService } from '../user-backend.service';
import { ServerResponse } from '../authentication.service';
import { WorkspaceBackendService } from '../workspace-backend.service';
import { FileService, BookletUnit } from '../file.service';
import { FileBackendService } from '../file-backend.service';
import { ImportService, ImportOptions, Result } from '../import.service';
import { UnitTagService } from '../unit-tag.service';
import { UnitNoteService } from '../unit-note.service';
import { ResourcePackageService } from '../resource-package.service';
import { UnitService } from '../unit.service';
import { UserInListDto } from '../../../../../../api-dto/user/user-in-list-dto';
import { UserWorkspaceAccessDto } from '../../../../../../api-dto/workspaces/user-workspace-access-dto';
import { UserFullDto } from '../../../../../../api-dto/user/user-full-dto';
import { CreateUserDto } from '../../../../../../api-dto/user/create-user-dto';
import { PaginatedWorkspacesDto } from '../../../../../../api-dto/workspaces/paginated-workspaces-dto';
import { PaginatedWorkspaceUserDto } from '../../../../../../api-dto/workspaces/paginated-workspace-user-dto';
import { CreateWorkspaceDto } from '../../../../../../api-dto/workspaces/create-workspace-dto';
import { WorkspaceFullDto } from '../../../../../../api-dto/workspaces/workspace-full-dto';
import { CreateUnitTagDto } from '../../../../../../api-dto/unit-tags/create-unit-tag.dto';
import { UnitTagDto } from '../../../../../../api-dto/unit-tags/unit-tag.dto';
import { CreateUnitNoteDto } from '../../../../../../api-dto/unit-notes/create-unit-note.dto';
import { UnitNoteDto } from '../../../../../../api-dto/unit-notes/unit-note.dto';
import { FileDownloadDto } from '../../../../../../api-dto/files/file-download.dto';
import { FileValidationResultDto } from '../../../../../../api-dto/files/file-validation-result.dto';
import { TestFilesUploadResultDto } from '../../../../../../api-dto/files/test-files-upload-result.dto';
import { TestResultsUploadResultDto } from '../../../../../../api-dto/files/test-results-upload-result.dto';
import { FilesInListDto } from '../../../../../../api-dto/files/files-in-list.dto';
import { FilesDto } from '../../../../../../api-dto/files/files.dto';
import { BookletInfoDto } from '../../../../../../api-dto/booklet-info/booklet-info.dto';
import { UnitInfoDto } from '../../../../../../api-dto/unit-info/unit-info.dto';
import { ResourcePackageDto } from '../../../../../../api-dto/resource-package/resource-package-dto';
import { TestGroupsInfoDto } from '../../../../../../api-dto/files/test-groups-info.dto';
import { UnitVariableDetailsDto } from '../../models/unit-variable-details.dto';

interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

@Injectable({
  providedIn: 'root'
})
export class WorkspaceFacadeService {
  private userBackendService = inject(UserBackendService);
  private workspaceBackendService = inject(WorkspaceBackendService);
  private fileService = inject(FileService);
  private fileBackendService = inject(FileBackendService);
  private importService = inject(ImportService);
  private unitTagService = inject(UnitTagService);
  private unitNoteService = inject(UnitNoteService);
  private resourcePackageService = inject(ResourcePackageService);
  private unitService = inject(UnitService);

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

  getNotesForMultipleUnits(workspaceId: number, unitIds: number[]): Observable<{ [unitId: number]: UnitNoteDto[] }> {
    return this.unitNoteService.getNotesForMultipleUnits(workspaceId, unitIds);
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

  deleteUnit(workspaceId: number, unitId: number): Observable<{ success: boolean; report: { deletedUnit: number | null; warnings: string[] } }> {
    return this.unitService.deleteUnit(workspaceId, unitId);
  }

  deleteMultipleUnits(workspaceId: number, unitIds: number[]): Observable<{ success: boolean; report: { deletedUnits: number[]; warnings: string[] } }> {
    return this.unitService.deleteMultipleUnits(workspaceId, unitIds);
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

  downloadWorkspaceFilesAsZip(workspaceId: number, fileTypes?: string[]): Observable<Blob> {
    return this.fileBackendService.downloadWorkspaceFilesAsZip(workspaceId, fileTypes);
  }

  getUnitVariables(workspaceId: number): Observable<UnitVariableDetailsDto[]> {
    return this.fileBackendService.getUnitVariables(workspaceId);
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

  authenticate(username: string, password: string, server: string, url: string): Observable<ServerResponse> {
    return this.userBackendService.authenticate(username, password, server, url);
  }

  createDummyTestTakerFile(workspaceId: number): Observable<boolean> {
    return this.fileService.createDummyTestTakerFile(workspaceId);
  }
}
