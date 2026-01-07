import {
  Column, Entity, Index, PrimaryGeneratedColumn, Unique, OneToMany
} from 'typeorm';
// eslint-disable-next-line import/no-cycle
import { TcMergeBooklet } from '../types/shared-types';
// eslint-disable-next-line import/no-cycle
import { Booklet } from '../../workspaces/entities/booklet.entity';

@Entity()
@Unique('persons_pk', ['code', 'group', 'login', 'workspace_id'])
@Index(['workspace_id', 'code']) // Composite index for common query patterns
@Index(['workspace_id', 'group']) // Composite index for filtering by group within workspace
@Index(['login', 'code', 'workspace_id']) // Composite index for findUnitResponse query

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

  @Column({ type: 'boolean', default: true })
    consider!: boolean;

  // Add explicit relationship to Booklet entity
  @OneToMany(() => Booklet, booklet => booklet.person, {
    // Cascade operations to booklets when person is modified
    cascade: true
  })
    booklets_relation!: Booklet[];
}

export default Persons;
