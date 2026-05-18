import { JournalEntry } from '../../entities/journal-entry.entity';
import { JournalService } from './journal.service';

describe('JournalService', () => {
  const createService = (): JournalService => new JournalService({} as never);

  it('sanitizes legacy details when mapping entries to audit DTOs', () => {
    const service = createService();
    const entry = {
      id: 1,
      timestamp: new Date('2026-05-18T10:00:00.000Z'),
      userId: '7',
      actorUserId: 7,
      actorType: 'user',
      workspaceId: 3,
      actionType: 'delete',
      eventType: null,
      entityType: 'response',
      entityId: '42',
      result: 'success',
      summary: 'Response deleted',
      correlationId: null,
      jobId: null,
      details: {
        code: 'person-code',
        group: 'person-group',
        login: 'person-login',
        personId: 99,
        requestBody: {
          keep: 'nope',
          token: 'secret'
        },
        responseValues: ['raw-a', 'raw-b'],
        unitId: 12,
        variableId: 'VAR1',
        nested: {
          kept: 'ok',
          personCode: 'nested-code'
        },
        responses: [
          {
            variableId: 'v1',
            value: 'raw-value'
          }
        ],
        preview: {
          label: '1 selected',
          persons: 1,
          groups: ['person-group'],
          unitNames: ['unit-a'],
          warnings: ['warning']
        }
      }
    } as JournalEntry;

    expect(service.toAuditDto(entry)).toMatchObject({
      actorId: null,
      actorUserId: 7,
      eventType: 'RESPONSE_DELETED',
      details: {
        unitId: 12,
        variableId: 'VAR1',
        nested: {
          kept: 'ok'
        },
        responses: [
          {
            variableId: 'v1'
          }
        ],
        preview: {
          persons: 1,
          warnings: ['warning']
        }
      }
    });
    expect(service.toAuditDto(entry).details?.preview).not.toHaveProperty('label');
  });

  it('preserves non-numeric actor IDs in the legacy userId column', async () => {
    const repository = {
      create: jest.fn(entry => entry),
      save: jest.fn(entry => Promise.resolve(entry))
    };
    const service = new JournalService(repository as never);

    await service.recordEvent({
      workspaceId: 3,
      actorUserId: 'user-1',
      eventType: 'DATABASE_EXPORT_STARTED',
      entityType: 'workspace',
      entityId: 3
    });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        actorUserId: null,
        actorType: 'user',
        actionType: 'export',
        eventType: 'DATABASE_EXPORT_STARTED'
      })
    );
  });

  it('stores canonical event types separately from legacy action types', async () => {
    const repository = {
      create: jest.fn(entry => entry),
      save: jest.fn(entry => Promise.resolve(entry))
    };
    const service = new JournalService(repository as never);

    await service.recordEvent({
      workspaceId: 3,
      actorUserId: 7,
      eventType: 'RESPONSE_DELETED',
      entityType: 'response',
      entityId: 42
    });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'delete',
        eventType: 'RESPONSE_DELETED'
      })
    );
  });

  it('filters legacy action types through the legacy action_type column', async () => {
    const queryBuilder = {
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0])
    };
    const repository = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder)
    };
    const service = new JournalService(repository as never);

    await service.search({ workspaceId: 3, actionType: 'delete' });

    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'journal.actionType = :actionType',
      { actionType: 'delete' }
    );
    expect(queryBuilder.andWhere).not.toHaveBeenCalledWith(
      expect.stringContaining('journal.eventType'),
      expect.objectContaining({ eventType: 'delete' })
    );
  });

  it('exposes non-numeric actor IDs in audit DTOs', () => {
    const service = createService();
    const entry = {
      id: 2,
      timestamp: new Date('2026-05-18T11:00:00.000Z'),
      userId: 'user-1',
      actorUserId: null,
      actorType: 'user',
      workspaceId: 3,
      actionType: 'export',
      eventType: 'DATABASE_EXPORT_STARTED',
      entityType: 'workspace',
      entityId: '3',
      result: 'started',
      summary: 'Database export started',
      correlationId: null,
      jobId: 'job-1',
      details: null
    } as JournalEntry;

    expect(service.toAuditDto(entry)).toMatchObject({
      actorId: 'user-1',
      actorUserId: null,
      actorType: 'user'
    });
  });

  it('includes opaque actor IDs in generated CSV exports', async () => {
    const repository = {
      find: jest.fn().mockResolvedValue([
        {
          id: 2,
          timestamp: new Date('2026-05-18T11:00:00.000Z'),
          userId: 'user-1',
          actorUserId: null,
          actorType: 'user',
          workspaceId: 3,
          actionType: 'export',
          eventType: 'DATABASE_EXPORT_STARTED',
          entityType: 'workspace',
          entityId: '3',
          result: 'started',
          summary: 'Database export started',
          correlationId: null,
          jobId: 'job-1',
          details: null
        } as JournalEntry
      ])
    };
    const service = new JournalService(repository as never);

    const csv = await service.generateCsv(3);

    expect(csv.split('\n')[0].split(',')).toEqual([
      'id',
      'timestamp',
      'workspaceId',
      'actorId',
      'actorUserId',
      'actorType',
      'eventType',
      'entityType',
      'entityId',
      'result',
      'summary',
      'correlationId',
      'jobId',
      'details'
    ]);
    expect(csv.split('\n')[1]).toContain('user-1,,user,DATABASE_EXPORT_STARTED');
  });
});
