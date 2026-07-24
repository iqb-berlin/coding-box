import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  CodingJobBackendService,
  CodingJobUnitDto
} from '../../coding/services/coding-job-backend.service';
import type {
  ReplayCodingSessionDto,
  ReplayCodingSessionUnitDto
} from '../../../../../../api-dto/coding/replay-coding-session.dto';
import { ReplayServerTimings } from './replay-backend.service';
import {
  ReplaySessionLoadError,
  ReplaySessionLoadTimings
} from './replay-session-load.error';
import { UnitsReplay } from './units-replay.service';

export {
  ReplaySessionLoadError,
  ReplaySessionLoadTimings
} from './replay-session-load.error';

export interface ReplaySessionLoadRequest {
  workspaceId: number;
  codingJobId: number;
  authToken?: string;
  onlyOpen: boolean;
}

export type ReplaySessionLoadSource = 'session' | 'legacy';

interface ReplaySessionLoadResultBase {
  timings: ReplaySessionLoadTimings;
}

export type ReplaySessionLoadResult = ReplaySessionLoadResultBase & (
  {
    unitsData: UnitsReplay;
    session: ReplayCodingSessionDto;
    source: 'session';
  } |
  {
    unitsData: UnitsReplay | null;
    session: null;
    source: 'legacy';
  }
);

@Injectable()
export class ReplaySessionLoaderService {
  private codingJobBackendService = inject(CodingJobBackendService);
  private readonly requests = new Map<string, Promise<ReplaySessionLoadResult>>();

  getRequestKey(request: ReplaySessionLoadRequest): string {
    return `${request.workspaceId}:${request.codingJobId}:${request.onlyOpen}`;
  }

  retainOnly(request: ReplaySessionLoadRequest): string;
  retainOnly(request: null): null;
  retainOnly(request: ReplaySessionLoadRequest | null): string | null;
  retainOnly(request: ReplaySessionLoadRequest | null): string | null {
    const requestKey = request ? this.getRequestKey(request) : null;
    this.requests.forEach((_request, key) => {
      if (key !== requestKey) {
        this.requests.delete(key);
      }
    });
    return requestKey;
  }

  load(request: ReplaySessionLoadRequest): Promise<ReplaySessionLoadResult> {
    const requestKey = this.retainOnly(request);
    const pendingRequest = this.requests.get(requestKey);
    if (pendingRequest) {
      return pendingRequest;
    }

    const loadRequest = this.loadSession(request);
    this.requests.set(requestKey, loadRequest);
    return loadRequest;
  }

  discard(
    request: ReplaySessionLoadRequest,
    loadRequest: Promise<ReplaySessionLoadResult>
  ): void {
    const requestKey = this.getRequestKey(request);
    if (this.requests.get(requestKey) === loadRequest) {
      this.requests.delete(requestKey);
    }
  }

  clear(): void {
    this.requests.clear();
  }

  private async loadSession(
    request: ReplaySessionLoadRequest
  ): Promise<ReplaySessionLoadResult> {
    const requestStartedAt = performance.now();

    try {
      const session = await firstValueFrom(
        this.codingJobBackendService.getReplayCodingSession(
          request.workspaceId,
          request.codingJobId,
          request.authToken,
          request.onlyOpen
        )
      );
      const responseReceivedAt = performance.now();

      return {
        unitsData: this.createUnitsData(request.codingJobId, session.units),
        session,
        source: 'session',
        timings: {
          requestStartedAt,
          responseReceivedAt,
          serverTimings: this.prefixServerTimings(session.serverTimings)
        }
      };
    } catch (error) {
      const responseReceivedAt = performance.now();
      const httpError = error as HttpErrorResponse;
      if (httpError.status !== 404 && httpError.status !== 405) {
        throw new ReplaySessionLoadError(error, {
          requestStartedAt,
          responseReceivedAt,
          serverTimings: null
        });
      }

      try {
        const units = await firstValueFrom(
          this.codingJobBackendService.getCodingJobUnits(
            request.workspaceId,
            request.codingJobId,
            request.authToken,
            request.onlyOpen
          )
        );

        return {
          unitsData: units.length > 0 ?
            this.createUnitsData(request.codingJobId, units) :
            null,
          session: null,
          source: 'legacy',
          timings: {
            requestStartedAt,
            responseReceivedAt,
            serverTimings: null
          }
        };
      } catch (legacyError) {
        throw new ReplaySessionLoadError(legacyError, {
          requestStartedAt,
          responseReceivedAt,
          serverTimings: null
        });
      }
    }
  }

  private createUnitsData(
    codingJobId: number,
    units: Array<ReplayCodingSessionUnitDto | CodingJobUnitDto>
  ): UnitsReplay {
    return {
      id: codingJobId,
      name: `Coding-Job: ${codingJobId}`,
      units: units.map((unit, index) => ({
        id: index,
        name: unit.unitName,
        alias: unit.unitAlias,
        bookletId: 0,
        testPerson: unit.personGroup ?
          `${unit.personLogin}@${unit.personCode}@${unit.personGroup}@${unit.bookletName}` :
          `${unit.personLogin}@${unit.personCode}@${unit.bookletName}`,
        variableId: unit.variableId,
        variableAnchor: unit.variableAnchor,
        variablePage: unit.variablePage,
        variableBundleId: unit.variableBundleId,
        bundleContext: unit.bundleContext
      })),
      currentUnitIndex: 0
    };
  }

  private prefixServerTimings(
    serverTimings: ReplayCodingSessionDto['serverTimings']
  ): ReplayServerTimings {
    return Object.fromEntries(
      Object.entries(serverTimings).map(([key, value]) => [
        `codingSession${key.charAt(0).toUpperCase()}${key.slice(1)}`,
        value
      ])
    );
  }
}
