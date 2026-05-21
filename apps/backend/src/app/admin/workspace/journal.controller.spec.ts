import { BadRequestException } from '@nestjs/common';
import { JournalService } from '../../database/services/shared';
import { JournalController } from './journal.controller';

describe('JournalController', () => {
  it('treats date-only toDate filters as inclusive through the end of the selected day', async () => {
    const journalService = {
      search: jest.fn().mockResolvedValue({
        data: [],
        total: 0,
        page: 1,
        limit: 20
      })
    } as unknown as JournalService;
    const controller = new JournalController(journalService);

    await controller.getJournalEntries(
      3,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      '2026-05-18'
    );

    const [filters] = (journalService.search as jest.Mock).mock.calls[0];
    const toDate = filters.toDate as Date;
    expect(toDate.getFullYear()).toBe(2026);
    expect(toDate.getMonth()).toBe(4);
    expect(toDate.getDate()).toBe(18);
    expect(toDate.getHours()).toBe(23);
    expect(toDate.getMinutes()).toBe(59);
    expect(toDate.getSeconds()).toBe(59);
    expect(toDate.getMilliseconds()).toBe(999);
  });

  it('rejects invalid date-only filters instead of normalizing them', async () => {
    const journalService = {
      search: jest.fn()
    } as unknown as JournalService;
    const controller = new JournalController(journalService);

    await expect(controller.getJournalEntries(
      3,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      '2026-02-31'
    )).rejects.toThrow(BadRequestException);

    expect(journalService.search).not.toHaveBeenCalled();
  });

  it('rejects invalid ISO datetime filters instead of normalizing them', async () => {
    const journalService = {
      search: jest.fn()
    } as unknown as JournalService;
    const controller = new JournalController(journalService);

    await expect(controller.getJournalEntries(
      3,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      '2026-02-31T00:00:00Z'
    )).rejects.toThrow(BadRequestException);

    expect(journalService.search).not.toHaveBeenCalled();
  });

  it('keeps deprecated actionType query filters separate from canonical event types', async () => {
    const journalService = {
      search: jest.fn().mockResolvedValue({
        data: [],
        total: 0,
        page: 1,
        limit: 20
      })
    } as unknown as JournalService;
    const controller = new JournalController(journalService);

    await controller.getJournalEntries(
      3,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'delete'
    );

    expect(journalService.search).toHaveBeenCalledWith(
      {
        workspaceId: 3,
        actionType: 'delete'
      },
      {
        page: undefined,
        limit: undefined
      }
    );
  });

  it('uses the legacy actionType filter for the legacy action route', async () => {
    const journalService = {
      search: jest.fn().mockResolvedValue({
        data: [],
        total: 0,
        page: 1,
        limit: 20
      })
    } as unknown as JournalService;
    const controller = new JournalController(journalService);

    await controller.getJournalEntriesByAction(3, 'delete');

    expect(journalService.search).toHaveBeenCalledWith(
      {
        workspaceId: 3,
        actionType: 'delete'
      },
      {
        page: undefined,
        limit: undefined
      }
    );
  });

  it('uses the legacy userId filter for non-numeric user IDs', async () => {
    const journalService = {
      search: jest.fn().mockResolvedValue({
        data: [],
        total: 0,
        page: 1,
        limit: 20
      })
    } as unknown as JournalService;
    const controller = new JournalController(journalService);

    await controller.getJournalEntriesByUser(3, 'user-1');

    expect(journalService.search).toHaveBeenCalledWith(
      {
        workspaceId: 3,
        legacyUserId: 'user-1'
      },
      {
        page: undefined,
        limit: undefined
      }
    );
  });

  it('rejects array details from JSON request bodies', async () => {
    const journalService = {
      recordEvent: jest.fn()
    } as unknown as JournalService;
    const controller = new JournalController(journalService);

    await expect(controller.createJournalEntry(
      3,
      {
        action_type: 'create',
        entity_type: 'workspace',
        entity_id: '3',
        details: [] as never
      },
      {
        user: {
          id: 'user-1'
        }
      } as never
    )).rejects.toThrow(BadRequestException);

    expect(journalService.recordEvent).not.toHaveBeenCalled();
  });

  it('rejects invalid result values when creating entries', async () => {
    const journalService = {
      recordEvent: jest.fn()
    } as unknown as JournalService;
    const controller = new JournalController(journalService);

    await expect(controller.createJournalEntry(
      3,
      {
        action_type: 'delete',
        eventType: 'RESPONSE_DELETED',
        entity_type: 'response',
        entity_id: '42',
        result: 'done' as never
      },
      {
        user: {
          id: 7
        }
      } as never
    )).rejects.toThrow(BadRequestException);

    expect(journalService.recordEvent).not.toHaveBeenCalled();
  });

  it('rejects invalid actor types when creating entries', async () => {
    const journalService = {
      recordEvent: jest.fn()
    } as unknown as JournalService;
    const controller = new JournalController(journalService);

    await expect(controller.createJournalEntry(
      3,
      {
        action_type: 'delete',
        eventType: 'RESPONSE_DELETED',
        entity_type: 'response',
        entity_id: '42',
        actorType: 'person' as never
      },
      {
        user: {
          id: 7
        }
      } as never
    )).rejects.toThrow(BadRequestException);

    expect(journalService.recordEvent).not.toHaveBeenCalled();
  });

  it('maps legacy action and entity fields to canonical event types when creating entries', async () => {
    const createdEntry = {
      id: 1
    };
    const auditDto = {
      id: 1,
      timestamp: '2026-05-18T10:00:00.000Z',
      workspaceId: 3,
      actorId: null,
      actorUserId: 7,
      actorType: 'user',
      eventType: 'RESPONSE_DELETED',
      entityType: 'response',
      entityId: '42',
      result: 'success',
      summary: 'Response deleted',
      details: null
    };
    const journalService = {
      mapLegacyEventType: jest.fn().mockReturnValue('RESPONSE_DELETED'),
      recordEvent: jest.fn().mockResolvedValue(createdEntry),
      toAuditDto: jest.fn().mockReturnValue(auditDto)
    } as unknown as JournalService;
    const controller = new JournalController(journalService);

    await expect(controller.createJournalEntry(
      3,
      {
        action_type: 'delete',
        entity_type: 'response',
        entity_id: '42'
      },
      {
        user: {
          id: 7
        }
      } as never
    )).resolves.toEqual(auditDto);

    expect(journalService.mapLegacyEventType).toHaveBeenCalledWith('delete', 'response');
    expect(journalService.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 3,
        actorUserId: 7,
        eventType: 'RESPONSE_DELETED',
        legacyActionType: 'delete',
        entityType: 'response',
        entityId: '42',
        result: 'success'
      })
    );
  });
});
