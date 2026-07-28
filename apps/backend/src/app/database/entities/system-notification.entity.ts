import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn
} from 'typeorm';
import {
  SystemNotificationSeverity,
  SystemNotificationType
} from '../../../../../../api-dto/system-notifications/system-notification.types';

@Entity('system_notification')
@Index('idx_system_notification_visibility', ['enabled', 'visibleFrom', 'visibleUntil'])
export class SystemNotification {
  @PrimaryGeneratedColumn()
    id!: number;

  @Column({ type: 'varchar', length: 20 })
    type!: SystemNotificationType;

  @Column({ type: 'varchar', length: 20 })
    severity!: SystemNotificationSeverity;

  @Column({ type: 'varchar', length: 160 })
    title!: string;

  @Column({ type: 'varchar', length: 2000 })
    message!: string;

  @Column({ name: 'starts_at', type: 'timestamptz', nullable: true })
    startsAt!: Date | null;

  @Column({ name: 'ends_at', type: 'timestamptz', nullable: true })
    endsAt!: Date | null;

  @Column({ name: 'visible_from', type: 'timestamptz', nullable: true })
    visibleFrom!: Date | null;

  @Column({ name: 'visible_until', type: 'timestamptz', nullable: true })
    visibleUntil!: Date | null;

  @Column({ type: 'boolean', default: true })
    enabled!: boolean;

  @Column({ type: 'boolean', default: false })
    dismissible!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
    updatedAt!: Date;
}
