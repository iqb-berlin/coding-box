import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { SERVER_URL } from '../../injection-tokens';
import {
  TestcenterConnectionTestDto, TestcenterInstanceDto, TestcenterInstanceInput
} from '../../../../../../api-dto/testcenter/testcenter-instance.dto';

@Injectable({ providedIn: 'root' })
export class TestcenterInstancesService {
  private readonly http = inject(HttpClient);
  private readonly serverUrl = inject(SERVER_URL);

  getInstances(): Observable<TestcenterInstanceDto[]> {
    return this.http.get<TestcenterInstanceDto[]>(`${this.serverUrl}admin/testcenter/instances`);
  }

  saveInstance(instance: TestcenterInstanceInput): Observable<TestcenterInstanceDto[]> {
    return this.http.post<TestcenterInstanceDto[]>(`${this.serverUrl}admin/testcenter/instances`, instance);
  }

  deleteInstance(baseUrl: string): Observable<TestcenterInstanceDto[]> {
    return this.http.delete<TestcenterInstanceDto[]>(`${this.serverUrl}admin/testcenter/instances`, { body: { baseUrl } });
  }

  testConnection(baseUrl: string): Observable<TestcenterConnectionTestDto> {
    return this.http.post<TestcenterConnectionTestDto>(`${this.serverUrl}admin/testcenter/instances/test`, { baseUrl });
  }
}
