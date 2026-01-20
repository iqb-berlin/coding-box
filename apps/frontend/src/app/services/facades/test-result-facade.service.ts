import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  TestResultService, PersonTestResult, UnitLogRow, BookletLogsForUnitResponse
} from '../test-result.service';
import { TestResultBackendService, TestResultExportJob } from '../test-result-backend.service';
import { ResponseService } from '../response.service';
import { FileService } from '../file.service';
import { ResponseDto } from '../../../../../../api-dto/responses/response-dto';
import { TestResultsUploadResultDto } from '../../../../../../api-dto/files/test-results-upload-result.dto';

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
export class TestResultFacadeService {
  private testResultService = inject(TestResultService);
  private testResultBackendService = inject(TestResultBackendService);
  private responseService = inject(ResponseService);
  private fileService = inject(FileService);

  getTestPersons(workspaceId: number): Observable<number[]> {
    return this.testResultService.getTestPersons(workspaceId);
  }

  getUnitLogs(workspaceId: number, unitId: number): Observable<UnitLogRow[]> {
    return this.testResultService.getUnitLogs(workspaceId, unitId);
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

  searchBookletsByName(workspaceId: number, bookletName: string, page?: number, limit?: number): Observable<{ data: SearchBookletItem[]; total: number }> {
    return this.testResultService.searchBookletsByName(workspaceId, bookletName, page, limit);
  }

  searchUnitsByName(workspaceId: number, unitName: string, page?: number, limit?: number): Observable<{ data: SearchUnitItem[]; total: number }> {
    return this.testResultService.searchUnitsByName(workspaceId, unitName, page, limit);
  }

  deleteBooklet(workspaceId: number, bookletId: number): Observable<{ success: boolean; report: { deletedBooklet: number | null; warnings: string[] } }> {
    return this.testResultService.deleteBooklet(workspaceId, bookletId);
  }

  uploadTestResults(workspaceId: number, files: FileList | null, resultType: 'logs' | 'responses', overwriteExisting: boolean = true, overwriteMode: 'skip' | 'merge' | 'replace' = 'skip', scope: string = 'person', filters?: Record<string, unknown>): Observable<TestResultsUploadResultDto> {
    return this.fileService.uploadTestResults(workspaceId, files, resultType, overwriteExisting, overwriteMode, scope, filters);
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

  deleteTestPersons(workspaceId: number, testPersonIds: number[]): Observable<boolean> {
    return this.responseService.deleteTestPersons(workspaceId, testPersonIds);
  }
}
