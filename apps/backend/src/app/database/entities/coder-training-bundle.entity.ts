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
import { VariableBundle } from './variable-bundle.entity';

@Entity({ name: 'coder_training_bundle' })
export class CoderTrainingBundle {
  @PrimaryGeneratedColumn()
    id: number;

  @Column()
  @Index()
    coder_training_id: number;

  @Column()
    variable_bundle_id: number;

  @Column({ default: 10 })
    sample_count: number;

  @ManyToOne(() => CoderTraining, training => training.bundles, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'coder_training_id' })
    training: CoderTraining;

  @ManyToOne(() => VariableBundle, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'variable_bundle_id' })
    bundle: VariableBundle;
}
