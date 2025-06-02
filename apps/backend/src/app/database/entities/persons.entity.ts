import {
  Column, Entity, Index, PrimaryGeneratedColumn, Unique
} from 'typeorm';
// eslint-disable-next-line import/no-cycle
import { TcMergeBooklet } from '../services/workspace.service';

@Entity()
@Unique('persons_pk', ['code', 'group', 'login'])

class Persons {
  @PrimaryGeneratedColumn()
    id!: number;

  @Index()
  @Column({ type: 'varchar' })
    login!: string;

  @Index()
  @Column({ type: 'varchar' })
    code!: string;

  @Index()
  @Column({ type: 'varchar' })
    group!: string;

  @Index()
  @Column({ type: 'integer' })
    workspace_id!: number;

  @Column({ type: 'timestamp' })
    uploaded_at!: Date;

  @Column({ type: 'jsonb' })
    booklets: TcMergeBooklet[];

  @Column({ type: 'varchar' })
    source!: string;
}

export default Persons;
