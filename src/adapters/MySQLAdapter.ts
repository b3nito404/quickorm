import { BaseAdapter } from './Adapter';
import { QueryResult, DataSourceConfig } from '../types';
import { ConnectionError, QueryError } from '../errors/OrmError';
import { logger } from '../utils/logger';

/**
 * MySQL/MariaDB adapter — requires the `mysql2` package.
 *
 *   npm install mysql2
 */
export class MySQLAdapter extends BaseAdapter {
  readonly type = 'mysql';

  private pool: any = null;
  private connection: any = null; // active transaction connection

  async connect(config: DataSourceConfig): Promise<void> {
    let mysql: any;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      // @ts-ignore — optional peer dependency
      mysql = require('mysql2/promise');
    } catch {
      throw new ConnectionError(
        'MySQL adapter requires the `mysql2` package. Run: npm install mysql2'
      );
    }

    this.pool = mysql.createPool({
      host:               config.host     ?? 'localhost',
      port:               config.port     ?? 3306,
      user:               config.username ?? 'root',
      password:           config.password ?? '',
      database:           config.database ?? 'quickorm',
      connectionLimit:    config.poolSize ?? 10,
      ssl:                config.ssl ? {} : undefined,
      waitForConnections: true,
    });

    try {
      const conn = await this.pool.getConnection();
      conn.release();
      this._connected = true;
      logger.info(`Connected to MySQL @ ${config.host}:${config.port}/${config.database}`);
    } catch (err: any) {
      throw new ConnectionError('Failed to connect to MySQL', err);
    }
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
    this._connected = false;
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<QueryResult<T>> {
    if (!this._connected) throw new ConnectionError('Not connected to MySQL');

    const start = Date.now();
    try {
      const executor = this.connection ?? this.pool;
      const [rows, fields] = await executor.query(sql, params);
      logger.query(sql, params, Date.now() - start);
      const resultRows = Array.isArray(rows) ? rows : [rows];
      return { rows: resultRows as T[], rowCount: (rows as any).affectedRows ?? resultRows.length };
    } catch (err: any) {
      throw new QueryError(err.message, sql, params, err);
    }
  }

  async beginTransaction(): Promise<void> {
    this.connection = await this.pool.getConnection();
    await this.connection.beginTransaction();
  }

  async commitTransaction(): Promise<void> {
    if (!this.connection) return;
    await this.connection.commit();
    this.connection.release();
    this.connection = null;
  }

  async rollbackTransaction(): Promise<void> {
    if (!this.connection) return;
    await this.connection.rollback();
    this.connection.release();
    this.connection = null;
  }

  quoteIdentifier(id: string): string {
    return `\`${id.replace(/`/g, '``')}\``;
  }

  getPlaceholder(_index: number): string {
    return '?';
  }
}
