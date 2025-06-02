import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn
} from 'typeorm';

@Entity()
class Workspace {
  @PrimaryGeneratedColumn({ type: 'int' })
    id: number = 0;

  @Index()
  @Column({ type: 'varchar' })
    name: string = '';

  @Column({
    type: 'jsonb',
    array: false,
    default: () => "'{}'",
    nullable: false
  })
    settings = {};
}

export default Workspace;
