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
import User from './user.entity';

@Entity({ name: 'coder_training_coder' })
export class CoderTrainingCoder {
  @PrimaryGeneratedColumn()
    id: number;

  @Column()
  @Index()
    coder_training_id: number;

  @Column()
    user_id: number;

  @ManyToOne(() => CoderTraining, training => training.coders, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'coder_training_id' })
    training: CoderTraining;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
    user: User;
}
