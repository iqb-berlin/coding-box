import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn
} from 'typeorm';

/**
 * Entity for storing missings profiles dedicated table
 *
 * This entity replaces the previous storage in the settings table
 * and stores missings profiles with their configuration in JSON format.
 */
@Entity('missings_profile')
@Index(['workspace_id', 'label'], { unique: true })
export class MissingsProfile {
  @PrimaryGeneratedColumn()
    id: number;

  @Column()
    workspace_id: number;

  @Column('varchar', { length: 255 })
    label: string;

  @Column('text')
    missings: string;
}
