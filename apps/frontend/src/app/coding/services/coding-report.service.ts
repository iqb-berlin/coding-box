import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { CodingReportDto } from '../components/coding-report/src/lib/coding-report-dto';

@Injectable({ providedIn: 'root' })
export class CodingReportService {
  constructor(private http: HttpClient) {}

  getCodingReport(workspaceId: number, page: number = 1, pageSize: number = 50): Observable<{ rows: CodingReportDto[]; total: number; page: number; pageSize: number }> {
    return this.http.get<{ rows: CodingReportDto[]; total: number; page: number; pageSize: number }>(
      `/api/admin/workspace/${workspaceId}/coding-report`,
      { params: { page: page.toString(), pageSize: pageSize.toString() } }
    );
  }
}
