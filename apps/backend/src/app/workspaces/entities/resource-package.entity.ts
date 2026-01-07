import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
class ResourcePackage {
  @PrimaryGeneratedColumn()
    id: number;

  @Column()
    workspaceId: number;

  @Column()
    name: string;

  @Column('text', { array: true })
    elements;

  @Column({
    type: 'bigint',
    name: 'package_size',
    default: 0
  })
    packageSize: number;

  @Column({
    type: 'timestamp with time zone',
    name: 'created_at'
  })
    createdAt: Date;
}

export default ResourcePackage;
