import {
  Column, Entity, PrimaryGeneratedColumn
} from 'typeorm';

@Entity()
class Persons {
  @PrimaryGeneratedColumn('increment')
    id: number;

  @Column({ type: 'varchar' })
    login!: string;

  @Column({ type: 'varchar' })
    code!: string;

  @Column({ type: 'varchar' })
    group!: string;

  @Column({ type: 'integer' })
    workspace_id!: number;

  @Column({ type: 'timestamp' })
    uploaded_at: Date;

  @Column({ type: 'jsonb' })
    booklets: unknown;

  @Column({ type: 'varchar' })
    source: string;
}

export default Persons;
