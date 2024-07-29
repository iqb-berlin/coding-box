import {
  Column, Entity, PrimaryGeneratedColumn, Unique
} from 'typeorm';

@Entity()
@Unique('response_id', ['test_person', 'unit_id', 'source', 'booklet_id'])
class Responses {
  @PrimaryGeneratedColumn('increment')
    id: number;

  @Column({ type: 'varchar' })
    test_person!: string;

  @Column({ type: 'varchar' })
    unit_id!: string;

  @Column({ type: 'varchar' })
    test_group!: string;

  @Column({ type: 'integer' })
    workspace_id!: number;

  @Column({ type: 'timestamp' })
    created_at: Date;

  @Column({ type: 'jsonb' })
    responses: Array<{ id: string; content: string; ts: number; responseType: string }> | undefined;

  @Column({ type: 'jsonb' })
    unit_state: unknown | undefined;

  @Column({ type: 'varchar' })
    source: string;

  @Column({ type: 'varchar' })
    booklet_id: string;
}

export default Responses;
