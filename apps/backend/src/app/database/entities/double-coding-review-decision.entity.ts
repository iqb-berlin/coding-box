import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn
} from 'typeorm';
import { DoubleCodedReviewDecisionState } from '../../../../../../api-dto/coding/double-coded-review.dto';

@Entity({ name: 'double_coding_review_decision' })
@Check('double_coding_review_decision_state_check', '"state" IN (\'draft\', \'applied\', \'superseded\')')
@Index(['workspace_id', 'response_id'])
export class DoubleCodingReviewDecision {
  @PrimaryGeneratedColumn()
    id: number;

  @Column({ type: 'integer' })
    workspace_id: number;

  @Column({ type: 'integer' })
    response_id: number;

  @Column({ type: 'integer', nullable: true })
    manager_user_id: number | null;

  @Column({ type: 'varchar', length: 255 })
    manager_key: string;

  @Column({ type: 'varchar', length: 255 })
    manager_name: string;

  @Column({ type: 'varchar', length: 16 })
    state: DoubleCodedReviewDecisionState;

  @Column({ type: 'bigint', nullable: true })
    code: number | null;

  @Column({ type: 'bigint', nullable: true })
    selected_code: number | null;

  @Column({ type: 'bigint', nullable: true })
    score: number | null;

  @Column({ type: 'text', nullable: true })
    comment: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
    created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
    updated_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
    finalized_at: Date | null;
}
