import pg from 'pg';
import { writeFileSync } from 'node:fs';

// Explicit environment only, no dotenv/credential discovery, DDL or query text output.
if (!process.env.POSTGRES_HOST || !process.env.POSTGRES_DB || !process.env.POSTGRES_USER) {
  throw new Error('Set POSTGRES_HOST, POSTGRES_DB and POSTGRES_USER for the intended database.');
}
const client = new pg.Client({
  host: process.env.POSTGRES_HOST,
  port: Number(process.env.POSTGRES_PORT || 5432),
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
  connectionTimeoutMillis: 5000
});
try {
  await client.connect();
  await client.query('BEGIN READ ONLY');
  await client.query("SET LOCAL statement_timeout = '10s'");
  const collect = async sql => (await client.query(sql)).rows;
  const settings = await collect(`SELECT name, setting, unit, source FROM pg_settings
    WHERE name IN ('server_version','shared_buffers','work_mem','effective_cache_size',
      'max_connections','max_parallel_workers_per_gather','statement_timeout',
      'idle_in_transaction_session_timeout','shared_preload_libraries') ORDER BY name`);
  const tables = await collect(`SELECT relname, n_live_tup, n_dead_tup, last_autovacuum, last_autoanalyze,
    pg_total_relation_size(relid)::text AS total_bytes
    FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC`);
  const indexes = await collect(`SELECT s.relname, s.indexrelname, s.idx_scan,
    pg_relation_size(s.indexrelid)::text AS bytes, i.indisvalid AS valid
    FROM pg_stat_user_indexes s JOIN pg_index i ON i.indexrelid=s.indexrelid
    ORDER BY pg_relation_size(s.indexrelid) DESC`);
  const waits = await collect(`SELECT wait_event_type, wait_event, count(*)::int AS connections
    FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()
    GROUP BY wait_event_type, wait_event`);
  const [extension] = await collect("SELECT to_regclass('public.pg_stat_statements') IS NOT NULL AS available");
  const queries = extension.available ? await collect(`SELECT queryid::text, calls, total_exec_time,
    mean_exec_time, rows, shared_blks_read, temp_blks_written, md5(query) AS fingerprint
    FROM public.pg_stat_statements WHERE dbid=(SELECT oid FROM pg_database WHERE datname=current_database())
    ORDER BY total_exec_time DESC LIMIT 30`) : [];
  await client.query('COMMIT');
  const report = `${JSON.stringify({ measuredAt: new Date().toISOString(), settings, tables, indexes, waits,
    pgStatStatementsAvailable: extension.available, queries }, null, 2)}\n`;
  const reportFile = process.argv.find(argument => argument.startsWith('--reportFile='))?.slice('--reportFile='.length);
  if (reportFile) writeFileSync(reportFile, report, { mode: 0o600 });
  else process.stdout.write(report);
} finally {
  await client.end();
}
