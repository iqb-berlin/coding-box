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
   */
  @Column({ name: 'user_id', nullable: false })
    userId: string;

  /**
   * Workspace ID where the action was performed
   */
  @Column({ name: 'workspace_id', nullable: false })
    workspaceId: number;

  /**
   * Type of action performed (e.g., CREATE, UPDATE, DELETE)
   */
  @Column({ name: 'action_type', nullable: false })
    actionType: string;

  /**
   * Type of entity that was affected (e.g., UNIT, RESPONSE, PERSON, TAG)
   */
  @Column({ name: 'entity_type', nullable: false })
    entityType: string;

  /**
   * ID of the entity that was affected
   */
  @Column({ name: 'entity_id', nullable: false })
    entityId: number;

  /**
   * Additional details about the action in JSON format
   */
  @Column({ type: 'jsonb', nullable: true })
    details: Record<string, unknown>;
}
