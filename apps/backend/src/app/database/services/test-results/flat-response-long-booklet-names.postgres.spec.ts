import { createHash } from 'crypto';
import { KappaPostgresFixture } from '../coding/kappa-query.postgres.test.factory';
import { PersonPersistenceService } from './person-persistence.service';
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
import { findProjectedFlatResponsePage } from './flat-response-first-page';

const serverUrl = process.env.KAPPA_QUERY_TEST_DATABASE_URL;
const describePostgres = serverUrl ? describe : describe.skip;

describePostgres('Response projections for long booklet names', () => {
  it.each(['backfill', 'import'])('preserves full booklet order and totals during %s', async phase => {
    const fixture = new KappaPostgresFixture();
    // Incompressible text exercises PostgreSQL's B-tree tuple limit even with TOAST enabled.
    const text = Array.from({ length: 42 }, (_, i) => createHash('sha256').update(String(i)).digest('hex')).join('');
    const prefix = `B${text.slice(0, 2650)}`;
    const firstLong = `${prefix}1`;
    const secondLong = `${prefix}2`;
    let workspaceId: number;

    const importResponses = async () => {
      workspaceId = await fixture.insert('workspace', { name: 'Long booklet names' });
      const { db } = fixture;
      const importer = new PersonPersistenceService(
        db.getRepository(Persons),
        db.getRepository(Booklet),
        db.getRepository(Unit),
        db.getRepository(UnitLastState),
        db.getRepository(BookletInfo),
        db.getRepository(ResponseEntity),
        db.getRepository(ChunkEntity),
        db.getRepository(BookletLog),
        db.getRepository(Session),
        db.getRepository(UnitLog)
      );
      // The import order and the aliases both favor the wrong long booklet if
      // the sort loses the distinguishing final character.
      const result = await importer.processPersonBooklets([{
        workspace_id: workspaceId,
        code: text.slice(0, 100),
        login: 'login',
        group: 'group',
        booklets: ['C', secondLong, firstLong, 'A'].map((id, index) => ({
          id,
          sessions: [],
          logs: [],
          units: [{
            id: text.slice(100, 200),
            alias: `${index}${text.slice(200, 299)}`,
            laststate: [],
            chunks: [],
            logs: [],
            subforms: [{ id: '', responses: [{ id: 'V', status: 'VALUE_CHANGED', value: 'match' }] }]
          }]
        }))
      }], workspaceId, 'skip', 'person', [], { workspaceId, source: 'upload' });
      expect(result.savedResponseCount).toBe(4);
    };

    try {
      if (phase === 'backfill') {
        await fixture.open(serverUrl!, { file: 'coding-box.changelog-response-list-search.sql', seed: importResponses });
      } else {
        await fixture.open(serverUrl!);
        await importResponses();
      }

      const page = (projection: 'compact' | 'value', number: number, ignoredBooklets: string[] = []) => (
        findProjectedFlatResponsePage(
          fixture.db,
          workspaceId,
          { globalIgnoredUnits: [], testletIgnoredUnits: [], ignoredBooklets },
          { number, size: 2 },
          projection,
          'match'
        )
      );
      const firstPage = { raw: [{ booklet: 'A' }, { booklet: firstLong }], total: 4 };
      await expect(page('compact', 1)).resolves.toMatchObject(firstPage);
      await expect(page('value', 1)).resolves.toMatchObject(firstPage);
      await expect(page('value', 2)).resolves.toMatchObject({ raw: [{ booklet: secondLong }, { booklet: 'C' }], total: 4 });
      await expect(page('compact', 1, [firstLong])).resolves.toMatchObject({
        raw: [{ booklet: 'A' }, { booklet: secondLong }], total: 3
      });
    } finally {
      await fixture.close();
    }
  }, 60000);
});
