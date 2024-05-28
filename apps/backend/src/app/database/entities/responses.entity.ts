import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
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
    created_at: number;

  @Column({
    type: 'varchar'
  })
    responses:string;
}

export default Responses;
