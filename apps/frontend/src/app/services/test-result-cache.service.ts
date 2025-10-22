import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { tap, catchError, map } from 'rxjs/operators';
import { SERVER_URL } from '../injection-tokens';

interface CacheEntry<T> {
  data: T;
  expires: number;
}

interface TestResultsResponse {
  data: TestResultItem[];
  total: number;
}

interface TestResultItem {
  id: number;
  code: string;
  group: string;
  login: string;
  uploaded_at: Date;
  [key: string]: unknown;
}

interface PersonTestResult {
  [key: string]: unknown;
}

@Injectable({
  providedIn: 'root'
})
export class TestResultCacheService {
  private readonly serverUrl = inject(SERVER_URL);
  private readonly http = inject(HttpClient);
  private cache = new Map<string, CacheEntry<unknown>>();

  // Cache expiration time in milliseconds (5 minutes)
  private readonly CACHE_EXPIRATION = 5 * 60 * 1000;

  get authHeader() {
    return { Authorization: `Bearer ${localStorage.getItem('id_token')}` };
  }

  /**
   * Get test results with caching
   * @param workspaceId The workspace ID
   * @param page Page number
   * @param limit Items per page
   * @param searchText Optional search text
   * @returns Observable with test results
   */
  getTestResults(workspaceId: number, page: number, limit: number, searchText?: string): Observable<TestResultsResponse> {
    const cacheKey = this.generateCacheKey(workspaceId, page, limit, searchText);
    const cachedData = this.getFromCache<TestResultsResponse>(cacheKey);

    if (cachedData) {
      return of(cachedData);
    }

    const params: { [key: string]: string } = {
      page: page.toString(),
      limit: limit.toString()
    };

    if (searchText && searchText.trim() !== '') {
      params.searchText = searchText.trim();
    }

    return this.http.get<TestResultsResponse>(
      `${this.serverUrl}admin/workspace/${workspaceId}/test-results/`,
      {
        headers: this.authHeader,
        params: params
      }
    ).pipe(
      catchError(() => of({ data: [], total: 0 })),
      map(result => result || { data: [], total: 0 }),
      tap(result => this.addToCache(cacheKey, result))
    );
  }

  /**
   * Get test results for a specific person with caching
   * @param workspaceId The workspace ID
   * @param personId The person ID
   * @returns Observable with person test results
   */
  getPersonTestResults(workspaceId: number, personId: number): Observable<PersonTestResult[]> {
    const cacheKey = this.generateCacheKey(workspaceId, personId);
    const cachedData = this.getFromCache<PersonTestResult[]>(cacheKey);

    if (cachedData) {
      return of(cachedData);
    }

    return this.http.get<PersonTestResult[]>(
      `${this.serverUrl}admin/workspace/${workspaceId}/test-results/${personId}`,
      { headers: this.authHeader }
    ).pipe(
      tap(result => this.addToCache(cacheKey, result))
    );
  }

  /**
   * Invalidate cache for a specific workspace
   * @param workspaceId The workspace ID to invalidate
   */
  invalidateWorkspaceCache(workspaceId: number): void {
    const keysToRemove: string[] = [];

    this.cache.forEach((_, key) => {
      if (key.startsWith(`workspace_${workspaceId}`)) {
        keysToRemove.push(key);
      }
    });

    keysToRemove.forEach(key => this.cache.delete(key));
  }

  /**
   * Clear the entire cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Generate a cache key based on parameters
   */
  private generateCacheKey(workspaceId: number, ...params: unknown[]): string {
    return `workspace_${workspaceId}_${params.join('_')}`;
  }

  /**
   * Get data from cache if it exists and is not expired
   */
  private getFromCache<T>(key: string): T | null {
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    if (entry.expires < Date.now()) {
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  /**
   * Add data to cache with expiration
   */
  private addToCache<T>(key: string, data: T): void {
    this.cache.set(key, {
      data,
      expires: Date.now() + this.CACHE_EXPIRATION
    });
  }
}
