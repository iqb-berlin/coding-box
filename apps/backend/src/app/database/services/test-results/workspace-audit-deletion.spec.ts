import { JournalEntry } from '../../entities/journal-entry.entity';
import { JournalService } from '../shared/journal.service';
import { WorkspaceTestResultsService } from './workspace-test-results.service';

describe('Workspace deletion audit boundaries', () => {
  function fixture(personCount = 1) {
    const persons = new Map(Array.from({ length: personCount }, (_, i) => [i + 1, { id: i + 1, workspace_id: 3 }]));
    persons.set(999, { id: 999, workspace_id: 4 });
    const journal: JournalEntry[] = [];
    let failAuditOnAttempt = 0;
    let auditAttempts = 0;
    const transactionManagers: unknown[] = [];
    const predicates: string[] = [];
    const connection = {
      createQueryRunner: () => ({ connect: jest.fn(), query: jest.fn(), release: jest.fn() }),
      transaction: jest.fn(async callback => {
        const pendingDeletions = new Set<number>();
        const pendingEvents: JournalEntry[] = [];
        const repository = {
          create: jest.fn(entry => entry),
          save: jest.fn(async entry => {
            auditAttempts += 1;
            if (auditAttempts === failAuditOnAttempt) throw new Error('audit unavailable');
            pendingEvents.push(entry);
            return entry;
          })
        };
        const manager = {
          getRepository: jest.fn(entity => {
            expect(entity).toBe(JournalEntry);
            return repository;
          }),
          createQueryBuilder: jest.fn(() => {
            const params: { ids?: (number | string)[]; workspaceId?: number } = {};
            const builder = {
              select: jest.fn().mockReturnThis(),
              delete: jest.fn().mockReturnThis(),
              from: jest.fn().mockReturnThis(),
              where: jest.fn((sql, values) => { predicates.push(sql); Object.assign(params, values); return builder; }),
              andWhere: jest.fn((sql, values) => { predicates.push(sql); Object.assign(params, values); return builder; }),
              getMany: jest.fn(async () => [...persons.values()].filter(person => params.ids?.map(Number).includes(person.id) && (params.workspaceId === undefined || person.workspace_id === params.workspaceId))),
              execute: jest.fn(async () => {
                const matches = [...persons.values()].filter(person => params.ids?.map(Number).includes(person.id) && (params.workspaceId === undefined || person.workspace_id === params.workspaceId));
                matches.forEach(person => pendingDeletions.add(person.id));
                return { affected: matches.length };
              })
            };
            return builder;
          })
        };
        transactionManagers.push(manager);
        const result = await callback(manager);
        pendingDeletions.forEach(id => persons.delete(id));
        journal.push(...pendingEvents);
        return result;
      })
    };
    const journalService = new JournalService({} as never);
    const record = jest.spyOn(journalService, 'recordEvent');
    const invalidateCaches = jest.fn().mockResolvedValue(undefined);
    const service = Object.assign(Object.create(WorkspaceTestResultsService.prototype), {
      connection,
      journalService,
      logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
      invalidateCachesAfterTestResultDeletion: invalidateCaches
    }) as WorkspaceTestResultsService;
    return {
      service,
      persons,
      journal,
      connection,
      record,
      predicates,
      transactionManagers,
      invalidateCaches,
      failAudit: (attempt: number) => { failAuditOnAttempt = attempt; }
    };
  }

  it('rejects foreign-only IDs without deleting or recording an event', async () => {
    const f = fixture();
    expect(await f.service.deleteTestPersons(3, '999', '7')).toMatchObject({ success: false });
    expect(f.persons.has(999)).toBe(true);
    expect(f.journal).toHaveLength(0);
    expect(f.invalidateCaches).not.toHaveBeenCalled();
  });

  it('restricts both selection and deletion of mixed IDs to the requested workspace', async () => {
    const f = fixture();
    expect(await f.service.deleteTestPersons(3, '1,999', '7')).toMatchObject({ success: true, report: { deletedPersons: [1] } });
    expect(f.persons.has(1)).toBe(false);
    expect(f.persons.has(999)).toBe(true);
    expect(f.predicates).toContain('persons.workspace_id = :workspaceId');
    expect(f.predicates).toContain('workspace_id = :workspaceId');
    expect(f.journal).toEqual([expect.objectContaining({ workspaceId: 3, entityId: '1', actorUserId: 7 })]);
    expect(f.record).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'TEST_PERSON_DELETED' }), f.transactionManagers[0]);
  });

  it('rolls back the deletion when the audit write fails', async () => {
    const f = fixture();
    f.failAudit(1);
    await expect(f.service.deleteTestPersons(3, '1', '7')).rejects.toThrow('audit unavailable');
    expect(f.persons.has(1)).toBe(true);
    expect(f.journal).toHaveLength(0);
    expect(f.invalidateCaches).not.toHaveBeenCalled();
  });

  it('keeps the committed audit entry when post-commit cache invalidation fails', async () => {
    const f = fixture();
    f.invalidateCaches.mockRejectedValueOnce(new Error('cache unavailable'));
    await expect(f.service.deleteTestPersons(3, '1', '7')).rejects.toThrow('cache unavailable');
    expect(f.persons.has(1)).toBe(false);
    expect(f.journal).toEqual([expect.objectContaining({ eventType: 'TEST_PERSON_DELETED', entityId: '1' })]);
  });

  it('retains the audit for committed chunks when a later bulk chunk rolls back', async () => {
    const f = fixture(251);
    Object.assign(f.service, {
      resolveDeleteTargets: jest.fn().mockResolvedValue({ kind: 'persons', ids: Array.from({ length: 251 }, (_, i) => i + 1), preview: {} }),
      collectDeleteDependencySnapshot: jest.fn().mockResolvedValue({
        bookletIds: [], unitIds: [], responseIds: [], bookletInfoIds: []
      }),
      deleteKnownDeleteDependents: jest.fn()
    });
    f.failAudit(2);
    await expect(f.service.deleteTestResultsByRequest(3, { scope: 'persons' }, '7')).rejects.toThrow('audit unavailable');
    expect(f.persons.has(1)).toBe(false);
    expect(f.persons.has(250)).toBe(false);
    expect(f.persons.has(251)).toBe(true);
    expect(f.journal).toEqual([expect.objectContaining({
      eventType: 'TEST_RESULTS_DELETED', details: expect.objectContaining({ deletedTargetCount: 250, batchNumber: 1, batchCount: 2 })
    })]);
    expect(f.invalidateCaches).toHaveBeenCalledWith(3);
  });
});
