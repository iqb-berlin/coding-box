import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import {
  RequestMonitoringIncidentDto,
  RequestMonitoringIncidentKind
} from '../../../../../../../api-dto/request-monitoring/request-monitoring-incident.dto';
import { RequestMonitoringIncidentService } from '../../../core/services/request-monitoring-incident.service';
import { RequestMonitoringIncidentsComponent } from './request-monitoring-incidents.component';

function incident(
  overrides: Partial<RequestMonitoringIncidentDto> = {}
): RequestMonitoringIncidentDto {
  return {
    id: 1,
    kind: RequestMonitoringIncidentKind.Failed,
    method: 'GET',
    path: '/api/admin/workspace/:id/test-results/log-anomaly-summary',
    workspaceId: 3,
    statusCode: 500,
    occurrenceCount: 2,
    maxDurationMs: 12_000,
    lastRequestId: 'request-2',
    lastErrorMessage: 'query failed',
    postgresTotalCount: 10,
    postgresIdleCount: 0,
    postgresWaitingCount: 3,
    firstOccurredAt: '2026-07-30T10:00:00.000Z',
    lastOccurredAt: '2026-07-30T10:05:00.000Z',
    resolvedAt: null,
    ...overrides
  };
}

describe('RequestMonitoringIncidentsComponent', () => {
  let fixture: ComponentFixture<RequestMonitoringIncidentsComponent>;
  let component: RequestMonitoringIncidentsComponent;
  const service = {
    getAll: jest.fn().mockReturnValue(of([incident()])),
    setResolved: jest.fn().mockReturnValue(of(incident({
      resolvedAt: '2026-07-30T10:10:00.000Z'
    })))
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    service.getAll.mockReturnValue(of([incident()]));
    await TestBed.configureTestingModule({
      imports: [
        RequestMonitoringIncidentsComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot()
      ],
      providers: [{
        provide: RequestMonitoringIncidentService,
        useValue: service
      }, {
        provide: MatSnackBar,
        useValue: { open: jest.fn() }
      }]
    }).compileComponents();

    fixture = TestBed.createComponent(RequestMonitoringIncidentsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('loads open incidents on initialization', () => {
    expect(service.getAll).toHaveBeenCalledWith(false);
    expect(component.incidents).toHaveLength(1);
  });

  it('removes a resolved incident from the open list', () => {
    component.setResolved(component.incidents[0]);

    expect(service.setResolved).toHaveBeenCalledWith(1, true);
    expect(component.incidents).toEqual([]);
  });

  it('reloads when resolved incidents are requested', () => {
    component.toggleResolved(true);

    expect(service.getAll).toHaveBeenLastCalledWith(true);
  });
});
