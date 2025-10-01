import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as sqlite3 from 'sqlite3';
import { promisify } from 'util';

@Injectable()
export class DatabaseExportService {
  private readonly logger = new Logger(DatabaseExportService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource
  ) {}

  async exportToSqliteStream(response: Response): Promise<void> {
    const tempDir = path.join(process.cwd(), 'temp');
    const tempFile = path.join(tempDir, `export_${Date.now()}.sqlite`);

    try {
      // Ensure temp directory exists
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      // Create SQLite database
      const db = new sqlite3.Database(tempFile);
      const dbRun = promisify(db.run.bind(db));
      const dbClose = promisify(db.close.bind(db));

      // Get all table names from PostgreSQL
      const tables = await this.dataSource.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
        ORDER BY table_name
      `);

      // Set SQLite to handle large operations better
      await dbRun('PRAGMA journal_mode=WAL');
      await dbRun('PRAGMA synchronous=NORMAL');
      await dbRun('PRAGMA cache_size=10000');
      await dbRun('PRAGMA temp_store=memory');

      let processedTables = 0;
      const totalTables = tables.length;

      for (const tableInfo of tables) {
        const tableName = tableInfo.table_name;

        // Skip migration tables and other system tables
        if (tableName.startsWith('typeorm_') || tableName === 'migrations') {
          continue;
        }

        try {
          this.logger.log(`Processing table: ${tableName}`);

          // Get table structure from PostgreSQL
          const columns = await this.dataSource.query(`
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_name = $1 AND table_schema = 'public'
            ORDER BY ordinal_position
          `, [tableName]);

          // Create table in SQLite
          const columnDefs = columns.map(col => {
            const colType = this.mapPostgresTypeToSqlite(col.data_type);
            const nullable = col.is_nullable === 'YES' ? '' : ' NOT NULL';
            return `"${col.column_name}" ${colType}${nullable}`;
          }).join(', ');

          await dbRun(`CREATE TABLE IF NOT EXISTS "${tableName}" (${columnDefs})`);

          // Get row count to handle large tables
          const countResult = await this.dataSource.query(`SELECT COUNT(*) as count FROM "${tableName}"`);
          const totalRows = parseInt(countResult[0].count, 10);

          if (totalRows === 0) {
            continue;
          }

          // Process data in batches for memory efficiency
          const batchSize = 1000;
          let offset = 0;

          while (offset < totalRows) {
            const rows = await this.dataSource.query(`
              SELECT * FROM "${tableName}"
              ORDER BY (SELECT NULL)
              LIMIT $1 OFFSET $2
            `, [batchSize, offset]);

            if (rows.length === 0) break;

            // Prepare batch insert
            const columnNames = columns.map(col => `"${col.column_name}"`).join(', ');
            const placeholders = columns.map(() => '?').join(', ');
            const insertSql = `INSERT INTO "${tableName}" (${columnNames}) VALUES (${placeholders})`;

            // Begin transaction for batch
            await dbRun('BEGIN TRANSACTION');

            try {
              for (const row of rows) {
                const values = columns.map(col => {
                  const value = row[col.column_name];
                  // Handle special data types
                  if (value === null) return null;
                  if (typeof value === 'boolean') return value ? 1 : 0;
                  if (value instanceof Date) return value.toISOString();
                  if (typeof value === 'object') return JSON.stringify(value);
                  return value;
                });

                await dbRun(insertSql, values);
              }

              await dbRun('COMMIT');
            } catch (error) {
              await dbRun('ROLLBACK');
              throw error;
            }

            offset += batchSize;

            // Optional: Send progress info (this would require a different streaming approach)
            this.logger.log(`Table ${tableName}: ${Math.min(offset, totalRows)}/${totalRows} rows processed`);
          }

          processedTables += 1;
          this.logger.log(`Completed table ${tableName} (${processedTables}/${totalTables})`);
        } catch (error) {
          this.logger.error(`Error processing table ${tableName}: ${error?.message || error}`, error?.stack);
          // Continue with next table instead of failing completely
        }
      }

      // Close database connection
      await dbClose();

      this.logger.log('SQLite export completed, streaming file...');

      // Stream the file to response
      const fileStats = fs.statSync(tempFile);
      response.setHeader('Content-Length', fileStats.size);

      // Create read stream and pipe to response
      const fileStream = fs.createReadStream(tempFile);

      fileStream.on('error', error => {
        this.logger.error(`Stream error: ${error?.message || error}`, error?.stack);
        if (!response.headersSent) {
          response.status(500).send('Error streaming file');
        }
      });

      fileStream.on('end', () => {
        this.logger.log('File streaming completed');
        // Clean up temporary file
        setTimeout(() => {
          try {
            fs.unlinkSync(tempFile);
            this.logger.log('Temporary file cleaned up');
          } catch (error) {
            this.logger.error(`Error cleaning up temporary file: ${error?.message || error}`, error?.stack);
          }
        }, 1000);
      });

      fileStream.pipe(response);
    } catch (error) {
      this.logger.error(`Export error: ${error?.message || error}`, error?.stack);

      // Clean up temporary file on error
      try {
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
        }
      } catch (cleanupError) {
        this.logger.error(`Error cleaning up temporary file: ${cleanupError?.message || cleanupError}`, cleanupError?.stack);
      }

      throw error;
    }
  }

  async exportWorkspaceToSqliteStream(response: Response, workspaceId: number): Promise<void> {
    const tempDir = path.join(process.cwd(), 'temp');
    const tempFile = path.join(tempDir, `workspace_export_${workspaceId}_${Date.now()}.sqlite`);

    try {
      // Ensure temp directory exists
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      // Create SQLite database
      const db = new sqlite3.Database(tempFile);
      const dbRun = promisify(db.run.bind(db));
      const dbClose = promisify(db.close.bind(db));

      // Set SQLite to handle large operations better
      await dbRun('PRAGMA journal_mode=WAL');
      await dbRun('PRAGMA synchronous=NORMAL');
      await dbRun('PRAGMA cache_size=10000');
      await dbRun('PRAGMA temp_store=memory');

      // Define workspace-specific tables and their filtering queries
      const workspaceTables = [
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
            SELECT bi.* FROM bookletinfo bi
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

      let processedTables = 0;
      const totalTables = workspaceTables.length;

      for (const tableConfig of workspaceTables) {
        const tableName = tableConfig.name;

        try {
          this.logger.log(`Processing workspace table: ${tableName}`);

          // Get table structure from PostgreSQL
          const columns = await this.dataSource.query(`
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_name = $1 AND table_schema = 'public'
            ORDER BY ordinal_position
          `, [tableName]);

          if (columns.length === 0) {
            this.logger.warn(`Table ${tableName} not found, skipping...`);
            continue;
          }

          // Create table in SQLite
          const columnDefs = columns.map(col => {
            const colType = this.mapPostgresTypeToSqlite(col.data_type);
            const nullable = col.is_nullable === 'YES' ? '' : ' NOT NULL';
            return `"${col.column_name}" ${colType}${nullable}`;
          }).join(', ');

          await dbRun(`CREATE TABLE IF NOT EXISTS "${tableName}" (${columnDefs})`);

          // Get workspace-specific data
          const rows = await this.dataSource.query(tableConfig.query, [workspaceId]);

          if (rows.length === 0) {
            this.logger.log(`No data found for table ${tableName} in workspace ${workspaceId}`);
            continue;
          }

          // Process data in batches for memory efficiency
          const batchSize = 1000;
          let offset = 0;

          while (offset < rows.length) {
            const batch = rows.slice(offset, offset + batchSize);

            // Prepare batch insert
            const columnNames = columns.map(col => `"${col.column_name}"`).join(', ');
            const placeholders = columns.map(() => '?').join(', ');
            const insertSql = `INSERT INTO "${tableName}" (${columnNames}) VALUES (${placeholders})`;

            // Begin transaction for batch
            await dbRun('BEGIN TRANSACTION');

            try {
              for (const row of batch) {
                const values = columns.map(col => {
                  const value = row[col.column_name];
                  // Handle special data types
                  if (value === null) return null;
                  if (typeof value === 'boolean') return value ? 1 : 0;
                  if (value instanceof Date) return value.toISOString();
                  if (typeof value === 'object') return JSON.stringify(value);
                  return value;
                });

                await dbRun(insertSql, values);
              }

              await dbRun('COMMIT');
            } catch (error) {
              await dbRun('ROLLBACK');
              throw error;
            }

            offset += batchSize;
            this.logger.log(`Table ${tableName}: ${Math.min(offset, rows.length)}/${rows.length} rows processed`);
          }

          processedTables += 1;
          this.logger.log(`Completed table ${tableName} (${processedTables}/${totalTables})`);
        } catch (error) {
          this.logger.error(`Error processing table ${tableName}: ${error?.message || error}`, error?.stack);
          // Continue with next table instead of failing completely
        }
      }

      // Close database connection
      await dbClose();

      this.logger.log(`SQLite workspace export completed for workspace ${workspaceId}, streaming file...`);

      // Stream the file to response
      const fileStats = fs.statSync(tempFile);
      response.setHeader('Content-Length', fileStats.size);

      // Create read stream and pipe to response
      const fileStream = fs.createReadStream(tempFile);

      fileStream.on('error', error => {
        this.logger.error(`Stream error: ${error?.message || error}`, error?.stack);
        if (!response.headersSent) {
          response.status(500).send('Error streaming file');
        }
      });

      fileStream.on('end', () => {
        this.logger.log('File streaming completed');
        // Clean up temporary file
        setTimeout(() => {
          try {
            fs.unlinkSync(tempFile);
            this.logger.log('Temporary file cleaned up');
          } catch (error) {
            this.logger.error(`Error cleaning up temporary file: ${error?.message || error}`, error?.stack);
          }
        }, 1000);
      });

      fileStream.pipe(response);
    } catch (error) {
      this.logger.error(`Export error: ${error?.message || error}`, error?.stack);

      // Clean up temporary file on error
      try {
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
        }
      } catch (cleanupError) {
        this.logger.error(`Error cleaning up temporary file: ${cleanupError?.message || cleanupError}`, cleanupError?.stack);
      }

      throw error;
    }
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
