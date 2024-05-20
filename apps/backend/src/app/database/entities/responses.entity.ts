import { Column, Entity, PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
class Responses {
  @PrimaryGeneratedColumn('increment')
  public id: number;

  @Column({ type: 'varchar' })
    test_person!: string;

  @Column({ type: 'varchar' })
    unit_id!: string;

  @Column({ type: 'varchar' })
  test_group!: string;

  @Column({
    type: 'varchar'
  })
    responses:string;
}

export default Responses;
