import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { HttpClient, HttpParams } from '@angular/common/http';
import { catchError, map } from 'rxjs/operators';
import { SERVER_URL } from '../../injection-tokens';
import { AppService } from '../../services/app.service';
import { VariableBundle } from '../models/coding-job.model';

export interface PaginatedBundles {
  bundles: VariableBundle[];
  total: number;
  page: number;
  limit: number;
}

@Injectable({
  providedIn: 'root'
})
export class VariableBundleService {
  private http = inject(HttpClient);
  private readonly serverUrl = inject(SERVER_URL);
  private appService = inject(AppService);
  private bundlesSubject = new BehaviorSubject<VariableBundle[]>([]);

  constructor() {
    this.bundlesSubject.next([]);
  }

  getBundles(page: number = 1, limit: number = 10): Observable<PaginatedBundles> {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return of({
        bundles: [], total: 0, page, limit
      });
    }
    const baseUrl = this.serverUrl.endsWith('/') ? this.serverUrl.slice(0, -1) : this.serverUrl;
    const url = `${baseUrl}/admin/workspace/${workspaceId}/variable-bundle`;

    const params = new HttpParams()
      .set('page', page.toString())
      .set('limit', limit.toString());

    interface BackendVariableBundle {
      id: number;
      workspace_id: number;
      name: string;
      description?: string;
      variables: Array<{ unitName: string; variableId: string }>;
      created_at: string;
      updated_at: string;
    }

    return this.http.get<BackendVariableBundle[] | { data: BackendVariableBundle[], total: number, page: number, limit: number }>(url, { params }).pipe(
      map(response => {
        const bundleData = Array.isArray(response) ? response : response.data;
        const total = Array.isArray(response) ? bundleData.length : response.total;
        const responsePage = Array.isArray(response) ? page : response.page;
        const responseLimit = Array.isArray(response) ? limit : response.limit;

        const bundles = bundleData.map(bundle => ({
          id: bundle.id,
          name: bundle.name,
          description: bundle.description,
          createdAt: new Date(bundle.created_at),
          updatedAt: new Date(bundle.updated_at),
          variables: bundle.variables || []
        } as VariableBundle));

        this.bundlesSubject.next(bundles);

        return {
          bundles,
          total,
          page: responsePage,
          limit: responseLimit
        };
      }),
      catchError(error => {
        console.error('Error fetching variable bundles:', error);
        throw error;
      })
    );
  }

  createBundle(bundle: Omit<VariableBundle, 'id'>): Observable<VariableBundle> {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return of({
        ...bundle,
        id: this.getNextId()
      } as VariableBundle);
    }

    const baseUrl = this.serverUrl.endsWith('/') ? this.serverUrl.slice(0, -1) : this.serverUrl;
    const url = `${baseUrl}/admin/workspace/${workspaceId}/variable-bundle`;

    interface BackendVariableBundle {
      id: number;
      workspace_id: number;
      name: string;
      description?: string;
      variables: Array<{ unitName: string; variableId: string }>;
      created_at: string;
      updated_at: string;
    }

    const requestPayload = {
      name: bundle.name,
      description: bundle.description,
      variables: bundle.variables
    };

    return this.http.post<BackendVariableBundle>(url, requestPayload).pipe(
      map(response => {
        const newBundle: VariableBundle = {
          id: response.id,
          name: response.name,
          description: response.description,
          createdAt: new Date(response.created_at),
          updatedAt: new Date(response.updated_at),
          variables: response.variables || []
        };

        const updatedBundles = [...this.bundlesSubject.value, newBundle];
        this.bundlesSubject.next(updatedBundles);

        return newBundle;
      }),
      catchError(error => {
        throw error;
      })
    );
  }

  updateBundle(id: number, bundle: Partial<VariableBundle>): Observable<VariableBundle | undefined> {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return of(undefined);
    }

    const baseUrl = this.serverUrl.endsWith('/') ? this.serverUrl.slice(0, -1) : this.serverUrl;
    const url = `${baseUrl}/admin/workspace/${workspaceId}/variable-bundle/${id}`;

    const updateData = {
      name: bundle.name,
      description: bundle.description,
      variables: bundle.variables
    };

    interface BackendVariableBundle {
      id: number;
      workspace_id: number;
      name: string;
      description?: string;
      variables: Array<{ unitName: string; variableId: string }>;
      created_at: string;
      updated_at: string;
    }

    return this.http.put<BackendVariableBundle>(url, updateData).pipe(
      map(response => {
        const updatedBundleGroup: VariableBundle = {
          id: response.id,
          name: response.name,
          description: response.description,
          createdAt: new Date(response.created_at),
          updatedAt: new Date(response.updated_at),
          variables: response.variables || []
        };

        const bundles = this.bundlesSubject.value;
        const index = bundles.findIndex(b => b.id === id);

        if (index !== -1) {
          const updatedBundleGroups = [...bundles];
          updatedBundleGroups[index] = updatedBundleGroup;
          this.bundlesSubject.next(updatedBundleGroups);
        }

        return updatedBundleGroup;
      }),
      catchError(error => {
        throw error;
      })
    );
  }

  deleteBundle(id: number): Observable<boolean> {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return of(false);
    }

    const baseUrl = this.serverUrl.endsWith('/') ? this.serverUrl.slice(0, -1) : this.serverUrl;
    const url = `${baseUrl}/admin/workspace/${workspaceId}/variable-bundle/${id}`;

    return this.http.delete<{ success: boolean }>(url).pipe(
      map(response => {
        if (response.success) {
          const bundleGroups = this.bundlesSubject.value;
          const updatedBundles = bundleGroups.filter(group => group.id !== id);
          this.bundlesSubject.next(updatedBundles);
        }

        return response.success;
      }),
      catchError(error => {
        throw error;
      })
    );
  }

  private getNextId(): number {
    const bundleGroups = this.bundlesSubject.value;
    return bundleGroups.length > 0 ?
      Math.max(...bundleGroups.map(group => group.id)) + 1 :
      1;
  }
}
