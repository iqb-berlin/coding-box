import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryRunner } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import * as sqlite3 from 'sqlite3';
import { promisify } from 'util';
import { DatabaseExportCancelledError } from './database-export-cancelled.error';

type ExportProgressCallback = (
  progress: number,
  message: string
) => Promise<void> | void;

type ExportCancellationCheck = () => Promise<boolean> | boolean;

type WorkspaceExportTable = {
  name: string;
  query: string;
};

type ExportTableColumn = {
  column_name: string;
  data_type: string;
  is_nullable: string;
};

type ResolvedWorkspaceExportTable = WorkspaceExportTable & {
  columns: ExportTableColumn[];
  rowCount: number;
};

@Injectable()
export class DatabaseExportService {
  private readonly logger = new Logger(DatabaseExportService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource
  ) {}

  async exportToSqliteFile(
    outputFilePath: string,
    onProgress?: ExportProgressCallback,
    isCancelled?: ExportCancellationCheck
  ): Promise<void> {
    const outputDir = path.dirname(outputFilePath);

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const db = new sqlite3.Database(outputFilePath);
    const dbRun = promisify(db.run.bind(db));
    const dbClose = promisify(db.close.bind(db));

    try {
      await this.reportProgress(onProgress, 1, 'Initialisierung gestartet');
      await this.throwIfCancelled(isCancelled);

      const tables = await this.dataSource.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
        ORDER BY table_name
      `);

      const exportableTables = tables
        .map(table => table.table_name as string)
        .filter(tableName => !tableName.startsWith('typeorm_') && tableName !== 'migrations');

      await this.throwIfCancelled(isCancelled);

      // Keep the export in a single SQLite file (without .wal sidecar files).
      await dbRun('PRAGMA journal_mode=DELETE');
      await dbRun('PRAGMA synchronous=NORMAL');
      await dbRun('PRAGMA cache_size=10000');
      await dbRun('PRAGMA temp_store=memory');

      const rowCounts = new Map<string, number>();
      let totalRows = 0;

      for (const tableName of exportableTables) {
        await this.throwIfCancelled(isCancelled);
        const countResult = await this.dataSource.query(
          `SELECT COUNT(*) as count FROM "${tableName}"`
        );
        const rowCount = Number(countResult[0]?.count ?? 0);
        rowCounts.set(tableName, rowCount);
        totalRows += rowCount;
      }

      await this.reportProgress(onProgress, 3, 'Tabellenanalyse abgeschlossen');

      let processedRows = 0;
      let processedTables = 0;
      const totalTables = exportableTables.length || 1;

      for (const tableName of exportableTables) {
        await this.throwIfCancelled(isCancelled);
        this.logger.log(`Processing table: ${tableName}`);

        const columns = await this.dataSource.query(`
          SELECT column_name, data_type, is_nullable
          FROM information_schema.columns
          WHERE table_name = $1 AND table_schema = 'public'
          ORDER BY ordinal_position
        `, [tableName]);

        const columnDefs = columns
          .map(col => {
            const colType = this.mapPostgresTypeToSqlite(col.data_type);
            const nullable = col.is_nullable === 'YES' ? '' : ' NOT NULL';
            return `"${col.column_name}" ${colType}${nullable}`;
          })
          .join(', ');

        await dbRun(
          `CREATE TABLE IF NOT EXISTS "${tableName}" (${columnDefs})`
        );

        const totalRowsInTable = rowCounts.get(tableName) ?? 0;
        if (totalRowsInTable === 0) {
          processedTables += 1;
          await this.reportProgress(
            onProgress,
            this.calculateProgress(
              processedRows,
              totalRows,
              processedTables,
              totalTables
            ),
            `Tabelle ${tableName} abgeschlossen`
          );
          continue;
        }

        const orderByClause = await this.getStableOrderByClause(tableName, columns);
        const batchSize = 1000;
        let offset = 0;

        while (offset < totalRowsInTable) {
          await this.throwIfCancelled(isCancelled);

          const rows = await this.dataSource.query(`
            SELECT * FROM "${tableName}"
            ORDER BY ${orderByClause}
            LIMIT $1 OFFSET $2
          `, [batchSize, offset]);

          if (rows.length === 0) {
            break;
          }

          const columnNames = columns.map(col => `"${col.column_name}"`).join(', ');
          const placeholders = columns.map(() => '?').join(', ');
          const insertSql = `INSERT INTO "${tableName}" (${columnNames}) VALUES (${placeholders})`;

          await dbRun('BEGIN TRANSACTION');
          try {
            for (const row of rows) {
              const values = columns.map(col => this.normalizeSqliteValue(row[col.column_name]));
              await dbRun(insertSql, values);
            }
            await dbRun('COMMIT');
          } catch (error) {
            await dbRun('ROLLBACK');
            throw error;
          }

          offset += rows.length;
          processedRows += rows.length;

          await this.reportProgress(
            onProgress,
            this.calculateProgress(
              processedRows,
              totalRows,
              processedTables,
              totalTables
            ),
            `Tabelle ${tableName}: ${Math.min(offset, totalRowsInTable)}/${totalRowsInTable}`
          );
        }

        processedTables += 1;
        this.logger.log(`Completed table ${tableName}`);
      }

      await dbClose();
      await this.reportProgress(onProgress, 100, 'Export abgeschlossen');
    } catch (error) {
      try {
        await dbClose();
      } catch (closeError) {
        this.logger.error(
          `Error closing SQLite file: ${closeError?.message || closeError}`,
          closeError?.stack
        );
      }

      if (fs.existsSync(outputFilePath)) {
        try {
          fs.unlinkSync(outputFilePath);
        } catch (cleanupError) {
          this.logger.error(
            `Error deleting failed export file: ${cleanupError?.message || cleanupError}`,
            cleanupError?.stack
          );
        }
      }

      throw error;
    }
  }

  async exportWorkspaceToSqliteFile(
    outputFilePath: string,
    workspaceId: number,
    onProgress?: ExportProgressCallback,
    isCancelled?: ExportCancellationCheck
  ): Promise<void> {
    const outputDir = path.dirname(outputFilePath);

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const db = new sqlite3.Database(outputFilePath);
    const dbRun = promisify(db.run.bind(db));
    const dbClose = promisify(db.close.bind(db));
    const queryRunner = this.dataSource.createQueryRunner();

    try {
      await queryRunner.connect();
      await queryRunner.startTransaction('REPEATABLE READ');
      await queryRunner.query('SET TRANSACTION READ ONLY');

      await this.reportProgress(onProgress, 1, 'Initialisierung gestartet');
      await this.throwIfCancelled(isCancelled);

      // Keep the export in a single SQLite file (without .wal sidecar files).
      await dbRun('PRAGMA journal_mode=DELETE');
      await dbRun('PRAGMA synchronous=NORMAL');
      await dbRun('PRAGMA cache_size=10000');
      await dbRun('PRAGMA temp_store=memory');

      const workspaceTableConfigs = this.getWorkspaceExportTables();
      const workspaceTables: ResolvedWorkspaceExportTable[] = [];
      let totalRows = 0;

      for (const tableConfig of workspaceTableConfigs) {
        await this.throwIfCancelled(isCancelled);
        const columns = await this.getTableColumns(tableConfig.name, queryRunner);

        if (columns.length === 0) {
          this.logger.warn(`Table ${tableConfig.name} not found, skipping...`);
          continue;
        }

        await this.throwIfCancelled(isCancelled);
        const countResult = await queryRunner.query(
          `SELECT COUNT(*) as count FROM (${tableConfig.query}) export_rows`,
          [workspaceId]
        );
        const rowCount = Number(countResult[0]?.count ?? 0);
        workspaceTables.push({
          ...tableConfig,
          columns,
          rowCount
        });
        totalRows += rowCount;
      }

      await this.reportProgress(onProgress, 3, 'Tabellenanalyse abgeschlossen');

      let processedRows = 0;
      let processedTables = 0;
      const totalTables = workspaceTables.length || 1;

      for (const tableConfig of workspaceTables) {
        await this.throwIfCancelled(isCancelled);
        const tableName = tableConfig.name;

        this.logger.log(`Processing workspace table: ${tableName}`);

        const { columns } = tableConfig;

        const columnDefs = columns.map(col => {
          const colType = this.mapPostgresTypeToSqlite(col.data_type);
          const nullable = col.is_nullable === 'YES' ? '' : ' NOT NULL';
          return `"${col.column_name}" ${colType}${nullable}`;
        }).join(', ');

        await dbRun(`CREATE TABLE IF NOT EXISTS "${tableName}" (${columnDefs})`);

        const totalRowsInTable = tableConfig.rowCount;
        if (totalRowsInTable === 0) {
          processedTables += 1;
          await this.reportProgress(
            onProgress,
            this.calculateProgress(
              processedRows,
              totalRows,
              processedTables,
              totalTables
            ),
            `Tabelle ${tableName} abgeschlossen`
          );
          continue;
        }

        const orderByClause = await this.getStableOrderByClause(tableName, columns, queryRunner);
        const batchSize = 1000;
        let offset = 0;

        while (offset < totalRowsInTable) {
          await this.throwIfCancelled(isCancelled);

          const rows = await queryRunner.query(
            `SELECT * FROM (${tableConfig.query}) export_rows
             ORDER BY ${orderByClause}
             LIMIT $2 OFFSET $3`,
            [workspaceId, batchSize, offset]
          );

          if (rows.length === 0) {
            break;
          }

          const columnNames = columns.map(col => `"${col.column_name}"`).join(', ');
          const placeholders = columns.map(() => '?').join(', ');
          const insertSql = `INSERT INTO "${tableName}" (${columnNames}) VALUES (${placeholders})`;

          await dbRun('BEGIN TRANSACTION');
          try {
            for (const row of rows) {
              const values = columns.map(col => this.normalizeSqliteValue(row[col.column_name]));
              await dbRun(insertSql, values);
            }
            await dbRun('COMMIT');
          } catch (error) {
            await dbRun('ROLLBACK');
            throw error;
          }

          offset += rows.length;
          processedRows += rows.length;

          await this.reportProgress(
            onProgress,
            this.calculateProgress(
              processedRows,
              totalRows,
              processedTables,
              totalTables
            ),
            `Tabelle ${tableName}: ${Math.min(offset, totalRowsInTable)}/${totalRowsInTable}`
          );
        }

        processedTables += 1;
        this.logger.log(`Completed workspace table ${tableName}`);
      }

      await dbClose();
      await queryRunner.commitTransaction();
      await this.reportProgress(onProgress, 100, 'Export abgeschlossen');
    } catch (error) {
      if (queryRunner.isTransactionActive) {
        try {
          await queryRunner.rollbackTransaction();
        } catch (rollbackError) {
          this.logger.error(
            `Error rolling back workspace export transaction: ${rollbackError?.message || rollbackError}`,
            rollbackError?.stack
          );
        }
      }

      try {
        await dbClose();
      } catch (closeError) {
        this.logger.error(
          `Error closing SQLite file: ${closeError?.message || closeError}`,
          closeError?.stack
        );
      }

      if (fs.existsSync(outputFilePath)) {
        try {
          fs.unlinkSync(outputFilePath);
        } catch (cleanupError) {
          this.logger.error(
            `Error deleting failed workspace export file: ${cleanupError?.message || cleanupError}`,
            cleanupError?.stack
          );
        }
      }

      throw error;
    } finally {
      if (!queryRunner.isReleased) {
        try {
          await queryRunner.release();
        } catch (releaseError) {
          this.logger.error(
            `Error releasing workspace export query runner: ${releaseError?.message || releaseError}`,
            releaseError?.stack
          );
        }
      }
    }
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
    queryRunner?: QueryRunner
  ): Promise<string> {
    const columnNames = columns.map(column => column.column_name);
    const primaryKeyColumns = await this.getPrimaryKeyColumns(tableName, queryRunner);
    let orderColumns = primaryKeyColumns;
    if (orderColumns.length === 0) {
      orderColumns = columnNames.includes('id') ? ['id'] : columnNames;
    }

    return orderColumns
      .filter(columnName => columnNames.includes(columnName))
      .map(columnName => `"${columnName}" ASC`)
      .join(', ') || columnNames.map(columnName => `"${columnName}" ASC`).join(', ');
  }

  private async getTableColumns(
    tableName: string,
    queryRunner?: QueryRunner
  ): Promise<ExportTableColumn[]> {
    return (queryRunner || this.dataSource).query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = $1 AND table_schema = 'public'
      ORDER BY ordinal_position
    `, [tableName]);
  }

  private async getPrimaryKeyColumns(
    tableName: string,
    queryRunner?: QueryRunner
  ): Promise<string[]> {
    const rows = await (queryRunner || this.dataSource).query(`
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

  private getWorkspaceExportTables(): WorkspaceExportTable[] {
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
          WHERE EXISTS (
            SELECT 1 FROM coding_job cj
            WHERE cj.missings_profile_id = mp.id
              AND cj.workspace_id = $1
          )
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
