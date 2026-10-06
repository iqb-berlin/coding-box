import { EntityManager } from 'typeorm';
import { PersonPersistenceService } from './person-persistence.service';
import { Person } from '../shared';
import Persons from '../../entities/persons.entity';
import { Booklet } from '../../entities/booklet.entity';
import { Unit } from '../../entities/unit.entity';
import { UnitLastState } from '../../entities/unitLastState.entity';
import { BookletInfo } from '../../entities/bookletInfo.entity';
import { ResponseEntity } from '../../entities/response.entity';
import { ChunkEntity } from '../../entities/chunk.entity';
import { BookletLog } from '../../entities/bookletLog.entity';
import { Session } from '../../entities/session.entity';
import { UnitLog } from '../../entities/unitLog.entity';
import { JournalEntry } from '../../entities/journal-entry.entity';

describe('Import batch audit atomicity', () => {
  function fixture(failAudit = false) {
    const person: Person = {
      workspace_id: 3,
      group: 'g',
      login: 'l',
      code: 'c',
      booklets: [{
        id: 'B',
        sessions: [],
        logs: [{ ts: '100', key: 'k', parameter: 'new-log' }],
        units: [{
          id: 'U',
          alias: 'U',
          chunks: [],
          laststate: [],
          logs: [],
          subforms: [{
            id: 's', responses: [{ id: 'v', status: 'VALUE_CHANGED', value: 'new-answer' }]
          }]
        }]
      }]
    };
    let committed = { responses: ['old-answer'], logs: ['old-log'], events: [] as JournalEntry[] };
    let pending = structuredClone(committed);
    let depth = 0;
    const repositories = new Map<unknown, unknown>();
    const manager = {
      query: jest.fn().mockResolvedValue([]),
      getRepository: entity => repositories.get(entity),
      transaction: async callback => {
        const snapshot = structuredClone(pending);
        depth += 1;
        try {
          const result = await callback(manager);
          if (depth === 1) committed = structuredClone(pending);
          return result;
        } catch (error) {
          pending = snapshot;
          throw error;
        } finally {
          depth -= 1;
        }
      }
    } as unknown as EntityManager;
    const queryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([{ ...person, id: 1 }])
    };
    repositories.set(Persons, {
      manager,
      upsert: jest.fn(),
      createQueryBuilder: () => queryBuilder,
      find: async () => [{ ...person, id: 1 }],
      findOne: async () => ({ ...person, id: 1 })
    });
    repositories.set(Booklet, { findOne: async () => ({ id: 2, personid: 1, infoid: 4 }) });
    repositories.set(BookletInfo, { findOne: async () => ({ id: 4, name: 'B' }) });
    repositories.set(Unit, { manager, findOne: async () => ({ id: 5, name: 'U' }) });
    repositories.set(UnitLastState, { find: async () => [] });
    repositories.set(ChunkEntity, { delete: jest.fn() });
    const deleteQuery = {
      delete: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute: async () => { const affected = pending.responses.length; pending.responses = []; return { affected }; }
    };
    repositories.set(ResponseEntity, {
      createQueryBuilder: () => deleteQuery,
      save: async (entries: Array<{ value: string }>) => {
        pending.responses.push(...entries.map(entry => entry.value));
        return entries.map((entry, index) => ({ ...entry, id: 100 + index }));
      }
    });
    repositories.set(BookletLog, {
      count: async () => pending.logs.length,
      delete: async () => { pending.logs = []; },
      save: async (entries: Array<{ parameter: string }>) => { pending.logs.push(...entries.map(entry => entry.parameter)); }
    });
    repositories.set(Session, { delete: jest.fn() });
    repositories.set(UnitLog, { count: async () => 0, save: jest.fn(), delete: jest.fn() });
    repositories.set(JournalEntry, {
      create: entry => entry,
      save: async (entry: JournalEntry) => {
        if (failAudit) throw new Error('audit unavailable');
        pending.events.push(entry);
        return entry;
      }
    });
    const entities = [Persons, Booklet, Unit, UnitLastState, BookletInfo, ResponseEntity, ChunkEntity, BookletLog, Session, UnitLog];
    const service = new PersonPersistenceService(...entities.map(entity => repositories.get(entity)) as ConstructorParameters<typeof PersonPersistenceService>);
    return { service, person, state: () => committed };
  }

  const audit = {
    workspaceId: 3, actorUserId: 7, actorType: 'job' as const, jobId: 'upload-1', source: 'upload' as const
  };

  it('rolls back replacement deletions and inserts when the batch audit fails', async () => {
    const f = fixture(true);
    await expect(f.service.processPersonBooklets([f.person], 3, 'replace', 'person', [], audit)).rejects.toThrow('audit unavailable');
    expect(f.state()).toEqual({ responses: ['old-answer'], logs: ['old-log'], events: [] });
  });

  it('commits replacement data together with a sanitized trusted event', async () => {
    const f = fixture();
    expect(await f.service.processPersonBooklets([f.person], 3, 'replace', 'person', [], audit)).toMatchObject({ savedResponseCount: 1, deletedResponseCount: 1 });
    expect(f.state().responses).toEqual(['new-answer']);
    expect(f.state().events).toEqual([expect.objectContaining({
      workspaceId: 3,
      actorUserId: 7,
      jobId: 'upload-1',
      eventType: 'TEST_RESULTS_IMPORTED',
      details: expect.objectContaining({ phase: 'responses', savedResponses: 1, deletedResponses: 1 })
    })]);
    expect(JSON.stringify(f.state().events)).not.toContain('new-answer');
  });

  it('rolls back overwritten logs when the batch audit fails', async () => {
    const f = fixture(true);
    await expect(f.service.processPersonLogs([f.person], [], [], true, audit)).rejects.toThrow('audit unavailable');
    expect(f.state().logs).toEqual(['old-log']);
    expect(f.state().events).toEqual([]);
  });

  it('commits overwritten logs with their batch event', async () => {
    const f = fixture();
    expect(await f.service.processPersonLogs([f.person], [], [], true, audit)).toMatchObject({ success: true, totalLogsSaved: 1 });
    expect(f.state().logs).toEqual(['new-log']);
    expect(f.state().events).toEqual([expect.objectContaining({ details: expect.objectContaining({ phase: 'logs', savedLogs: 1 }) })]);
  });

  it('includes both booklet and unit log counts in the audit', async () => {
    const f = fixture();
    f.person.booklets[0].units[0].logs.push({ ts: '101', key: 'u', parameter: 'unit-log' });
    expect(await f.service.processPersonLogs([f.person], [], [], true, audit)).toMatchObject({ success: true, totalLogsSaved: 2 });
    expect(f.state().events).toEqual([expect.objectContaining({ details: expect.objectContaining({ savedLogs: 2 }) })]);
  });
});
