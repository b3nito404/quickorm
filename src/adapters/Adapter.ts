import { QueryResult, DataSourceConfig } from '../types';

/**
 * The low-level interface every database adapter must implement.
 * QuickORM speaks to databases only through this contract.
 */
export interface Adapter {
  /** Unique adapter type identifier */
  readonly type: string;

  /** Connect to the database */
  connect(config: DataSourceConfig): Promise<void>;

  /** Disconnect and release resources */
  disconnect(): Promise<void>;

  /** Returns true if currently connected */
  isConnected(): boolean;

  /**
   * Execute a raw SQL query.
   * @param sql    - Parameterised SQL string (use ? or $N placeholders)
   * @param params - Bound parameter values
   */
  query<T = any>(sql: string, params?: any[]): Promise<QueryResult<T>>;

  /** Begin a transaction */
  beginTransaction(): Promise<void>;

  /** Commit the active transaction */
  commitTransaction(): Promise<void>;

  /** Rollback the active transaction */
  rollbackTransaction(): Promise<void>;

  /**
   * Execute multiple statements inside a single transaction.
   * The adapter will auto-commit on success and auto-rollback on error.
   */
  transaction<T>(fn: (adapter: Adapter) => Promise<T>): Promise<T>;

  /** True if the adapter supports DDL (CREATE TABLE etc.) queries */
  supportsDDL(): boolean;

  /** Escape/quote a table or column name for the specific dialect */
  quoteIdentifier(identifier: string): string;

  /** Return placeholder syntax for the Nth param (e.g. `?` or `$1`) */
  getPlaceholder(index: number): string;
}

/** Base helper shared by adapters */
export abstract class BaseAdapter implements Adapter {
  abstract readonly type: string;
  protected _connected: boolean = false;

  abstract connect(config: DataSourceConfig): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract query<T = any>(sql: string, params?: any[]): Promise<QueryResult<T>>;
  abstract beginTransaction(): Promise<void>;
  abstract commitTransaction(): Promise<void>;
  abstract rollbackTransaction(): Promise<void>;

  isConnected(): boolean {
    return this._connected;
  }

  supportsDDL(): boolean {
    return true;
  }

  quoteIdentifier(id: string): string {
    return `"${id.replace(/"/g, '""')}"`;
  }

  getPlaceholder(index: number): string {
    return '?';
  }

  async transaction<T>(fn: (adapter: Adapter) => Promise<T>): Promise<T> {
    await this.beginTransaction();
    try {
      const result = await fn(this);
      await this.commitTransaction();
      return result;
    } catch (err) {
      await this.rollbackTransaction();
      throw err;
    }
  }
}
