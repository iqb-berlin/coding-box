import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export enum RequestMonitoringIncidentKind {
  Slow = 'slow',
  Failed = 'failed',
  InFlight = 'in_flight',
  Aborted = 'aborted',
  Closed = 'closed'
}

export class RequestMonitoringIncidentDto {
  @ApiProperty()
    id!: number;

  @ApiProperty({ enum: RequestMonitoringIncidentKind })
    kind!: RequestMonitoringIncidentKind;

  @ApiProperty()
    method!: string;

  @ApiProperty()
    path!: string;

  @ApiPropertyOptional({ nullable: true })
    workspaceId!: number | null;

  @ApiPropertyOptional({ nullable: true })
    statusCode!: number | null;

  @ApiProperty()
    occurrenceCount!: number;

  @ApiProperty()
    maxDurationMs!: number;

  @ApiProperty()
    lastRequestId!: string;

  @ApiPropertyOptional({ nullable: true })
    lastErrorMessage!: string | null;

  @ApiPropertyOptional({ nullable: true })
    postgresTotalCount!: number | null;

  @ApiPropertyOptional({ nullable: true })
    postgresIdleCount!: number | null;

  @ApiPropertyOptional({ nullable: true })
    postgresWaitingCount!: number | null;

  @ApiProperty({ type: String, format: 'date-time' })
    firstOccurredAt!: string;

  @ApiProperty({ type: String, format: 'date-time' })
    lastOccurredAt!: string;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
    resolvedAt!: string | null;
}

export class ResolveRequestMonitoringIncidentDto {
  @ApiProperty()
  @IsBoolean()
    resolved!: boolean;
}
