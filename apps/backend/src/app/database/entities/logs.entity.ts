import {
  Column, Entity, PrimaryGeneratedColumn
} from 'typeorm';

@Entity()
class Logs {
  @PrimaryGeneratedColumn('increment')
    id: number;

  @Column({ type: 'varchar' })
    test_group!: string;

  @Column({ type: 'varchar' })
    unit_id!: string;

  @Column({ type: 'integer' })
    workspace_id!: number;

  @Column({ type: 'bigint' })
    timestamp: number;

  @Column({ type: 'varchar' })
    booklet_id: string;

  @Column({ type: 'varchar' })
    log_entry: string;
}

export default Logs;
