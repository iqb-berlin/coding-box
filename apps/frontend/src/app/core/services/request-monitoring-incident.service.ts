import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  RequestMonitoringIncidentDto
} from '../../../../../../api-dto/request-monitoring/request-monitoring-incident.dto';
import { SERVER_URL } from '../../injection-tokens';

@Injectable({ providedIn: 'root' })
export class RequestMonitoringIncidentService {
  private readonly http = inject(HttpClient);
  private readonly serverUrl = inject(SERVER_URL);

  getAll(
    includeResolved = false,
    limit = 200
  ): Observable<RequestMonitoringIncidentDto[]> {
    const params = new HttpParams()
      .set('includeResolved', String(includeResolved))
      .set('limit', String(limit));
    return this.http.get<RequestMonitoringIncidentDto[]>(
      `${this.serverUrl}admin/request-monitoring-incidents`,
      { params }
    );
  }

  setResolved(
    id: number,
    resolved: boolean
  ): Observable<RequestMonitoringIncidentDto> {
    return this.http.patch<RequestMonitoringIncidentDto>(
      `${this.serverUrl}admin/request-monitoring-incidents/${id}/resolution`,
      { resolved }
    );
  }
}
