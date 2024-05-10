import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity()
class Responses {
  @PrimaryColumn({ type: 'varchar' })
    test_person!: string;

  @Column({ type: 'integer' })
    unit_id!: string;

  @Column({
    type: 'varchar'
  })
    responses:string;
}

export default Responses;
