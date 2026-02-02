import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  Index
} from 'typeorm';
// eslint-disable-next-line import/no-cycle
import { CoderTraining } from './coder-training.entity';

@Entity({ name: 'coder_training_variable' })
export class CoderTrainingVariable {
  @PrimaryGeneratedColumn()
    id: number;

  @Column()
  @Index()
    coder_training_id: number;

  @Column()
    variable_id: string;

  @Column()
    unit_name: string;

  @Column({ default: 10 })
    sample_count: number;

  @ManyToOne(() => CoderTraining, training => training.variables, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'coder_training_id' })
    training: CoderTraining;
}
