import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
class Workspace {
  @PrimaryGeneratedColumn({ type: 'int' })
    id: number = 0;

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
