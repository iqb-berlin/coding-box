import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { SERVER_URL } from '../../injection-tokens';
import { CodingStatusSnapshotService } from './coding-status-snapshot.service';

describe('CodingStatusSnapshotService', () => {
  let service: CodingStatusSnapshotService;
  let http: HttpTestingController;
  const serverUrl = 'http://localhost:3000/';

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: SERVER_URL, useValue: serverUrl }
      ]
    });
    service = TestBed.inject(CodingStatusSnapshotService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  const saveOverview = (): void => service.saveOverview({
    userId: 7,
    workspaceId: 3,
    revision: 11,
    statusRevision: '21',
    freshness: { workspaceId: 3, currentRevision: 11, items: [] },
    readiness: {
      workspaceId: 3,
      autoCoderRun: 1,
      readiness: 'READY',
      blockers: [],
      rawResponsesTotal: 1,
      rawResponsesWithRelevantStatus: 1,
      resultUnitsTotal: 1,
      resultUnitKeysTotal: 1,
      matchedUnitFiles: 1,
      missingUnitFiles: [],
      matchedCodingSchemes: 1,
      missingCodingSchemes: [],
      invalidCodingSchemes: [],
      validVariablePairs: 1,
      validResponses: 1,
      codeableResponses: 1,
      invalidVariableSamples: []
    },
    appliedResultsOverview: null,
    fullyChecked: true
  });

  it('restores a snapshot only after validating its revision', () => {
    saveOverview();
    let restoredRevision: number | undefined;

    service.restoreOverview(7, 3).subscribe(snapshot => {
      restoredRevision = snapshot?.revision;
    });
    http.expectOne(`${serverUrl}admin/workspace/3/coding/revision`).flush({
      workspaceId: 3,
      revision: 11,
      statusRevision: '21',
      stable: true
    });

    expect(restoredRevision).toBe(11);
  });

  it('removes a snapshot when the revision changed', () => {
    saveOverview();
    service.restoreOverview(7, 3).subscribe(snapshot => {
      expect(snapshot).toBeNull();
    });
    http.expectOne(`${serverUrl}admin/workspace/3/coding/revision`).flush({
      workspaceId: 3,
      revision: 12,
      statusRevision: '22',
      stable: true
    });

    expect(sessionStorage.length).toBe(0);
  });

  it('removes a snapshot while the server status is being updated', () => {
    saveOverview();
    service.restoreOverview(7, 3).subscribe(snapshot => {
      expect(snapshot).toBeNull();
    });
    http.expectOne(`${serverUrl}admin/workspace/3/coding/revision`).flush({
      workspaceId: 3,
      revision: 11,
      statusRevision: '21',
      stable: false
    });

    expect(sessionStorage.length).toBe(0);
  });

  it('keeps a snapshot when revision validation fails transiently', () => {
    saveOverview();
    service.restoreOverview(7, 3).subscribe(snapshot => {
      expect(snapshot).toBeNull();
    });
    http.expectOne(`${serverUrl}admin/workspace/3/coding/revision`)
      .flush('Unavailable', { status: 503, statusText: 'Unavailable' });

    expect(sessionStorage.length).toBe(1);
  });

  it('does not read snapshots belonging to another user or workspace', () => {
    saveOverview();

    service.restoreOverview(8, 3).subscribe(snapshot => {
      expect(snapshot).toBeNull();
    });
    service.restoreOverview(7, 4).subscribe(snapshot => {
      expect(snapshot).toBeNull();
    });

    http.expectNone(`${serverUrl}admin/workspace/3/coding/revision`);
    http.expectNone(`${serverUrl}admin/workspace/4/coding/revision`);
    expect(sessionStorage.length).toBe(1);
  });

  it('deduplicates simultaneous revision validation requests', () => {
    saveOverview();
    service.restoreOverview(7, 3).subscribe();
    service.restoreOverview(7, 3).subscribe();

    const requests = http.match(
      `${serverUrl}admin/workspace/3/coding/revision`
    );
    expect(requests).toHaveLength(1);
    requests[0].flush({
      workspaceId: 3,
      revision: 11,
      statusRevision: '21',
      stable: true
    });
  });

  it('removes malformed storage without requesting a revision', () => {
    sessionStorage.setItem(
      'coding-status-snapshot:v1:7:3:overview',
      '{broken'
    );

    service.restoreOverview(7, 3).subscribe(snapshot => {
      expect(snapshot).toBeNull();
    });

    http.expectNone(`${serverUrl}admin/workspace/3/coding/revision`);
    expect(sessionStorage.length).toBe(0);
  });

  it('removes snapshots with unknown typed status values', () => {
    sessionStorage.setItem(
      'coding-status-snapshot:v1:7:3:manual',
      JSON.stringify({
        schemaVersion: 1,
        userId: 7,
        workspaceId: 3,
        revision: 11,
        statusRevision: '21',
        checkedAt: new Date().toISOString(),
        surface: 'manual',
        planningStatus: 'unknown-state',
        displayParameters: {},
        freshness: null,
        nextTarget: {},
        fullyChecked: true
      })
    );

    service.restoreManual(7, 3).subscribe(snapshot => {
      expect(snapshot).toBeNull();
    });

    http.expectNone(`${serverUrl}admin/workspace/3/coding/revision`);
    expect(sessionStorage.length).toBe(0);
  });

  it('clears only snapshots for the requested workspace', () => {
    saveOverview();
    sessionStorage.setItem(
      'coding-status-snapshot:v1:7:4:manual',
      '{}'
    );

    service.clearWorkspace(3);

    expect(sessionStorage.getItem('coding-status-snapshot:v1:7:3:overview'))
      .toBeNull();
    expect(sessionStorage.getItem('coding-status-snapshot:v1:7:4:manual'))
      .toBe('{}');
  });

  it('does not reuse a pending request for an explicit fresh revision check', () => {
    service.getRevision(3).subscribe();
    service.getRevision(3, { fresh: true }).subscribe();

    const requests = http.match(
      `${serverUrl}admin/workspace/3/coding/revision`
    );
    expect(requests).toHaveLength(2);
    requests.forEach(request => request.flush({
      workspaceId: 3,
      revision: 11,
      statusRevision: '21',
      stable: true
    })
    );
  });

  it('removes an overview with malformed nested readiness data', () => {
    saveOverview();
    const key = 'coding-status-snapshot:v1:7:3:overview';
    const snapshot = JSON.parse(sessionStorage.getItem(key) || '{}');
    snapshot.readiness.invalidVariableSamples = [
      {
        unitName: 'UNIT',
        responseCount: 'many',
        sampleVariableIds: [],
        knownVariableIds: []
      }
    ];
    sessionStorage.setItem(key, JSON.stringify(snapshot));

    service
      .restoreOverview(7, 3)
      .subscribe(value => expect(value).toBeNull());

    http.expectNone(`${serverUrl}admin/workspace/3/coding/revision`);
    expect(sessionStorage.getItem(key)).toBeNull();
  });
});
