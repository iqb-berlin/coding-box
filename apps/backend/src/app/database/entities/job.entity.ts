import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  TableInheritance
} from 'typeorm';

/**
 * Base entity for all job types
 */
@Entity()
@TableInheritance({ column: { type: 'varchar', name: 'type' } })
export class Job {
  @PrimaryGeneratedColumn()
    id: number;

  @Column()
    workspace_id: number;

  /**
   * Status of the job: 'pending', 'processing', 'completed', 'failed', 'cancelled', 'paused'
   */
  @Column()
    status: string;

  /**
   * Progress of the job (0-100)
   */
  @Column({ nullable: true })
    progress?: number;

  @Column({ nullable: true })
    error?: string;

  @Column({ type: 'text', nullable: true })
    result?: string;

  // Type is added by TypeORM for inheritance discriminator column 'type'
  type?: string;

  @CreateDateColumn()
    created_at: Date;

  @UpdateDateColumn()
    updated_at: Date;
}
