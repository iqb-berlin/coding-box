import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import sqlite3 from 'sqlite3';
import { promisify } from 'util';
import { DatabaseExportCancelledError } from './database-export-cancelled.error';

type ExportProgressCallback = (
  progress: number,
  message: string
) => Promise<void> | void;

type ExportCancellationCheck = () => Promise<boolean> | boolean;

type ExportTable = {
  name: string;
  query: string;
};

type ExportTableColumn = {
  column_name: string;
  data_type: string;
  is_nullable: string;
};

type ResolvedExportTable = ExportTable & {
  columns: ExportTableColumn[];
  rowCount: number;
};

@Injectable()
export class DatabaseExportService {
  private readonly logger = new Logger(DatabaseExportService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource
  ) {}

  exportToSqliteFile(
    outputFilePath: string,
    onProgress?: ExportProgressCallback,
    isCancelled?: ExportCancellationCheck
  ): Promise<void> {
    return this.exportSnapshot(outputFilePath, undefined, onProgress, isCancelled);
  }

  exportWorkspaceToSqliteFile(
    outputFilePath: string,
    workspaceId: number,
    onProgress?: ExportProgressCallback,
    isCancelled?: ExportCancellationCheck
  ): Promise<void> {
    return this.exportSnapshot(outputFilePath, workspaceId, onProgress, isCancelled);
  }

  private async exportSnapshot(
    outputFilePath: string,
    workspaceId: number | undefined,
    onProgress?: ExportProgressCallback,
    isCancelled?: ExportCancellationCheck
  ): Promise<void> {
    await fs.promises.mkdir(path.dirname(outputFilePath), { recursive: true });
    const db = await new Promise<sqlite3.Database>((resolve, reject) => {
      const connection = new sqlite3.Database(outputFilePath, error => (error ? reject(error) : resolve(connection)));
    });

    try {
      try {
        // DELETE journal mode leaves a self-contained file for the downloader.
        await this.runSqlite(db, 'PRAGMA journal_mode=DELETE');
        await this.runSqlite(db, 'PRAGMA synchronous=NORMAL');
        await this.runSqlite(db, 'PRAGMA cache_size=10000');
        await this.runSqlite(db, 'PRAGMA temp_store=memory');

        await this.dataSource.transaction('REPEATABLE READ', async manager => {
          await manager.query('SET TRANSACTION READ ONLY');
          await this.reportProgress(onProgress, 1, 'Initialisierung gestartet');
          await this.writeTables(manager, db, workspaceId, onProgress, isCancelled);
        });
      } finally {
        await promisify(db.close.bind(db))();
      }
      await this.reportProgress(onProgress, 100, 'Export abgeschlossen');
    } catch (error) {
      await fs.promises.rm(outputFilePath, { force: true });
      throw error;
    }
  }

  private async writeTables(
    manager: EntityManager,
    db: sqlite3.Database,
    workspaceId: number | undefined,
    onProgress?: ExportProgressCallback,
    isCancelled?: ExportCancellationCheck
  ): Promise<void> {
    const parameters = workspaceId === undefined ? [] : [workspaceId];
    const configs = workspaceId === undefined ? await this.getSystemExportTables(manager) : this.getWorkspaceExportTables();
    const tables: ResolvedExportTable[] = [];
    let countMs = 0;
    for (const config of configs) {
      await this.throwIfCancelled(isCancelled);
      const columns = await this.getTableColumns(config.name, manager);
      if (!columns.length) {
        this.logger.warn(`Table ${config.name} not found, skipping...`);
        continue;
      }
      const countStarted = performance.now();
      const [result] = await manager.query(`SELECT COUNT(*) AS count FROM (${config.query}) export_rows`, parameters);
      countMs += performance.now() - countStarted;
      tables.push({ ...config, columns, rowCount: Number(result.count) });
    }

    this.logger.log(`SQLite export row counts: ${Math.round(countMs)} ms`);
    await this.reportProgress(onProgress, 3, 'Tabellenanalyse abgeschlossen');
    const totalRows = tables.reduce((sum, table) => sum + table.rowCount, 0);
    let processedRows = 0;
    for (const [index, table] of tables.entries()) {
      await this.throwIfCancelled(isCancelled);
      const definitions = table.columns.map(column => {
        const nullable = column.is_nullable === 'YES' ? '' : ' NOT NULL';
        return `${this.quoteIdentifier(column.column_name)} ${this.mapPostgresTypeToSqlite(column.data_type)}${nullable}`;
      });
      await this.runSqlite(db, `CREATE TABLE IF NOT EXISTS ${this.quoteIdentifier(table.name)} (${definitions.join(', ')})`);
      if (table.rowCount) {
        const rowsBeforeTable = processedRows;
        await this.copyTable(manager, db, table, parameters, isCancelled, written => this.reportProgress(
          onProgress,
          this.calculateProgress(rowsBeforeTable + written, totalRows, index, tables.length),
          `Tabelle ${table.name}: ${written}/${table.rowCount}`
        ));
        processedRows += table.rowCount;
      } else {
        await this.reportProgress(
          onProgress,
          this.calculateProgress(processedRows, totalRows, index + 1, tables.length),
          `Tabelle ${table.name} abgeschlossen`
        );
      }
    }
  }

  private async getSystemExportTables(manager: EntityManager): Promise<ExportTable[]> {
    const tables: { table_name: string }[] = await manager.query(`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name
    `);
    return tables
      .map(table => table.table_name)
      .filter(name => !name.startsWith('typeorm_') && name !== 'migrations')
      .map(name => ({ name, query: `SELECT * FROM public.${this.quoteIdentifier(name)}` }));
  }

  private async copyTable(
    manager: EntityManager,
    db: sqlite3.Database,
    table: ResolvedExportTable,
    parameters: number[],
    isCancelled: ExportCancellationCheck | undefined,
    reportWritten: (written: number) => Promise<void>
  ): Promise<void> {
    const orderBy = await this.getStableOrderByClause(table.name, table.columns, manager);
    // The cursor lives on this transaction's connection and is discarded on rollback.
    await manager.query(`DECLARE export_rows_cursor NO SCROLL CURSOR FOR
      SELECT * FROM (${table.query}) export_rows ORDER BY ${orderBy}`, parameters);
    const names = table.columns.map(column => this.quoteIdentifier(column.column_name));
    const insert = `INSERT INTO ${this.quoteIdentifier(table.name)} (${names.join(', ')}) VALUES `;
    const tuple = `(${names.map(() => '?').join(', ')})`;
    // Also works with SQLite builds limited to 999 bind parameters per statement.
    const batchSize = Math.max(1, Math.floor(999 / names.length));
    let written = 0;
    let insertMs = 0;
    while (written < table.rowCount) {
      await this.throwIfCancelled(isCancelled);
      const rows: Record<string, unknown>[] = await manager.query('FETCH FORWARD 1000 FROM export_rows_cursor');
      if (!rows.length) throw new Error(`Incomplete export of ${table.name}: ${written}/${table.rowCount} rows`);
      const insertStarted = performance.now();
      await this.runSqlite(db, 'BEGIN TRANSACTION');
      try {
        for (let offset = 0; offset < rows.length; offset += batchSize) {
          const batch = rows.slice(offset, offset + batchSize);
          const values = batch.flatMap(row => table.columns.map(column => this.normalizeSqliteValue(row[column.column_name])));
          await this.runSqlite(db, insert + batch.map(() => tuple).join(', '), values);
        }
        await this.runSqlite(db, 'COMMIT');
      } catch (error) {
        await this.runSqlite(db, 'ROLLBACK');
        throw error;
      }
      insertMs += performance.now() - insertStarted;
      written += rows.length;
      await reportWritten(written);
    }
    await manager.query('CLOSE export_rows_cursor');
    this.logger.log(`SQLite insert into ${table.name}: ${written} rows in ${Math.round(insertMs)} ms`);
  }

  private runSqlite(db: sqlite3.Database, sql: string, values: unknown[] = []): Promise<void> {
    return new Promise((resolve, reject) => {
      db.run(sql, values, error => (error ? reject(error) : resolve()));
    });
  }

  private quoteIdentifier(name: string): string {
    return `"${name.replace(/"/g, '""')}"`;
  }

  private normalizeSqliteValue(value: unknown): unknown {
    if (value === null || value === undefined) {
      return null;
    }

    if (typeof value === 'boolean') {
      return value ? 1 : 0;
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    if (typeof value === 'object') {
      return JSON.stringify(value);
    }

    return value;
  }

  private async throwIfCancelled(
    isCancelled?: ExportCancellationCheck
  ): Promise<void> {
    if (!isCancelled) {
      return;
    }

    if (await isCancelled()) {
      throw new DatabaseExportCancelledError();
    }
  }

  private async reportProgress(
    callback: ExportProgressCallback | undefined,
    progress: number,
    message: string
  ): Promise<void> {
    if (!callback) {
      return;
    }

    const boundedProgress = Math.max(0, Math.min(100, Math.round(progress)));
    await callback(boundedProgress, message);
  }

  private async getStableOrderByClause(
    tableName: string,
    columns: Array<{ column_name: string }>,
    manager: EntityManager
  ): Promise<string> {
    const columnNames = columns.map(column => column.column_name);
    const primaryKeyColumns = await this.getPrimaryKeyColumns(tableName, manager);
    let orderColumns = primaryKeyColumns;
    if (orderColumns.length === 0) {
      orderColumns = columnNames.includes('id') ? ['id'] : columnNames;
    }

    return orderColumns
      .filter(columnName => columnNames.includes(columnName))
      .map(columnName => `${this.quoteIdentifier(columnName)} ASC`)
      .join(', ') || columnNames.map(columnName => `${this.quoteIdentifier(columnName)} ASC`).join(', ');
  }

  private async getTableColumns(
    tableName: string,
    manager: EntityManager
  ): Promise<ExportTableColumn[]> {
    return manager.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = $1 AND table_schema = 'public'
      ORDER BY ordinal_position
    `, [tableName]);
  }

  private async getPrimaryKeyColumns(
    tableName: string,
    manager: EntityManager
  ): Promise<string[]> {
    const rows: { column_name: string }[] = await manager.query(`
      SELECT kcu.column_name
      FROM information_schema.table_constraints tc
      INNER JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
       AND tc.table_name = kcu.table_name
      WHERE tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_schema = 'public'
        AND tc.table_name = $1
      ORDER BY kcu.ordinal_position
    `, [tableName]);

    return rows.map(row => row.column_name as string);
  }

  private calculateProgress(
    processedRows: number,
    totalRows: number,
    processedTables: number,
    totalTables: number
  ): number {
    if (totalRows > 0) {
      return Math.min(99, Math.max(1, (processedRows / totalRows) * 99));
    }

    return Math.min(99, Math.max(1, (processedTables / totalTables) * 99));
  }

  private getWorkspaceExportTables(): ExportTable[] {
    return [
      {
        name: 'workspace',
        query: 'SELECT w.* FROM workspace w WHERE w.id = $1'
      },
      {
        name: 'persons',
        query: 'SELECT * FROM persons WHERE workspace_id = $1'
      },
      {
        name: 'booklet',
        query: `
          SELECT b.* FROM booklet b
          INNER JOIN persons p ON b.personid = p.id
          WHERE p.workspace_id = $1
        `
      },
      {
        name: 'bookletinfo',
        query: `
          SELECT DISTINCT bi.* FROM bookletinfo bi
          INNER JOIN booklet b ON bi.id = b.infoid
          INNER JOIN persons p ON b.personid = p.id
          WHERE p.workspace_id = $1
        `
      },
      {
        name: 'bookletlog',
        query: `
          SELECT bl.* FROM bookletlog bl
          INNER JOIN booklet b ON bl.bookletid = b.id
          INNER JOIN persons p ON b.personid = p.id
          WHERE p.workspace_id = $1
        `
      },
      {
        name: 'session',
        query: `
          SELECT s.* FROM session s
          INNER JOIN booklet b ON s.bookletid = b.id
          INNER JOIN persons p ON b.personid = p.id
          WHERE p.workspace_id = $1
        `
      },
      {
        name: 'unit',
        query: `
          SELECT u.* FROM unit u
          INNER JOIN booklet b ON u.bookletid = b.id
          INNER JOIN persons p ON b.personid = p.id
          WHERE p.workspace_id = $1
        `
      },
      {
        name: 'unit_note',
        query: `
          SELECT un.* FROM unit_note un
          INNER JOIN unit u ON un."unitId" = u.id
          INNER JOIN booklet b ON u.bookletid = b.id
          INNER JOIN persons p ON b.personid = p.id
          WHERE p.workspace_id = $1
        `
      },
      {
        name: 'unit_tag',
        query: `
          SELECT ut.* FROM unit_tag ut
          INNER JOIN unit u ON ut."unitId" = u.id
          INNER JOIN booklet b ON u.bookletid = b.id
          INNER JOIN persons p ON b.personid = p.id
          WHERE p.workspace_id = $1
        `
      },
      {
        name: 'unitlaststate',
        query: `
          SELECT uls.* FROM unitlaststate uls
          INNER JOIN unit u ON uls.unitid = u.id
          INNER JOIN booklet b ON u.bookletid = b.id
          INNER JOIN persons p ON b.personid = p.id
          WHERE p.workspace_id = $1
        `
      },
      {
        name: 'unitlog',
        query: `
          SELECT ul.* FROM unitlog ul
          INNER JOIN unit u ON ul.unitid = u.id
          INNER JOIN booklet b ON u.bookletid = b.id
          INNER JOIN persons p ON b.personid = p.id
          WHERE p.workspace_id = $1
        `
      },
      {
        name: 'response',
        query: `
          SELECT r.* FROM response r
          INNER JOIN unit u ON r.unitid = u.id
          INNER JOIN booklet b ON u.bookletid = b.id
          INNER JOIN persons p ON b.personid = p.id
          WHERE p.workspace_id = $1
        `
      },
      {
        name: 'logs',
        query: 'SELECT l.* FROM logs l WHERE l.workspace_id = $1'
      },
      {
        name: 'journal_entries',
        query: 'SELECT je.* FROM journal_entries je WHERE je.workspace_id = $1'
      },
      {
        name: 'replay_statistics',
        query: 'SELECT rs.* FROM replay_statistics rs WHERE rs.workspace_id = $1'
      },
      {
        name: 'workspace_test_results_revision',
        query: 'SELECT wtrr.* FROM workspace_test_results_revision wtrr WHERE wtrr.workspace_id = $1'
      },
      {
        name: 'job_definitions',
        query: 'SELECT jd.* FROM job_definitions jd WHERE jd.workspace_id = $1'
      },
      {
        name: 'variable_bundle',
        query: 'SELECT vb.* FROM variable_bundle vb WHERE vb.workspace_id = $1'
      },
      {
        name: 'coder_training',
        query: 'SELECT ct.* FROM coder_training ct WHERE ct.workspace_id = $1'
      },
      {
        name: 'coder_training_variable',
        query: `
          SELECT ctv.* FROM coder_training_variable ctv
          INNER JOIN coder_training ct ON ctv.coder_training_id = ct.id
          WHERE ct.workspace_id = $1
        `
      },
      {
        name: 'coder_training_bundle',
        query: `
          SELECT ctb.* FROM coder_training_bundle ctb
          INNER JOIN coder_training ct ON ctb.coder_training_id = ct.id
          WHERE ct.workspace_id = $1
        `
      },
      {
        name: 'coder_training_coder',
        query: `
          SELECT ctc.* FROM coder_training_coder ctc
          INNER JOIN coder_training ct ON ctc.coder_training_id = ct.id
          WHERE ct.workspace_id = $1
        `
      },
      {
        name: 'coder_training_discussion_result',
        query: 'SELECT ctdr.* FROM coder_training_discussion_result ctdr WHERE ctdr.workspace_id = $1'
      },
      {
        name: 'coding_job',
        query: 'SELECT cj.* FROM coding_job cj WHERE cj.workspace_id = $1'
      },
      {
        name: 'coding_job_coder',
        query: `
          SELECT cjc.* FROM coding_job_coder cjc
          INNER JOIN coding_job cj ON cjc.coding_job_id = cj.id
          WHERE cj.workspace_id = $1
        `
      },
      {
        name: 'coding_job_variable',
        query: `
          SELECT cjv.* FROM coding_job_variable cjv
          INNER JOIN coding_job cj ON cjv.coding_job_id = cj.id
          WHERE cj.workspace_id = $1
        `
      },
      {
        name: 'coding_job_variable_bundle',
        query: `
          SELECT cjvb.* FROM coding_job_variable_bundle cjvb
          INNER JOIN coding_job cj ON cjvb.coding_job_id = cj.id
          WHERE cj.workspace_id = $1
        `
      },
      {
        name: 'coding_job_unit',
        query: `
          SELECT cju.* FROM coding_job_unit cju
          LEFT JOIN coding_job cj ON cju.coding_job_id = cj.id
          WHERE COALESCE(cju.workspace_id, cj.workspace_id) = $1
        `
      },
      {
        name: 'coding_unit_freshness',
        query: 'SELECT cuf.* FROM coding_unit_freshness cuf WHERE cuf.workspace_id = $1'
      },
      {
        name: 'missings_profile',
        query: `
          SELECT mp.* FROM missings_profile mp
          WHERE mp.workspace_id = $1
        `
      },
      {
        name: 'chunk',
        query: `
          SELECT c.* FROM chunk c
          INNER JOIN unit u ON c.unitid = u.id
          INNER JOIN booklet b ON u.bookletid = b.id
          INNER JOIN persons p ON b.personid = p.id
          WHERE p.workspace_id = $1
        `
      }
    ];
  }

  private mapPostgresTypeToSqlite(postgresType: string): string {
    const typeMap: Record<string, string> = {
      integer: 'INTEGER',
      bigint: 'INTEGER',
      smallint: 'INTEGER',
      serial: 'INTEGER',
      bigserial: 'INTEGER',
      numeric: 'REAL',
      decimal: 'REAL',
      real: 'REAL',
      'double precision': 'REAL',
      money: 'REAL',
      'character varying': 'TEXT',
      varchar: 'TEXT',
      character: 'TEXT',
      char: 'TEXT',
      text: 'TEXT',
      boolean: 'INTEGER',
      date: 'TEXT',
      timestamp: 'TEXT',
      'timestamp without time zone': 'TEXT',
      'timestamp with time zone': 'TEXT',
      time: 'TEXT',
      interval: 'TEXT',
      json: 'TEXT',
      jsonb: 'TEXT',
      uuid: 'TEXT',
      bytea: 'BLOB'
    };

    // Handle array types
    if (postgresType.includes('[]')) {
      return 'TEXT';
    }

    return typeMap[postgresType.toLowerCase()] || 'TEXT';
  }
}
