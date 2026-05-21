import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn
} from 'typeorm';

/**
 * Entity representing a journal entry for tracking actions on test results data
 */
@Entity('journal_entries')
export class JournalEntry {
  @PrimaryGeneratedColumn()
    id: number;

  /**
   * Timestamp when the action was performed
   */
  @CreateDateColumn({ type: 'timestamp' })
    timestamp: Date;

  /**
   * ID of the user who performed the action
   * @deprecated Use actorUserId for new audit entries.
   */
  @Column({ name: 'user_id', nullable: false })
    userId: string;

  /**
   * Numeric ID of the user who triggered the event, when available.
   */
  @Column({ name: 'actor_user_id', type: 'integer', nullable: true })
    actorUserId: number | null;

  /**
   * Actor category for the event.
   */
  @Column({
    name: 'actor_type',
    type: 'varchar',
    length: 20,
    nullable: false,
    default: 'user'
  })
    actorType: string;

  /**
   * Workspace ID where the action was performed
   */
  @Column({ name: 'workspace_id', nullable: false })
    workspaceId: number;

  /**
   * Type of action performed (e.g., CREATE, UPDATE, DELETE)
   * @deprecated Use eventType for new audit entries.
   */
  @Column({ name: 'action_type', nullable: false })
    actionType: string;

  /**
   * Canonical audit event type.
   */
  @Column({
    name: 'event_type',
    type: 'varchar',
    length: 100,
    nullable: true
  })
    eventType: string | null;

  /**
   * Type of entity that was affected (e.g., UNIT, RESPONSE, PERSON, TAG)
   */
  @Column({ name: 'entity_type', nullable: false })
    entityType: string;

  /**
   * ID of the entity that was affected
   */
  @Column({
    name: 'entity_id',
    type: 'varchar',
    length: 255,
    nullable: true
  })
    entityId: string | null;

  /**
   * Result state of the audited action.
   */
  @Column({
    name: 'result',
    type: 'varchar',
    length: 20,
    nullable: false,
    default: 'success'
  })
    result: string;

  /**
   * Human-readable, privacy-conscious summary.
   */
  @Column({ name: 'summary', type: 'text', nullable: true })
    summary: string | null;

  /**
   * Optional request/job correlation ID.
   */
  @Column({
    name: 'correlation_id',
    type: 'varchar',
    length: 255,
    nullable: true
  })
    correlationId: string | null;

  /**
   * Optional background job ID.
   */
  @Column({
    name: 'job_id',
    type: 'varchar',
    length: 255,
    nullable: true
  })
    jobId: string | null;

  /**
   * Additional details about the action in JSON format
   */
  @Column({ type: 'jsonb', nullable: true })
    details: Record<string, unknown> | null;
}
