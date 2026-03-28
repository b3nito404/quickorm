import { BaseAdapter } from './Adapter';
import { QueryResult, DataSourceConfig } from '../types';
import { ConnectionError, QueryError } from '../errors/OrmError';
import { logger } from '../utils/logger';

/**
 * SQLite adapter — requires the `better-sqlite3` package.
 *
 *   npm install better-sqlite3
 *   npm install --save-dev @types/better-sqlite3
 */
export class SQLiteAdapter extends BaseAdapter {
  readonly type = 'sqlite';

  private db: any = null;
  private inTx: boolean = false;

  async connect(config: DataSourceConfig): Promise<void> {
    let Database: any;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      // @ts-ignore — optional peer dependency
      Database = require('better-sqlite3');
    } catch {
      throw new ConnectionError(
        'SQLite adapter requires `better-sqlite3`. Run: npm install better-sqlite3'
      );
    }

    const file = config.filename ?? ':memory:';
    try {
      this.db = new Database(file);
      // Enable WAL for concurrent reads
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('foreign_keys = ON');
      this._connected = true;
      logger.info(`Connected to SQLite @ ${file}`);
    } catch (err: any) {
      throw new ConnectionError('Failed to open SQLite database', err);
    }
  }

  async disconnect(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this._connected = false;
  }

  // better-sqlite3 is synchronous — we wrap in async to fit the interface
  async query<T = any>(sql: string, params: any[] = []): Promise<QueryResult<T>> {
    if (!this._connected) throw new ConnectionError('Not connected to SQLite');

    const start = Date.now();
    try {
      const stmt = this.db.prepare(sql);
      let rows: T[];
      let rowCount: number;

      const trimmed = sql.trim().toUpperCase();
      if (trimmed.startsWith('SELECT') || trimmed.startsWith('PRAGMA')) {
        rows     = stmt.all(...params) as T[];
        rowCount = rows.length;
      } else {
        const info = stmt.run(...params);
        rows     = [];
        rowCount = info.changes;
      }

      logger.query(sql, params, Date.now() - start);
      return { rows, rowCount };
    } catch (err: any) {
      throw new QueryError(err.message, sql, params, err);
    }
  }

  async beginTransaction(): Promise<void> {
    this.db.prepare('BEGIN').run();
    this.inTx = true;
  }

  async commitTransaction(): Promise<void> {
    this.db.prepare('COMMIT').run();
    this.inTx = false;
  }

  async rollbackTransaction(): Promise<void> {
    this.db.prepare('ROLLBACK').run();
    this.inTx = false;
  }

  quoteIdentifier(id: string): string {
    return `"${id.replace(/"/g, '""')}"`;
  }

  getPlaceholder(_index: number): string {
    return '?';
  }
}
