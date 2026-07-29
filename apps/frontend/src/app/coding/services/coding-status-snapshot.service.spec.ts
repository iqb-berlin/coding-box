import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { SERVER_URL } from '../../injection-tokens';
import { CODING_STATUS_SNAPSHOT_KEY_PREFIX } from '../../core/services/coding-status-session-storage';
import { CodingStatusSnapshotService } from './coding-status-snapshot.service';

describe('CodingStatusSnapshotService', () => {
  let service: CodingStatusSnapshotService;
  let http: HttpTestingController;
  const serverUrl = 'http://localhost/api/';

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        CodingStatusSnapshotService,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: SERVER_URL, useValue: serverUrl }
      ]
    });
    service = TestBed.inject(CodingStatusSnapshotService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    sessionStorage.clear();
  });

  it('restores a matching overview snapshot', () => {
    service.saveOverview({
      userId: 3,
      workspaceId: 7,
      revision: 12,
      statusRevision: '34',
      freshness: { workspaceId: 7, currentRevision: 12, items: [] },
      readiness: { workspaceId: 7 } as never,
      appliedResultsOverview: null
    });

    let restored: unknown;
    service.restoreOverview(3, 7).subscribe(value => {
      restored = value;
    });
    http.expectOne(`${serverUrl}admin/workspace/7/coding/revision`).flush({
      workspaceId: 7,
      revision: 12,
      statusRevision: '34',
      stable: true
    });

    expect(restored).toMatchObject({ workspaceId: 7, revision: 12 });
  });

  it('drops a snapshot when the server revision changed', () => {
    service.saveManual({
      userId: 3,
      workspaceId: 7,
      revision: 12,
      statusRevision: '34',
      planningStatus: 'planning-ready',
      displayParameters: {
        variableConflicts: 0,
        missingVariables: 0,
        unassignedCases: 0,
        activeTrainingJobs: 0,
        staleSourceJobs: 0,
        openDoubleCodingConflicts: 0,
        manualCodeAvailabilityWarnings: 0
      },
      freshness: null,
      nextTarget: {
        tab: 'planning',
        sectionId: 'manual-planning',
        action: 'navigate'
      }
    });

    let restored: unknown = 'pending';
    service.restoreManual(3, 7).subscribe(value => {
      restored = value;
    });
    http.expectOne(`${serverUrl}admin/workspace/7/coding/revision`).flush({
      workspaceId: 7,
      revision: 13,
      statusRevision: '34',
      stable: true
    });

    expect(restored).toBeNull();
    expect(sessionStorage.length).toBe(0);
  });

  it('drops malformed manual status data without contacting the server', () => {
    sessionStorage.setItem(
      `${CODING_STATUS_SNAPSHOT_KEY_PREFIX}3:7:manual`,
      JSON.stringify({
        schemaVersion: 1,
        userId: 3,
        workspaceId: 7,
        revision: 12,
        statusRevision: '34',
        checkedAt: new Date().toISOString(),
        surface: 'manual',
        fullyChecked: true,
        planningStatus: 'invented-status',
        displayParameters: {},
        freshness: null,
        nextTarget: {
          tab: 'planning',
          sectionId: 'manual-planning',
          action: 'navigate'
        }
      })
    );

    let restored: unknown = 'pending';
    service.restoreManual(3, 7).subscribe(value => {
      restored = value;
    });

    expect(restored).toBeNull();
    expect(sessionStorage.length).toBe(0);
  });

  it('clears only snapshots for the selected workspace', () => {
    sessionStorage.setItem(
      `${CODING_STATUS_SNAPSHOT_KEY_PREFIX}3:7:manual`,
      '{}'
    );
    sessionStorage.setItem(
      `${CODING_STATUS_SNAPSHOT_KEY_PREFIX}3:8:manual`,
      '{}'
    );

    service.clearWorkspace(7);

    expect(
      sessionStorage.getItem(`${CODING_STATUS_SNAPSHOT_KEY_PREFIX}3:7:manual`)
    ).toBeNull();
    expect(
      sessionStorage.getItem(`${CODING_STATUS_SNAPSHOT_KEY_PREFIX}3:8:manual`)
    ).toBe('{}');
  });
});
