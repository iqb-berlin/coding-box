import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index
} from 'typeorm';

@Entity({ name: 'coder_training_discussion_result' })
@Index(['training_id', 'response_id'], { unique: true })
export class CoderTrainingDiscussionResult {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  workspace_id: number;

  @Column()
  training_id: number;

  @Column()
  response_id: number;

  @Column({ type: 'integer', nullable: true })
  code: number | null;

  @Column({ type: 'integer', nullable: true })
  score: number | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'integer', nullable: true })
  manager_user_id: number | null;

  @Column({ type: 'varchar', nullable: true })
  manager_name: string | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
