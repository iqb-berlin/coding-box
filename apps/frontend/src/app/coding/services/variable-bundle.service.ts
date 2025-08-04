import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { catchError, map, take } from 'rxjs/operators';
import { SERVER_URL } from '../../injection-tokens';
import { AppService } from '../../services/app.service';
import { VariableBundle, Variable } from '../models/coding-job.model';

@Injectable({
  providedIn: 'root'
})
export class VariableBundleService {
  private http = inject(HttpClient);
  private readonly serverUrl = inject(SERVER_URL);
  private appService = inject(AppService);
  private bundlesSubject = new BehaviorSubject<VariableBundle[]>([]);

  private sampleBundles: VariableBundle[] = [
    {
      id: 1,
      name: 'Mathematische Fähigkeiten',
      description: 'Variablen zur Bewertung mathematischer Fähigkeiten',
      createdAt: new Date('2023-01-01'),
      updatedAt: new Date('2023-01-15'),
      variables: [
        { unitName: 'math101', variableId: 'addition' },
        { unitName: 'math101', variableId: 'subtraction' },
        { unitName: 'math102', variableId: 'multiplication' }
      ]
    },
    {
      id: 2,
      name: 'Sprachliche Fähigkeiten',
      description: 'Variablen zur Bewertung sprachlicher Fähigkeiten',
      createdAt: new Date('2023-02-01'),
      updatedAt: new Date('2023-02-15'),
      variables: [
        { unitName: 'lang101', variableId: 'grammar' },
        { unitName: 'lang101', variableId: 'vocabulary' },
        { unitName: 'lang102', variableId: 'comprehension' }
      ]
    }
  ];

  constructor() {
    this.bundlesSubject.next(this.sampleBundles);
  }

  getBundleGroups(): Observable<VariableBundle[]> {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return of([]);
    }
    const baseUrl = this.serverUrl.endsWith('/') ? this.serverUrl.slice(0, -1) : this.serverUrl;
    const url = `${baseUrl}/admin/workspace/${workspaceId}/variable-bundle`;

    return this.http.get<{ data: VariableBundle[], total: number }>(url).pipe(
      map(response => {
        const bundles = response.data;
        this.bundlesSubject.next(bundles);

        return bundles;
      }),
      catchError(() => this.bundlesSubject.asObservable().pipe(
        take(1)
      )
      )
    );
  }

  getBundleById(id: number): Observable<VariableBundle | undefined> {
    const bundles = this.bundlesSubject.value;
    const bundle = bundles.find(b => b.id === id);
    return of(bundle);
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

    return this.http.post<VariableBundle>(url, bundle).pipe(
      map(newBundle => {
        const updatedBundles = [...this.bundlesSubject.value, newBundle];
        this.bundlesSubject.next(updatedBundles);

        return newBundle;
      }),
      catchError(() => {
        const newBundle: VariableBundle = {
          ...bundle,
          id: this.getNextId()
        };

        const updatedBundle = [...this.bundlesSubject.value, newBundle];
        this.bundlesSubject.next(updatedBundle);

        return of(newBundle);
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
      ...bundle,
      updatedAt: new Date()
    };

    return this.http.put<VariableBundle>(url, updateData).pipe(
      map(updatedBundleGroup => {
        // Update the local state with the updated bundle group
        const bundles = this.bundlesSubject.value;
        const index = bundles.findIndex(b => b.id === id);

        if (index !== -1) {
          const updatedBundleGroups = [...bundles];
          updatedBundleGroups[index] = updatedBundleGroup;
          this.bundlesSubject.next(updatedBundleGroups);
        }

        return updatedBundleGroup;
      }),
      catchError(() => {
        const bundles = this.bundlesSubject.value;
        const index = bundles.findIndex(b => b.id === id);

        if (index === -1) {
          return of(undefined);
        }

        const updatedBundle: VariableBundle = {
          ...bundles[index],
          ...bundle,
          updatedAt: new Date()
        };

        const updatedBundleGroups = [...bundles];
        updatedBundleGroups[index] = updatedBundle;

        this.bundlesSubject.next(updatedBundleGroups);

        return of(updatedBundle);
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
      catchError(() => {
        const bundles = this.bundlesSubject.value;
        const updatedBundles = bundles.filter(b => b.id !== id);

        if (updatedBundles.length === bundles.length) {
          return of(false);
        }

        this.bundlesSubject.next(updatedBundles);

        return of(true);
      })
    );
  }

  addVariableToBundle(bundleId: number, variable: Variable): Observable<VariableBundle | undefined> {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return of(undefined);
    }

    const baseUrl = this.serverUrl.endsWith('/') ? this.serverUrl.slice(0, -1) : this.serverUrl;
    const url = `${baseUrl}/admin/workspace/${workspaceId}/variable-bundle/${bundleId}/variables`;

    return this.http.post<VariableBundle>(url, variable).pipe(
      map(updatedBundle => {
        const bundles = this.bundlesSubject.value;
        const index = bundles.findIndex(b => b.id === bundleId);

        if (index !== -1) {
          const updatedBundles = [...bundles];
          updatedBundles[index] = updatedBundle;
          this.bundlesSubject.next(updatedBundles);
        }

        return updatedBundle;
      }),
      catchError(() => {
        const bundles = this.bundlesSubject.value;
        const index = bundles.findIndex(b => b.id === bundleId);

        if (index === -1) {
          return of(undefined);
        }

        const bundle = bundles[index];

        const variableExists = bundle.variables.some(
          v => v.unitName === variable.unitName && v.variableId === variable.variableId
        );

        if (variableExists) {
          return of(bundle);
        }

        const updatedBundle: VariableBundle = {
          ...bundle,
          variables: [...bundle.variables, variable as Variable],
          updatedAt: new Date()
        };

        const updatedBundles = [...bundles];
        updatedBundles[index] = updatedBundle;

        this.bundlesSubject.next(updatedBundles);

        return of(updatedBundle);
      })
    );
  }

  removeVariableFromBundle(groupId: number, variable: Variable): Observable<VariableBundle | undefined> {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return of(undefined);
    }

    const encodedUnitName = encodeURIComponent((variable as Variable).unitName);
    const encodedVariableId = encodeURIComponent((variable as Variable).variableId);

    const baseUrl = this.serverUrl.endsWith('/') ? this.serverUrl.slice(0, -1) : this.serverUrl;
    const url = `${baseUrl}/admin/workspace/${workspaceId}/variable-bundle/${groupId}/variables/${encodedUnitName}/${encodedVariableId}`;

    return this.http.delete<VariableBundle>(url).pipe(
      map(updatedBundle => {
        const bundles = this.bundlesSubject.value;
        const index = bundles.findIndex(group => group.id === groupId);

        if (index !== -1) {
          const updatedBundles = [...bundles];
          updatedBundles[index] = updatedBundle;
          this.bundlesSubject.next(updatedBundles);
        }

        return updatedBundle;
      }),
      catchError(() => {
        const bundles = this.bundlesSubject.value;
        const index = bundles.findIndex(group => group.id === groupId);

        if (index === -1) {
          return of(undefined);
        }

        const bundle = bundles[index];

        const updatedVariables = bundle.variables.filter(
          v => !(v.unitName === (variable as Variable).unitName && v.variableId === (variable as Variable).variableId)
        );

        const updatedBundle: VariableBundle = {
          ...bundle,
          variables: updatedVariables,
          updatedAt: new Date()
        };

        const updatedBundles = [...bundles];
        updatedBundles[index] = updatedBundle;

        this.bundlesSubject.next(updatedBundles);

        return of(updatedBundle);
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
