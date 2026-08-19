import {
  DataSource,
  EntitySchema,
  Repository
} from 'typeorm';
import { ResponseEntity } from '../../entities/response.entity';
import { buildAggregationUnitNameQuery } from './coding-results.service';

interface PersonSchemaRecord {
  id: number;
  workspace_id: number;
  consider: boolean;
}

interface BookletInfoSchemaRecord {
  id: number;
}

interface BookletSchemaRecord {
  id: number;
  person: PersonSchemaRecord;
  bookletinfo: BookletInfoSchemaRecord;
}

interface UnitSchemaRecord {
  id: number;
  name: string;
  booklet: BookletSchemaRecord;
}

interface ResponseSchemaRecord {
  id: number;
  variableid: string;
  status_v1: number;
  unit: UnitSchemaRecord;
}

describe('buildAggregationUnitNameQuery', () => {
  it('places DISTINCT directly after SELECT in generated PostgreSQL', async () => {
    const personSchema = new EntitySchema<PersonSchemaRecord>({
      name: 'Person',
      tableName: 'person',
      columns: {
        id: { type: Number, primary: true },
        workspace_id: { type: Number },
        consider: { type: Boolean }
      }
    });
    const bookletInfoSchema = new EntitySchema<BookletInfoSchemaRecord>({
      name: 'BookletInfo',
      tableName: 'bookletinfo',
      columns: {
        id: { type: Number, primary: true }
      }
    });
    const bookletSchema = new EntitySchema<BookletSchemaRecord>({
      name: 'Booklet',
      tableName: 'booklet',
      columns: {
        id: { type: Number, primary: true }
      },
      relations: {
        person: {
          type: 'many-to-one',
          target: 'Person',
          joinColumn: { name: 'person_id' }
        },
        bookletinfo: {
          type: 'many-to-one',
          target: 'BookletInfo',
          joinColumn: { name: 'bookletinfo_id' }
        }
      }
    });
    const unitSchema = new EntitySchema<UnitSchemaRecord>({
      name: 'Unit',
      tableName: 'unit',
      columns: {
        id: { type: Number, primary: true },
        name: { type: String }
      },
      relations: {
        booklet: {
          type: 'many-to-one',
          target: 'Booklet',
          joinColumn: { name: 'booklet_id' }
        }
      }
    });
    const responseSchema = new EntitySchema<ResponseSchemaRecord>({
      name: 'Response',
      tableName: 'response',
      columns: {
        id: { type: Number, primary: true },
        variableid: { type: String },
        status_v1: { type: Number }
      },
      relations: {
        unit: {
          type: 'many-to-one',
          target: 'Unit',
          joinColumn: { name: 'unit_id' }
        }
      }
    });
    const dataSource = new DataSource({
      type: 'postgres',
      entities: [
        responseSchema,
        unitSchema,
        bookletSchema,
        bookletInfoSchema,
        personSchema
      ]
    });

    await (dataSource as unknown as {
      buildMetadatas: () => Promise<void>;
    }).buildMetadatas();

    const repository = dataSource.getRepository('Response') as unknown as Repository<ResponseEntity>;
    const sql = buildAggregationUnitNameQuery(repository, 17, ['VAR']).getSql();

    expect(sql).toMatch(/^SELECT DISTINCT /);
    expect(sql).not.toContain(', DISTINCT ');
    expect(sql).toContain('"unit"."name" AS "unitName"');
    expect(sql).toContain('"response"."variableid" AS "variableId"');
  });
});
