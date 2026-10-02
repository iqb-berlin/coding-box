import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  SystemNotificationSeverity,
  SystemNotificationType
} from '../../../../../../api-dto/system-notifications/system-notification.dto';
import { SystemNotification } from '../../database/entities/system-notification.entity';
import { SystemNotificationService } from './system-notification.service';

const baseInput = {
  type: SystemNotificationType.Maintenance,
  severity: SystemNotificationSeverity.High,
  title: ' Wartung ',
  message: ' Die Anwendung ist kurzzeitig nicht verfügbar. '
};

function entity(overrides: Partial<SystemNotification> = {}): SystemNotification {
  return {
    id: 1,
    type: SystemNotificationType.Info,
    severity: SystemNotificationSeverity.Low,
    title: 'Info',
    message: 'Text',
    startsAt: null,
    endsAt: null,
    visibleFrom: null,
    visibleUntil: null,
    enabled: true,
    dismissible: false,
    createdAt: new Date('2026-07-01T10:00:00Z'),
    updatedAt: new Date('2026-07-01T11:00:00Z'),
    ...overrides
  };
}

function repositoryMock(found: SystemNotification | null = null) {
  const queryBuilder = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(found ? [found] : [])
  };
  return {
    find: jest.fn().mockResolvedValue(found ? [found] : []),
    findOne: jest.fn().mockResolvedValue(found),
    create: jest.fn().mockImplementation(value => ({ ...entity(), ...value })),
    save: jest.fn().mockImplementation(value => Promise.resolve(value)),
    remove: jest.fn().mockResolvedValue(found),
    createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    queryBuilder
  };
}

describe('SystemNotificationService', () => {
  it('creates a normalized notification with UTC dates', async () => {
    const repository = repositoryMock();
    const service = new SystemNotificationService(repository as never);

    const result = await service.create({
      ...baseInput,
      startsAt: '2026-07-12T10:00:00+02:00',
      endsAt: '2026-07-12T11:00:00+02:00'
    });

    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Wartung',
      message: 'Die Anwendung ist kurzzeitig nicht verfügbar.',
      startsAt: new Date('2026-07-12T08:00:00Z'),
      endsAt: new Date('2026-07-12T09:00:00Z'),
      enabled: true,
      dismissible: false
    }));
    expect(result.startsAt).toBe('2026-07-12T08:00:00.000Z');
  });

  it.each([
    [{ ...baseInput, title: ' ' }, 'required fields'],
    [{ ...baseInput, title: 123 }, 'title type'],
    [{ ...baseInput, enabled: 'false' }, 'boolean type'],
    [{ ...baseInput, type: 'other' }, 'type'],
    [{ ...baseInput, startsAt: 'invalid' }, 'date'],
    [{ ...baseInput, startsAt: '2026-07-12T12:00:00Z', endsAt: '2026-07-12T11:00:00Z' }, 'event window'],
    [{ ...baseInput, visibleFrom: '2026-07-12T12:00:00Z', visibleUntil: '2026-07-12T11:00:00Z' }, 'visibility window']
  ])('rejects invalid input: %s (%s)', async (input, _description) => {
    expect(_description).toBeTruthy();
    const service = new SystemNotificationService(repositoryMock() as never);
    await expect(service.create(input as never)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('queries active notifications using visibility and event-window fallbacks', async () => {
    const repository = repositoryMock(entity());
    const service = new SystemNotificationService(repository as never);
    const now = new Date('2026-07-12T10:30:00Z');

    await expect(service.findActive(now)).resolves.toHaveLength(1);

    expect(repository.queryBuilder.andWhere).toHaveBeenCalledTimes(2);
    expect(repository.queryBuilder.andWhere.mock.calls[0][0]).toContain('visible_from');
    expect(repository.queryBuilder.andWhere.mock.calls[0][0]).toContain('starts_at');
    expect(repository.queryBuilder.andWhere.mock.calls[1][0]).toContain('visible_until');
    expect(repository.queryBuilder.andWhere.mock.calls[1][0]).toContain('ends_at');
  });

  it('makes an edited notification visible through its new updatedAt version', async () => {
    const existing = entity();
    const repository = repositoryMock(existing);
    repository.save.mockImplementation(value => Promise.resolve({
      ...value,
      updatedAt: new Date('2026-07-02T11:00:00Z')
    }));
    const service = new SystemNotificationService(repository as never);

    const result = await service.update(1, baseInput);

    expect(result.updatedAt).toBe('2026-07-02T11:00:00.000Z');
  });

  it('rejects updates and deletes for unknown notifications', async () => {
    const service = new SystemNotificationService(repositoryMock() as never);

    await expect(service.update(404, baseInput)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.delete(404)).rejects.toBeInstanceOf(NotFoundException);
  });
});
