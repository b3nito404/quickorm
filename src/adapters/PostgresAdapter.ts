import { BaseAdapter } from './Adapter';
import { QueryResult, DataSourceConfig } from '../types';
import { ConnectionError, QueryError } from '../errors/OrmError';
import { logger } from '../utils/logger';

/**
 * PostgreSQL adapter — requires the `pg` package to be installed.
 *
 *   npm install pg
 *   npm install --save-dev @types/pg
 */
export class PostgresAdapter extends BaseAdapter {
  readonly type = 'postgres';

  private pool: any = null;
  private client: any = null; // active transaction client

  async connect(config: DataSourceConfig): Promise<void> {
    let pg: any;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      // @ts-ignore — optional peer dependency
      pg = require('pg');
    } catch {
      throw new ConnectionError(
        'PostgreSQL adapter requires the `pg` package. Run: npm install pg'
      );
    }

    const { Pool } = pg;
    this.pool = new Pool({
      host:     config.host     ?? 'localhost',
      port:     config.port     ?? 5432,
      user:     config.username ?? 'postgres',
      password: config.password ?? '',
      database: config.database ?? 'quickorm',
      max:      config.poolSize ?? 10,
      ssl:      config.ssl ? { rejectUnauthorized: false } : false,
    });

    try {
      const client = await this.pool.connect();
      client.release();
      this._connected = true;
      logger.info(`Connected to PostgreSQL @ ${config.host}:${config.port}/${config.database}`);
    } catch (err: any) {
      throw new ConnectionError('Failed to connect to PostgreSQL', err);
    }
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
    this._connected = false;
    logger.info('Disconnected from PostgreSQL');
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<QueryResult<T>> {
    if (!this._connected) throw new ConnectionError('Not connected to PostgreSQL');

    const start = Date.now();
    try {
      const executor = this.client ?? this.pool;
      const result   = await executor.query(sql, params);
      logger.query(sql, params, Date.now() - start);
      return { rows: result.rows as T[], rowCount: result.rowCount ?? 0 };
    } catch (err: any) {
      throw new QueryError(err.message, sql, params, err);
    }
  }

  async beginTransaction(): Promise<void> {
    this.client = await this.pool.connect();
    await this.client.query('BEGIN');
  }

  async commitTransaction(): Promise<void> {
    if (!this.client) return;
    await this.client.query('COMMIT');
    this.client.release();
    this.client = null;
  }

  async rollbackTransaction(): Promise<void> {
    if (!this.client) return;
    await this.client.query('ROLLBACK');
    this.client.release();
    this.client = null;
  }

  quoteIdentifier(id: string): string {
    return `"${id.replace(/"/g, '""')}"`;
  }

  getPlaceholder(index: number): string {
    return `$${index}`;
  }
}
