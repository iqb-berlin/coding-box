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
  private bundleGroupsSubject = new BehaviorSubject<VariableBundle[]>([]);

  // Sample data for demonstration
  private sampleBundleGroups: VariableBundle[] = [
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
    // Initialize with sample data
    this.bundleGroupsSubject.next(this.sampleBundleGroups);
  }

  /**
   * Gets all variable bundle groups
   */
  getBundleGroups(): Observable<VariableBundle[]> {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return of([]);
    }

    // Remove trailing slash from serverUrl if present to avoid double slashes
    const baseUrl = this.serverUrl.endsWith('/') ? this.serverUrl.slice(0, -1) : this.serverUrl;
    const url = `${baseUrl}/admin/workspace/${workspaceId}/variable-bundle-groups`;

    return this.http.get<{ data: VariableBundle[], total: number }>(url).pipe(
      map(response => {
        const bundleGroups = response.data;

        // Update the subject with the fetched bundle groups
        this.bundleGroupsSubject.next(bundleGroups);

        return bundleGroups;
      }),
      catchError(() => this.bundleGroupsSubject.asObservable().pipe(
        take(1)
      )
      )
    );
  }

  /**
   * Gets a variable bundle group by ID
   * @param id The ID of the bundle group
   */
  getBundleGroupById(id: number): Observable<VariableBundle | undefined> {
    const bundleGroups = this.bundleGroupsSubject.value;
    const bundleGroup = bundleGroups.find(group => group.id === id);
    return of(bundleGroup);
  }

  /**
   * Creates a new variable bundle group
   * @param bundleGroup The bundle group to create (without ID)
   */
  createBundleGroup(bundleGroup: Omit<VariableBundle, 'id'>): Observable<VariableBundle> {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return of({
        ...bundleGroup,
        id: this.getNextId()
      } as VariableBundle);
    }

    // Remove trailing slash from serverUrl if present to avoid double slashes
    const baseUrl = this.serverUrl.endsWith('/') ? this.serverUrl.slice(0, -1) : this.serverUrl;
    const url = `${baseUrl}/admin/workspace/${workspaceId}/variable-bundle-groups`;

    return this.http.post<VariableBundle>(url, bundleGroup).pipe(
      map(newBundleGroup => {
        // Update the local state with the new bundle group
        const updatedBundleGroups = [...this.bundleGroupsSubject.value, newBundleGroup];
        this.bundleGroupsSubject.next(updatedBundleGroups);

        return newBundleGroup;
      }),
      catchError(() => {
        // Fallback to local creation if API call fails
        const newBundleGroup: VariableBundle = {
          ...bundleGroup,
          id: this.getNextId()
        };

        const updatedBundleGroups = [...this.bundleGroupsSubject.value, newBundleGroup];
        this.bundleGroupsSubject.next(updatedBundleGroups);

        return of(newBundleGroup);
      })
    );
  }

  /**
   * Updates an existing variable bundle group
   * @param id The ID of the bundle group to update
   * @param bundleGroup The updated bundle group data
   */
  updateBundleGroup(id: number, bundleGroup: Partial<VariableBundle>): Observable<VariableBundle | undefined> {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return of(undefined);
    }

    // Remove trailing slash from serverUrl if present to avoid double slashes
    const baseUrl = this.serverUrl.endsWith('/') ? this.serverUrl.slice(0, -1) : this.serverUrl;
    const url = `${baseUrl}/admin/workspace/${workspaceId}/variable-bundle-groups/${id}`;

    // Ensure updatedAt is set to current date
    const updateData = {
      ...bundleGroup,
      updatedAt: new Date()
    };

    return this.http.put<VariableBundle>(url, updateData).pipe(
      map(updatedBundleGroup => {
        // Update the local state with the updated bundle group
        const bundleGroups = this.bundleGroupsSubject.value;
        const index = bundleGroups.findIndex(group => group.id === id);

        if (index !== -1) {
          const updatedBundleGroups = [...bundleGroups];
          updatedBundleGroups[index] = updatedBundleGroup;
          this.bundleGroupsSubject.next(updatedBundleGroups);
        }

        return updatedBundleGroup;
      }),
      catchError(() => {
        // Fallback to local update if API call fails
        const bundleGroups = this.bundleGroupsSubject.value;
        const index = bundleGroups.findIndex(group => group.id === id);

        if (index === -1) {
          return of(undefined);
        }

        const updatedBundleGroup: VariableBundle = {
          ...bundleGroups[index],
          ...bundleGroup,
          updatedAt: new Date()
        };

        const updatedBundleGroups = [...bundleGroups];
        updatedBundleGroups[index] = updatedBundleGroup;

        this.bundleGroupsSubject.next(updatedBundleGroups);

        return of(updatedBundleGroup);
      })
    );
  }

  /**
   * Deletes a variable bundle group
   * @param id The ID of the bundle group to delete
   */
  deleteBundleGroup(id: number): Observable<boolean> {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return of(false);
    }

    // Remove trailing slash from serverUrl if present to avoid double slashes
    const baseUrl = this.serverUrl.endsWith('/') ? this.serverUrl.slice(0, -1) : this.serverUrl;
    const url = `${baseUrl}/admin/workspace/${workspaceId}/variable-bundle-groups/${id}`;

    return this.http.delete<{ success: boolean }>(url).pipe(
      map(response => {
        if (response.success) {
          // Update the local state by removing the deleted bundle group
          const bundleGroups = this.bundleGroupsSubject.value;
          const updatedBundleGroups = bundleGroups.filter(group => group.id !== id);
          this.bundleGroupsSubject.next(updatedBundleGroups);
        }

        return response.success;
      }),
      catchError(() => {
        // Fallback to local deletion if API call fails
        const bundleGroups = this.bundleGroupsSubject.value;
        const updatedBundleGroups = bundleGroups.filter(group => group.id !== id);

        if (updatedBundleGroups.length === bundleGroups.length) {
          return of(false);
        }

        this.bundleGroupsSubject.next(updatedBundleGroups);

        return of(true);
      })
    );
  }

  /**
   * Adds a variable to a bundle group
   * @param groupId The ID of the bundle group
   * @param variable The variable to add
   */
  addVariableToGroup(groupId: number, variable: Variable): Observable<VariableBundle | undefined> {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return of(undefined);
    }

    // Remove trailing slash from serverUrl if present to avoid double slashes
    const baseUrl = this.serverUrl.endsWith('/') ? this.serverUrl.slice(0, -1) : this.serverUrl;
    const url = `${baseUrl}/admin/workspace/${workspaceId}/variable-bundle-groups/${groupId}/variables`;

    return this.http.post<VariableBundle>(url, variable).pipe(
      map(updatedGroup => {
        // Update the local state with the updated bundle group
        const bundleGroups = this.bundleGroupsSubject.value;
        const index = bundleGroups.findIndex(group => group.id === groupId);

        if (index !== -1) {
          const updatedBundleGroups = [...bundleGroups];
          updatedBundleGroups[index] = updatedGroup;
          this.bundleGroupsSubject.next(updatedBundleGroups);
        }

        return updatedGroup;
      }),
      catchError(() => {
        // Fallback to local addition if API call fails
        const bundleGroups = this.bundleGroupsSubject.value;
        const index = bundleGroups.findIndex(group => group.id === groupId);

        if (index === -1) {
          return of(undefined);
        }

        const group = bundleGroups[index];

        // Check if the variable already exists in the group
        const variableExists = group.variables.some(
          v => v.unitName === variable.unitName && v.variableId === variable.variableId
        );

        if (variableExists) {
          return of(group);
        }

        const updatedGroup: VariableBundle = {
          ...group,
          variables: [...group.variables, variable as Variable],
          updatedAt: new Date()
        };

        const updatedBundleGroups = [...bundleGroups];
        updatedBundleGroups[index] = updatedGroup;

        this.bundleGroupsSubject.next(updatedBundleGroups);

        return of(updatedGroup);
      })
    );
  }

  /**
   * Removes a variable from a bundle group
   * @param groupId The ID of the bundle group
   * @param variable The variable to remove
   */
  removeVariableFromGroup(groupId: number, variable: Variable): Observable<VariableBundle | undefined> {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return of(undefined);
    }

    // Encode the variable parameters for the URL
    const encodedUnitName = encodeURIComponent((variable as Variable).unitName);
    const encodedVariableId = encodeURIComponent((variable as Variable).variableId);

    // Remove trailing slash from serverUrl if present to avoid double slashes
    const baseUrl = this.serverUrl.endsWith('/') ? this.serverUrl.slice(0, -1) : this.serverUrl;
    const url = `${baseUrl}/admin/workspace/${workspaceId}/variable-bundle-groups/${groupId}/variables/${encodedUnitName}/${encodedVariableId}`;

    return this.http.delete<VariableBundle>(url).pipe(
      map(updatedGroup => {
        // Update the local state with the updated bundle group
        const bundleGroups = this.bundleGroupsSubject.value;
        const index = bundleGroups.findIndex(group => group.id === groupId);

        if (index !== -1) {
          const updatedBundleGroups = [...bundleGroups];
          updatedBundleGroups[index] = updatedGroup;
          this.bundleGroupsSubject.next(updatedBundleGroups);
        }

        return updatedGroup;
      }),
      catchError(() => {
        // Fallback to local removal if API call fails
        const bundleGroups = this.bundleGroupsSubject.value;
        const index = bundleGroups.findIndex(group => group.id === groupId);

        if (index === -1) {
          return of(undefined);
        }

        const group = bundleGroups[index];

        const updatedVariables = group.variables.filter(
          v => !(v.unitName === (variable as Variable).unitName && v.variableId === (variable as Variable).variableId)
        );

        const updatedGroup: VariableBundle = {
          ...group,
          variables: updatedVariables,
          updatedAt: new Date()
        };

        const updatedBundleGroups = [...bundleGroups];
        updatedBundleGroups[index] = updatedGroup;

        this.bundleGroupsSubject.next(updatedBundleGroups);

        return of(updatedGroup);
      })
    );
  }

  /**
   * Gets the next available ID for a new bundle group
   */
  private getNextId(): number {
    const bundleGroups = this.bundleGroupsSubject.value;
    return bundleGroups.length > 0 ?
      Math.max(...bundleGroups.map(group => group.id)) + 1 :
      1;
  }
}
