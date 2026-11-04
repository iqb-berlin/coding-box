import { Entity, PrimaryGeneratedColumn, ManyToOne } from 'typeorm';
import { EntityA } from './entity-a';
@Entity()
export class EntityB {
  @PrimaryGeneratedColumn() id!: number;
  @ManyToOne(() => EntityA) related!: EntityA;
}
