import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn
} from 'typeorm';

/**
 * Entity for storing replay statistics
 * Records information about each replay session including timestamp, duration, and unit information
 */
@Entity()
export class ReplayStatistics {
  @PrimaryGeneratedColumn()
    id: number;

  @CreateDateColumn()
    timestamp: Date;

  @Column({ type: 'int', nullable: false })
    workspace_id: number;

  @Column({ type: 'varchar', length: 255, nullable: false })
    unit_id: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
    booklet_id: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
    test_person_login: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
    test_person_code: string;

  @Column({ type: 'int', nullable: false })
    duration_milliseconds: number;

  @Column({ type: 'varchar', length: 2000, nullable: true })
    replay_url: string;

  @Column({ type: 'boolean', default: true })
    success: boolean;

  @Column({ type: 'varchar', length: 2000, nullable: true })
    error_message: string;
}
