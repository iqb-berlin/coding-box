import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn
} from 'typeorm';

/**
 * Entity for coding jobs
 * A coding job is a collection of variables and variable bundles assigned to coders
 */
@Entity({ name: 'coding_job' })
export class CodingJob {
  @PrimaryGeneratedColumn()
    id: number;

  @Column()
    workspace_id: number;

  @Column()
    name: string;

  @Column({ type: 'text', nullable: true })
    description?: string;

  /**
   * Status of the job: 'pending', 'active', 'paused', 'completed'
   */
  @Column({ default: 'pending' })
    status: string;

  @CreateDateColumn()
    created_at: Date;

  @UpdateDateColumn()
    updated_at: Date;
}
