import { NotFoundException } from '@nestjs/common';
import { RequestMonitoringIncidentKind } from '../../../../../../api-dto/request-monitoring/request-monitoring-incident.dto';
import { RequestMonitoringIncident } from '../../database/entities/request-monitoring-incident.entity';
import { RequestMonitoringIncidentService } from './request-monitoring-incident.service';

function incident(
  overrides: Partial<RequestMonitoringIncident> = {}
): RequestMonitoringIncident {
  return {
    id: 1,
    fingerprint: 'a'.repeat(64),
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
    firstOccurredAt: new Date('2026-07-30T10:00:00Z'),
    lastOccurredAt: new Date('2026-07-30T10:05:00Z'),
    resolvedAt: null,
    ...overrides
  };
}

function repositoryMock(found: RequestMonitoringIncident | null = null) {
  return {
    query: jest.fn().mockResolvedValue([]),
    find: jest.fn().mockResolvedValue(found ? [found] : []),
    findOne: jest.fn().mockResolvedValue(found),
    save: jest.fn().mockImplementation(value => Promise.resolve(value))
  };
}

describe('RequestMonitoringIncidentService', () => {
  it('upserts a normalized incident without exposing query parameters', async () => {
    const repository = repositoryMock();
    const service = new RequestMonitoringIncidentService(repository as never);

    await service.record({
      durationMs: 12_345.7,
      errorMessage: ' query failed ',
      kind: RequestMonitoringIncidentKind.Failed,
      method: 'get',
      path: '/api/admin/workspace/:id/test-results/log-anomaly-summary',
      requestId: 'request-2',
      statusCode: 500,
      workspaceId: 3,
      poolSnapshot: { totalCount: 10, idleCount: 0, waitingCount: 3 }
    });

    expect(repository.query).toHaveBeenCalledTimes(1);
    const parameters = repository.query.mock.calls[0][1];
    expect(parameters[1]).toBe(RequestMonitoringIncidentKind.Failed);
    expect(parameters[2]).toBe('GET');
    expect(parameters[3]).toBe(
      '/api/admin/workspace/:id/test-results/log-anomaly-summary'
    );
    expect(parameters.slice(4)).toEqual([
      3,
      500,
      12_346,
      'request-2',
      'query failed',
      10,
      0,
      3,
      expect.any(Date)
    ]);
  });

  it('lists open incidents and maps timestamps', async () => {
    const repository = repositoryMock(incident());
    const service = new RequestMonitoringIncidentService(repository as never);

    const result = await service.findAll(false, 50);

    expect(repository.find).toHaveBeenCalledWith(expect.objectContaining({
      take: 50
    }));
    expect(result[0]).toEqual(expect.objectContaining({
      occurrenceCount: 2,
      lastOccurredAt: '2026-07-30T10:05:00.000Z',
      resolvedAt: null
    }));
  });

  it('resolves an incident and reopens it on request', async () => {
    const existing = incident();
    const repository = repositoryMock(existing);
    const service = new RequestMonitoringIncidentService(repository as never);

    const resolved = await service.setResolved(1, true);
    expect(resolved.resolvedAt).not.toBeNull();

    const reopened = await service.setResolved(1, false);
    expect(reopened.resolvedAt).toBeNull();
  });

  it('rejects an unknown incident', async () => {
    const service = new RequestMonitoringIncidentService(
      repositoryMock() as never
    );

    await expect(service.setResolved(404, true))
      .rejects.toBeInstanceOf(NotFoundException);
  });
});
