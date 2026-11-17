import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import pg from 'pg';

const preservedFields = ['database', 'access', 'columns', 'constraints', 'indexes', 'sequences', 'tables'];
export const quoteIdentifier = value => `"${value.replaceAll('"', '""')}"`;

// PostgreSQL 17 deparses varchar[] -> text[] casts element by element. Restrict
// this equivalence to literal varchar arrays; retain every value and other SQL.
export function normalizeConstraintDefinition(definition) {
  const literal = "'(?:[^']|'')*'::character varying";
  const array = new RegExp(`^\\(\\(ARRAY\\[(${literal}(?:, ${literal})*)\\]\\)::text\\[\\]\\)`);
  let result = '';
  for (let offset = 0; offset < definition.length;) {
    const match = definition.slice(offset).match(array);
    if (match) {
      result += `(ARRAY[${[...match[1].matchAll(new RegExp(literal, 'g'))].map(([value]) => `(${value})::text`).join(', ')}])`;
      offset += match[0].length;
      continue;
    }
    const start = offset;
    const quote = definition[offset++];
    // Never rewrite array-like text inside a SQL string or quoted identifier.
    if (quote === "'" || quote === '"') {
      const escapedString = quote === "'" && /(?:^|\W)[eE]$/.test(definition.slice(0, start));
      while (offset < definition.length) {
        if (escapedString && definition[offset] === '\\') { offset += 2; continue; }
        if (definition[offset++] === quote) {
          if (definition[offset] === quote) offset += 1;
          else break;
        }
      }
    } else if (quote === '$') {
      const delimiter = definition.slice(start).match(/^\$(?:[a-zA-Z_][a-zA-Z_0-9]*)?\$/)?.[0];
      const end = delimiter ? definition.indexOf(delimiter, start + delimiter.length) : -1;
      if (end >= 0) offset = end + delimiter.length;
    }
    result += definition.slice(start, offset);
  }
  return result;
}

export function compareSnapshots(before, after) {
  if (before.formatVersion !== 1 || after.formatVersion !== 1 ||
      preservedFields.some(key => before.preserved?.[key] === undefined || after.preserved?.[key] === undefined)) {
    throw new Error('Both inputs must be complete migration snapshots of formatVersion 1.');
  }
  return preservedFields.filter(key => JSON.stringify(before.preserved[key]) !== JSON.stringify(after.preserved[key]));
}

/** Read-only, consistent snapshot. No answer values are written to the report. */
export async function snapshotDatabase(client, timeoutMs = 900000) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2147483647) {
    throw new Error('MIGRATION_SNAPSHOT_TIMEOUT_MS must be a positive integer up to 2147483647.');
  }
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    await client.query("SELECT set_config('statement_timeout', $1, true)", [String(timeoutMs)]);
    await client.query("SET LOCAL timezone = 'UTC'; SET LOCAL datestyle = 'ISO, YMD'; SET LOCAL extra_float_digits = 3");
    const rows = async sql => (await client.query(sql)).rows;
    const [database] = await rows(`SELECT pg_encoding_to_char(encoding) AS encoding, datcollate, datctype,
      pg_get_userbyid(datdba) AS owner,
      ARRAY(SELECT acl::text FROM unnest(datacl) acl ORDER BY acl::text COLLATE "C") AS acl
      FROM pg_database WHERE datname=current_database()`);
    const access = {
      schemas: await rows(`SELECT nspname, pg_get_userbyid(nspowner) AS owner,
        ARRAY(SELECT acl::text FROM unnest(nspacl) acl ORDER BY acl::text COLLATE "C") AS acl
        FROM pg_namespace WHERE nspname='public'`),
      relations: await rows(`SELECT c.relname, c.relkind, pg_get_userbyid(c.relowner) AS owner,
        ARRAY(SELECT acl::text FROM unnest(c.relacl) acl ORDER BY acl::text COLLATE "C") AS acl
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind IN ('r','p','S','v','m','f') ORDER BY c.relname COLLATE "C"`)
    };
    const columns = await rows(`SELECT t.relname AS table_name, a.attname AS column_name,
      row_number() OVER (PARTITION BY t.oid ORDER BY a.attnum)::integer AS position,
      format_type(a.atttypid,a.atttypmod) AS type, a.attnotnull AS not_null, a.attidentity, a.attgenerated,
      pg_get_expr(d.adbin,d.adrelid) AS default_expression, co.collname AS collation,
      ARRAY(SELECT acl::text FROM unnest(a.attacl) acl ORDER BY acl::text COLLATE "C") AS acl
      FROM pg_attribute a JOIN pg_class t ON t.oid=a.attrelid JOIN pg_namespace n ON n.oid=t.relnamespace
      LEFT JOIN pg_attrdef d ON d.adrelid=t.oid AND d.adnum=a.attnum
      LEFT JOIN pg_collation co ON co.oid=a.attcollation
      WHERE n.nspname='public' AND t.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped
      ORDER BY t.relname COLLATE "C", a.attnum`);
    const constraints = await rows(`SELECT t.relname AS table_name, c.conname, c.contype,
      pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c
      JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
      WHERE n.nspname='public' ORDER BY t.relname COLLATE "C", c.conname COLLATE "C"`);
    for (const constraint of constraints) constraint.definition = normalizeConstraintDefinition(constraint.definition);
    const indexes = await rows(`SELECT tablename, indexname, indexdef FROM pg_indexes
      WHERE schemaname='public' ORDER BY tablename COLLATE "C", indexname COLLATE "C"`);
    const relations = await rows(`SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname COLLATE "C"`);
    const tables = [];
    for (const { name } of relations) {
      const hash = createHash('sha256');
      let count = 0;
      await client.query(`DECLARE migration_rows NO SCROLL CURSOR FOR SELECT to_jsonb(t)::text AS data
        FROM public.${quoteIdentifier(name)} t ORDER BY (to_jsonb(t)::text) COLLATE "C"`);
      for (;;) {
        const batch = await rows('FETCH FORWARD 500 FROM migration_rows');
        if (!batch.length) break;
        for (const row of batch) { hash.update(row.data).update('\n'); count += 1; }
      }
      await client.query('CLOSE migration_rows');
      tables.push({ name, rows: count, sha256: hash.digest('hex') });
    }
    const sequences = await rows(`SELECT sequencename, data_type::text, start_value::text, min_value::text,
      max_value::text, increment_by::text, cycle, cache_size::text FROM pg_sequences
      WHERE schemaname='public' ORDER BY sequencename COLLATE "C"`);
    for (const sequence of sequences) {
      const [state] = await rows(`SELECT last_value::text, is_called FROM public.${quoteIdentifier(sequence.sequencename)}`);
      Object.assign(sequence, state);
    }
    const [server] = await rows('SELECT version() AS version');
    const extensions = await rows('SELECT extname, extversion FROM pg_extension ORDER BY extname COLLATE "C"');
    await client.query('COMMIT');
    return { formatVersion: 1, measuredAt: new Date().toISOString(), server: server.version, extensions,
      preserved: { database, access, columns, constraints, indexes, sequences, tables } };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function main() {
  const argument = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
  const reportFile = argument('reportFile');
  if (!reportFile || !process.env.POSTGRES_HOST || !process.env.POSTGRES_DB || !process.env.POSTGRES_USER) {
    throw new Error('Set POSTGRES_HOST, POSTGRES_DB, POSTGRES_USER and --reportFile=path explicitly.');
  }
  const client = new pg.Client({ host: process.env.POSTGRES_HOST, port: Number(process.env.POSTGRES_PORT || 5432),
    database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD,
    connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    const snapshot = await snapshotDatabase(client, Number(process.env.MIGRATION_SNAPSHOT_TIMEOUT_MS || 900000));
    await writeFile(reportFile, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    const baseline = argument('compareWith');
    if (baseline) {
      const differences = compareSnapshots(JSON.parse(await readFile(baseline, 'utf8')), snapshot);
      if (differences.length) throw new Error(`Migration comparison failed: ${differences.join(', ')}. Keep writes disabled.`);
      console.log('PASS: public table contents, columns, constraints, indexes, sequence states, owners/ACLs and database locale match.');
    } else console.log('Read-only migration snapshot written.');
  } finally { await client.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
