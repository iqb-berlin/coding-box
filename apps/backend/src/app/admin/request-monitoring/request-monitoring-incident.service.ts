import { createHash } from 'crypto';
import {
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import {
  RequestMonitoringIncidentDto,
  RequestMonitoringIncidentKind
} from '../../../../../../api-dto/request-monitoring/request-monitoring-incident.dto';
import { RequestMonitoringIncident } from '../../database/entities/request-monitoring-incident.entity';
import { PostgresPoolSnapshot } from '../../database/postgres-pool-monitor';

export interface RecordRequestMonitoringIncident {
  durationMs: number;
  errorMessage?: string;
  kind: RequestMonitoringIncidentKind;
  method: string;
  path: string;
  poolSnapshot?: PostgresPoolSnapshot;
  requestId: string;
  statusCode?: number;
  workspaceId?: number;
}

@Injectable()
export class RequestMonitoringIncidentService {
  constructor(
    @InjectRepository(RequestMonitoringIncident)
    private readonly repository: Repository<RequestMonitoringIncident>
  ) {}

  async record(input: RecordRequestMonitoringIncident): Promise<void> {
    const method = input.method.trim().toUpperCase().slice(0, 10) || 'UNKNOWN';
    const path = input.path.trim().slice(0, 500) || '/';
    const workspaceId = this.toPositiveIntegerOrNull(input.workspaceId);
    const statusCode = this.toPositiveIntegerOrNull(input.statusCode);
    const durationMs = Math.min(
      Math.max(0, Math.round(Number(input.durationMs) || 0)),
      2_147_483_647
    );
    const fingerprint = createHash('sha256')
      .update([
        input.kind,
        method,
        path,
        workspaceId ?? '',
        statusCode ?? ''
      ].join('|'))
      .digest('hex');
    const occurredAt = new Date();
    const errorMessage = input.errorMessage?.trim().slice(0, 1000) || null;
    const pool = input.poolSnapshot;

    await this.repository.query(
      `
        INSERT INTO request_monitoring_incident (
          fingerprint,
          kind,
          method,
          path,
          workspace_id,
          status_code,
          occurrence_count,
          max_duration_ms,
          last_request_id,
          last_error_message,
          postgres_total_count,
          postgres_idle_count,
          postgres_waiting_count,
          first_occurred_at,
          last_occurred_at,
          resolved_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, 1, $7, $8, $9, $10, $11, $12, $13, $13, NULL
        )
        ON CONFLICT (fingerprint) DO UPDATE SET
          occurrence_count = request_monitoring_incident.occurrence_count + 1,
          max_duration_ms = GREATEST(
            request_monitoring_incident.max_duration_ms,
            EXCLUDED.max_duration_ms
          ),
          last_request_id = EXCLUDED.last_request_id,
          last_error_message = EXCLUDED.last_error_message,
          postgres_total_count = EXCLUDED.postgres_total_count,
          postgres_idle_count = EXCLUDED.postgres_idle_count,
          postgres_waiting_count = EXCLUDED.postgres_waiting_count,
          last_occurred_at = EXCLUDED.last_occurred_at,
          resolved_at = NULL
      `,
      [
        fingerprint,
        input.kind,
        method,
        path,
        workspaceId,
        statusCode,
        durationMs,
        input.requestId.slice(0, 128),
        errorMessage,
        pool?.totalCount ?? null,
        pool?.idleCount ?? null,
        pool?.waitingCount ?? null,
        occurredAt
      ]
    );
  }

  async findAll(
    includeResolved = false,
    requestedLimit = 200
  ): Promise<RequestMonitoringIncidentDto[]> {
    const limit = Math.min(Math.max(Math.round(requestedLimit) || 200, 1), 1000);
    const incidents = await this.repository.find({
      where: includeResolved ? {} : { resolvedAt: IsNull() },
      order: { lastOccurredAt: 'DESC' },
      take: limit
    });
    return incidents.map(incident => this.toDto(incident));
  }

  async setResolved(
    id: number,
    resolved: boolean
  ): Promise<RequestMonitoringIncidentDto> {
    const incident = await this.repository.findOne({ where: { id } });
    if (!incident) {
      throw new NotFoundException('Servermeldung wurde nicht gefunden.');
    }
    incident.resolvedAt = resolved ? new Date() : null;
    return this.toDto(await this.repository.save(incident));
  }

  private toPositiveIntegerOrNull(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }

  private toDto(
    incident: RequestMonitoringIncident
  ): RequestMonitoringIncidentDto {
    return {
      id: incident.id,
      kind: incident.kind,
      method: incident.method,
      path: incident.path,
      workspaceId: incident.workspaceId,
      statusCode: incident.statusCode,
      occurrenceCount: incident.occurrenceCount,
      maxDurationMs: incident.maxDurationMs,
      lastRequestId: incident.lastRequestId,
      lastErrorMessage: incident.lastErrorMessage,
      postgresTotalCount: incident.postgresTotalCount,
      postgresIdleCount: incident.postgresIdleCount,
      postgresWaitingCount: incident.postgresWaitingCount,
      firstOccurredAt: incident.firstOccurredAt.toISOString(),
      lastOccurredAt: incident.lastOccurredAt.toISOString(),
      resolvedAt: incident.resolvedAt?.toISOString() ?? null
    };
  }
}
