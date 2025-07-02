import {
  Entity, Column, PrimaryGeneratedColumn, Unique, Index
} from 'typeorm';

@Entity('bookletinfo')
@Unique('bookletinfo_pk', ['name'])
@Index(['name'])

export class BookletInfo {
  @PrimaryGeneratedColumn()
    id: number;

  @Column({ type: 'text' })
    name: string;

  @Column({ type: 'bigint', default: 0 })
    size: number;
}
