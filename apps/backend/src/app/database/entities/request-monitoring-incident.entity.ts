import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn
} from 'typeorm';
import { RequestMonitoringIncidentKind } from '../../../../../../api-dto/request-monitoring/request-monitoring-incident.dto';

@Entity('request_monitoring_incident')
@Index('uq_request_monitoring_incident_fingerprint', ['fingerprint'], {
  unique: true
})
@Index('idx_request_monitoring_incident_open_last', ['resolvedAt', 'lastOccurredAt'])
export class RequestMonitoringIncident {
  @PrimaryGeneratedColumn()
    id!: number;

  @Column({ type: 'char', length: 64 })
    fingerprint!: string;

  @Column({ type: 'varchar', length: 20 })
    kind!: RequestMonitoringIncidentKind;

  @Column({ type: 'varchar', length: 10 })
    method!: string;

  @Column({ type: 'varchar', length: 500 })
    path!: string;

  @Column({ name: 'workspace_id', type: 'integer', nullable: true })
    workspaceId!: number | null;

  @Column({ name: 'status_code', type: 'integer', nullable: true })
    statusCode!: number | null;

  @Column({ name: 'occurrence_count', type: 'integer', default: 1 })
    occurrenceCount!: number;

  @Column({ name: 'max_duration_ms', type: 'integer' })
    maxDurationMs!: number;

  @Column({ name: 'last_request_id', type: 'varchar', length: 128 })
    lastRequestId!: string;

  @Column({
    name: 'last_error_message',
    type: 'varchar',
    length: 1000,
    nullable: true
  })
    lastErrorMessage!: string | null;

  @Column({ name: 'postgres_total_count', type: 'integer', nullable: true })
    postgresTotalCount!: number | null;

  @Column({ name: 'postgres_idle_count', type: 'integer', nullable: true })
    postgresIdleCount!: number | null;

  @Column({ name: 'postgres_waiting_count', type: 'integer', nullable: true })
    postgresWaitingCount!: number | null;

  @Column({ name: 'first_occurred_at', type: 'timestamptz' })
    firstOccurredAt!: Date;

  @Column({ name: 'last_occurred_at', type: 'timestamptz' })
    lastOccurredAt!: Date;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
    resolvedAt!: Date | null;
}
