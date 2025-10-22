import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn
} from 'typeorm';
import { MissingsProfile } from './missings-profile.entity';

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

  @Column({ name: 'missings_profile_id', nullable: true })
    missings_profile_id?: number;

  @ManyToOne(() => MissingsProfile)
  @JoinColumn({ name: 'missings_profile_id' })
    missingsProfile?: MissingsProfile;

  @CreateDateColumn()
    created_at: Date;

  @UpdateDateColumn()
    updated_at: Date;
}
