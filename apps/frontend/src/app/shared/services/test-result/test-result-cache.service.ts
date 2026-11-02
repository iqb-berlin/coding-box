import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { defer, Observable, of } from 'rxjs';
import { tap, map, finalize } from 'rxjs/operators';
import { SERVER_URL } from '../../../injection-tokens';

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
  private readonly pendingCacheRequests = new Map<string, symbol>();

  // Cache expiration time in milliseconds (5 minutes)
  private readonly CACHE_EXPIRATION = 5 * 60 * 1000;

  get authHeader() {
    return { Authorization: `Bearer ${localStorage.getItem('auth_token')}` };
  }

  /**
   * Get test results with caching
   * @param workspaceId The workspace ID
   * @param page Zero-based table page index; the API uses one-based pages
   * @param limit Items per page
   * @param searchText Optional search text
   * @returns Observable with test results
   */
  getTestResults(workspaceId: number, page: number, limit: number, searchText?: string): Observable<TestResultsResponse> {
    const cacheKey = this.generateCacheKey(workspaceId, page, limit, searchText);

    const params: { [key: string]: string } = {
      page: (page + 1).toString(),
      limit: limit.toString()
    };

    if (searchText && searchText.trim() !== '') {
      params.searchText = searchText.trim();
    }

    return this.loadWithCache(cacheKey, this.http.get<TestResultsResponse>(
      `${this.serverUrl}admin/workspace/${workspaceId}/test-results/`,
      {
        headers: this.authHeader,
        params: params
      }
    ).pipe(map(result => result || { data: [], total: 0 })));
  }

  /**
   * Get test results for a specific person with caching
   * @param workspaceId The workspace ID
   * @param personId The person ID
   * @returns Observable with person test results
   */
  getPersonTestResults(workspaceId: number, personId: number): Observable<PersonTestResult[]> {
    const cacheKey = this.generateCacheKey(workspaceId, personId);

    return this.loadWithCache(cacheKey, this.http.get<PersonTestResult[]>(
      `${this.serverUrl}admin/workspace/${workspaceId}/test-results/${personId}`,
      { headers: this.authHeader }
    ));
  }

  /**
   * Invalidate cache for a specific workspace
   * @param workspaceId The workspace ID to invalidate
   */
  invalidateWorkspaceCache(workspaceId: number): void {
    const prefix = `workspace_${workspaceId}_`;
    [...this.cache.keys(), ...this.pendingCacheRequests.keys()]
      .filter(key => key.startsWith(prefix))
      .forEach(key => {
        this.cache.delete(key);
        this.pendingCacheRequests.delete(key);
      });
  }

  /**
   * Clear the entire cache
   */
  clearCache(): void {
    this.cache.clear();
    this.pendingCacheRequests.clear();
  }

  private loadWithCache<T>(cacheKey: string, request: Observable<T>): Observable<T> {
    return defer(() => {
      const cachedData = this.getFromCache<T>(cacheKey);
      if (cachedData !== null) return of(cachedData);

      const requestToken = Symbol('result-cache-request');
      this.pendingCacheRequests.set(cacheKey, requestToken);
      return request.pipe(
        tap(result => {
          // A newer request or invalidation revokes this response's cache write.
          if (this.pendingCacheRequests.get(cacheKey) === requestToken) {
            this.addToCache(cacheKey, result);
          }
        }),
        finalize(() => {
          if (this.pendingCacheRequests.get(cacheKey) === requestToken) {
            this.pendingCacheRequests.delete(cacheKey);
          }
        })
      );
    });
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
