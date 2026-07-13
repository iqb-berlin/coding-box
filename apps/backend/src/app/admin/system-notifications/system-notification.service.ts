import {
  BadRequestException,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  CreateSystemNotificationDto,
  SystemNotificationDto,
  SystemNotificationSeverity,
  SystemNotificationType,
  UpdateSystemNotificationDto
} from '../../../../../../api-dto/system-notifications/system-notification.dto';
import { SystemNotification } from '../../database/entities/system-notification.entity';

type NormalizedNotification = Omit<SystemNotification, 'id' | 'createdAt' | 'updatedAt'>;

@Injectable()
export class SystemNotificationService {
  constructor(
    @InjectRepository(SystemNotification)
    private readonly repository: Repository<SystemNotification>
  ) {}

  async findAll(): Promise<SystemNotificationDto[]> {
    const notifications = await this.repository.find({
      order: { createdAt: 'DESC' }
    });
    return notifications.map(notification => this.toDto(notification));
  }

  async findActive(now = new Date()): Promise<SystemNotificationDto[]> {
    const notifications = await this.repository.createQueryBuilder('notification')
      .where('notification.enabled = true')
      .andWhere(
        '(COALESCE(notification.visible_from, notification.starts_at) IS NULL ' +
        'OR COALESCE(notification.visible_from, notification.starts_at) <= :now)',
        { now }
      )
      .andWhere(
        '(COALESCE(notification.visible_until, notification.ends_at) IS NULL ' +
        'OR COALESCE(notification.visible_until, notification.ends_at) >= :now)',
        { now }
      )
      .orderBy('notification.created_at', 'DESC')
      .getMany();
    return notifications.map(notification => this.toDto(notification));
  }

  async create(input: CreateSystemNotificationDto): Promise<SystemNotificationDto> {
    const normalized = this.normalizeAndValidate(input);
    const saved = await this.repository.save(this.repository.create(normalized));
    return this.toDto(saved);
  }

  async update(id: number, input: UpdateSystemNotificationDto): Promise<SystemNotificationDto> {
    const notification = await this.findEntity(id);
    Object.assign(notification, this.normalizeAndValidate(input));
    return this.toDto(await this.repository.save(notification));
  }

  async delete(id: number): Promise<void> {
    const notification = await this.findEntity(id);
    await this.repository.remove(notification);
  }

  private async findEntity(id: number): Promise<SystemNotification> {
    if (!Number.isInteger(id) || id <= 0) {
      throw new BadRequestException('Ungültige Hinweis-ID.');
    }
    const notification = await this.repository.findOne({ where: { id } });
    if (!notification) {
      throw new NotFoundException('Systemhinweis wurde nicht gefunden.');
    }
    return notification;
  }

  private normalizeAndValidate(input: CreateSystemNotificationDto | null | undefined): NormalizedNotification {
    if (!input) {
      throw new BadRequestException('Hinweisdaten fehlen.');
    }

    if (typeof input.title !== 'string' || typeof input.message !== 'string') {
      throw new BadRequestException('Titel und Nachricht müssen Text sein.');
    }
    if (input.enabled !== undefined && typeof input.enabled !== 'boolean') {
      throw new BadRequestException('„Aktiviert“ muss ein Wahrheitswert sein.');
    }
    if (input.dismissible !== undefined && typeof input.dismissible !== 'boolean') {
      throw new BadRequestException('„Ausblendbar“ muss ein Wahrheitswert sein.');
    }

    const title = input.title.trim();
    const message = input.message.trim();
    if (!title || !message) {
      throw new BadRequestException('Titel und Nachricht sind Pflichtfelder.');
    }
    if (title.length > 160 || message.length > 2000) {
      throw new BadRequestException('Titel darf maximal 160 und Nachricht maximal 2000 Zeichen lang sein.');
    }
    if (!Object.values(SystemNotificationType).includes(input.type)) {
      throw new BadRequestException('Ungültiger Hinweistyp.');
    }
    if (!Object.values(SystemNotificationSeverity).includes(input.severity)) {
      throw new BadRequestException('Ungültige Priorität.');
    }

    const startsAt = this.parseDate(input.startsAt, 'Startzeit');
    const endsAt = this.parseDate(input.endsAt, 'Endzeit');
    const visibleFrom = this.parseDate(input.visibleFrom, 'Sichtbar ab');
    const visibleUntil = this.parseDate(input.visibleUntil, 'Sichtbar bis');
    if (startsAt && endsAt && endsAt <= startsAt) {
      throw new BadRequestException('Die Endzeit muss nach der Startzeit liegen.');
    }
    if (visibleFrom && visibleUntil && visibleUntil <= visibleFrom) {
      throw new BadRequestException('„Sichtbar bis“ muss nach „Sichtbar ab“ liegen.');
    }

    return {
      type: input.type,
      severity: input.severity,
      title,
      message,
      startsAt,
      endsAt,
      visibleFrom,
      visibleUntil,
      enabled: input.enabled ?? true,
      dismissible: input.dismissible ?? false
    };
  }

  private parseDate(value: string | null | undefined, field: string): Date | null {
    if (!value) return null;
    if (typeof value !== 'string') {
      throw new BadRequestException(`${field} ist kein gültiger Zeitpunkt.`);
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`${field} ist kein gültiger Zeitpunkt.`);
    }
    return parsed;
  }

  private toDto(notification: SystemNotification): SystemNotificationDto {
    return {
      id: notification.id,
      type: notification.type,
      severity: notification.severity,
      title: notification.title,
      message: notification.message,
      startsAt: notification.startsAt?.toISOString() ?? null,
      endsAt: notification.endsAt?.toISOString() ?? null,
      visibleFrom: notification.visibleFrom?.toISOString() ?? null,
      visibleUntil: notification.visibleUntil?.toISOString() ?? null,
      enabled: notification.enabled,
      dismissible: notification.dismissible,
      createdAt: notification.createdAt.toISOString(),
      updatedAt: notification.updatedAt.toISOString()
    };
  }
}
