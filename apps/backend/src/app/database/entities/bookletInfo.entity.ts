import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('bookletInfo')
export class BookletInfo {
  @PrimaryGeneratedColumn()
    id: number;

  @Column({ type: 'text' })
    name: string;

  @Column({ type: 'bigint', default: 0 })
    size: number;
}
