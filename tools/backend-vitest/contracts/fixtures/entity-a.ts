import { Entity, PrimaryGeneratedColumn, ManyToOne } from 'typeorm';
import { EntityB } from './entity-b';
@Entity()
export class EntityA {
  @PrimaryGeneratedColumn() id!: number;
  @ManyToOne(() => EntityB) related!: EntityB;
}
