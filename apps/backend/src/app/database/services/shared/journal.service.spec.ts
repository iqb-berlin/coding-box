import { parseString } from 'fast-csv';
import { JournalEntry } from '../../entities/journal-entry.entity';
import { JournalService } from './journal.service';

describe('JournalService', () => {
  const createService = (): JournalService => new JournalService({} as never);

  it('uses only the transaction repository when recording a transactional event', async () => {
    const repository = { create: jest.fn(entry => entry), save: jest.fn(async entry => entry) };
    const manager = { getRepository: jest.fn().mockReturnValue(repository) };
    await JournalService.recordEventInTransaction(manager as never, {
      workspaceId: 3,
      actorUserId: 7,
      eventType: 'TEST_PERSON_DELETED',
      entityId: 42,
      details: { token: 'secret', count: 1 }
    });
    expect(manager.getRepository).toHaveBeenCalledWith(JournalEntry);
    expect(repository.save).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 3, actorUserId: 7, details: { count: 1 }
    }));
  });

  it('records grants, role changes and revocations, but skips unchanged access', async () => {
    const repository = { create: jest.fn(entry => entry), save: jest.fn(async entry => entry) };
    const manager = { getRepository: jest.fn().mockReturnValue(repository) };
    await JournalService.recordAccessChangesInTransaction(manager as never, 3, [{ userId: 1, accessLevel: 1 }, { userId: 2, accessLevel: 2 }, { userId: 3, accessLevel: 3 }], [{ userId: 1, accessLevel: 1 }, { userId: 2, accessLevel: 3 }, { userId: 4, accessLevel: 1 }], 7);
    expect(repository.save).toHaveBeenCalledTimes(3);
    expect(repository.save.mock.calls.map(([entry]) => entry.entityId)).toEqual(['2', '3', '4']);
    expect(repository.save).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: 7,
      eventType: 'ACCESS_LEVEL_CHANGED',
      entityId: '3',
      details: {
        previousAccessLevel: 3, accessLevel: 0, previousCanCode: false, canCode: false
      }
    }));
  });

  it.each(['=1+1', '+SUM(1,1)', '-1+1', '@SUM(1,1)', ' \t=1+1', '\r\n+1', '\u0000=1', '\u001f@A1'])(
    'escapes formula prefixes in every CSV text column: %j', async payload => {
      const entry = {
        id: 1,
        timestamp: new Date('2026-10-05T00:00:00Z'),
        userId: payload,
        actorUserId: null,
        actorType: 'user',
        workspaceId: 3,
        actionType: 'create',
        eventType: payload,
        entityType: payload,
        entityId: payload,
        result: 'success',
        summary: payload,
        correlationId: payload,
        jobId: payload,
        details: { note: 'comma, quote" and newline\n' }
      } as JournalEntry;
      const repository = { find: jest.fn().mockResolvedValue([entry]) };
      const csvText = await new JournalService(repository as never).generateCsv(3);
      const rows = await new Promise<Record<string, string>[]>((resolve, reject) => {
        const parsed: Record<string, string>[] = [];
        parseString(csvText, { headers: true }).on('data', row => parsed.push(row))
          .on('error', reject).on('end', () => resolve(parsed));
      });
      expect(rows).toHaveLength(1);
      for (const key of ['actorId', 'eventType', 'entityType', 'entityId', 'summary', 'correlationId', 'jobId']) {
        const source = key === 'actorId' ? payload.trim() : payload;
        expect(rows[0][key]).toBe(`'${source.replace(/[\r\n\t]+/g, ' ')}`);
      }
      expect(JSON.parse(rows[0].details)).toEqual(entry.details);
      expect(repository.find).toHaveBeenCalledWith({ where: { workspaceId: 3 }, order: { timestamp: 'DESC' } });
    }
  );

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
