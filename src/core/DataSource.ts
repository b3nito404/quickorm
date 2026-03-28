import { Adapter } from '../adapters/Adapter';
import { MemoryAdapter } from '../adapters/MemoryAdapter';
import { PostgresAdapter } from '../adapters/PostgresAdapter';
import { MySQLAdapter } from '../adapters/MySQLAdapter';
import { SQLiteAdapter } from '../adapters/SQLiteAdapter';
import { Repository } from '../repositories/Repository';
import { QueryBuilder } from './QueryBuilder';
import { SchemaBuilder } from './SchemaBuilder';
import { SchemaDiff, DiffResult as SchemaDiffResult } from './SchemaDiff';
import { MigrationRunner } from '../migrations/MigrationRunner';
import { metadataStorage } from './MetadataStorage';
import { DataSourceConfig, Constructor, MigrationInterface } from '../types';
import { ConnectionError, TransactionError } from '../errors/OrmError';
import { logger } from '../utils/logger';

/**
 * .
 * Datasources manages the database connection, repositories, migrations, and transactions.
 *
 * @example
 * const ds = new DataSource({
 *   type: 'postgres',
 *   host: 'localhost',
 *   database: 'mydb',
 *   username: 'postgres',
 *   password: 'secret',
 *   entities: [User, Post],
 *   synchronize: true,
 *   logging: true,
 * });
 *
 * await ds.connect();
 * const userRepo = ds.getRepository(User);
 */
export class DataSource {
  private adapter!: Adapter;
  private config: DataSourceConfig;
  private repositories: Map<Function, Repository<any>> = new Map();
  private _connected: boolean = false;

  constructor(config: DataSourceConfig) {
    this.config = config;
  }

  async connect(): Promise<this> {
    if (this._connected) return this;

    // Configure logger
    logger.setEnabled(this.config.logging ?? false);

    // Build adapter
    this.adapter = this.createAdapter(this.config.type);

    // Register entities in metadata storage
    if (this.config.entities?.length) {
      for (const entity of this.config.entities) {
        // Just referencing the class forces decorator execution (already done at import time)
        // but we ensure they're registered
        if (!metadataStorage.hasEntityMetadata(entity)) {
          logger.warn(`Entity "${(entity as any).name}" is listed in DataSource but has no @Entity decorator.`);
        }
      }
    }

    await this.adapter.connect(this.config);
    this._connected = true;
    logger.info('DataSource connected');

    // Auto-sync schema
    if (this.config.synchronize) {
      await this.synchronize();
    }

    // Run migrations
    if (this.config.migrationsRun && this.config.migrations?.length) {
      await this.runMigrations();
    }

    return this;
  }

  async disconnect(): Promise<void> {
    if (!this._connected) return;
    await this.adapter.disconnect();
    this._connected = false;
    logger.info('DataSource disconnected');
  }

  get isConnected(): boolean {
    return this._connected;
  }


  /**
   * Get a repository for an entity class.
   * Repositories are cached ;one instance per entity per DataSource.
   *
   * @example
   * const repo = ds.getRepository(User);
   * const user = await repo.findById('uuid-here');
   */
  getRepository<T extends object>(entity: Constructor<T>): Repository<T> {
    if (this.repositories.has(entity)) {
      return this.repositories.get(entity) as Repository<T>;
    }
    this.assertConnected();
    const repo = new Repository<T>(entity, this.adapter);
    this.repositories.set(entity, repo);
    return repo;
  }

  /**
   * Create a raw QueryBuilder not tied to any entity.
   *
   * @example
   * const results = await ds.createQueryBuilder()
   *   .from('users', 'u')
   *   .leftJoin('posts', 'p', 'p.author_id = u.id')
   *   .select('u.id', 'u.name', 'COUNT(p.id) as postCount')
   *   .groupBy('u.id')
   *   .getMany();
   */
  createQueryBuilder<T = any>(): QueryBuilder<T> {
    this.assertConnected();
    return new QueryBuilder<T>(this.adapter);
  }


  /**
   * Execute a callback inside a database transaction.
   * Auto-commits on success, auto-rolls-back on error.
   *
   * @example
   * await ds.transaction(async (tx) => {
   *   const userRepo = tx.getRepository(User);
   *   await userRepo.save(user);
   *   await tx.getRepository(Account).updateById(accountId, { balance: newBalance });
   * });
   */
  async transaction<T>(fn: (tx: TransactionScope) => Promise<T>): Promise<T> {
    this.assertConnected();
    return this.adapter.transaction(async (txAdapter) => {
      const scope = new TransactionScope(txAdapter, this);
      return fn(scope);
    });
  }

  async query<T = any>(sql: string, params?: any[]): Promise<T[]> {
    this.assertConnected();
    const result = await this.adapter.query<T>(sql, params);
    return result.rows;
  }

  //schema
  async synchronize(): Promise<void> {
    this.assertConnected();
    const entities = this.config.entities
      ? this.config.entities
          .filter((e) => metadataStorage.hasEntityMetadata(e))
          .map((e) => metadataStorage.getEntityMetadata(e))
      : metadataStorage.getAllEntities();

    const builder = new SchemaBuilder(this.adapter);
    await builder.synchronize(entities);
    logger.info(`Schema synchronized (${entities.length} entities)`);
  }

  /**
   * Compute the diff between the live database schema and entity metadata.
   * Returns a description of what would change does NOT apply it.
   *
   * @example
   * const diff = await ds.diff();
   * console.log(diff.summary);
   * await ds.applyDiff(diff);           // apply the changes
   * // or:
   * const src = ds.generateMigration(diff, 'AddAgeColumn');
   * // write src to a .ts file
   */
  async diff(options: { destructive?: boolean } = {}): Promise<SchemaDiffResult> {
    this.assertConnected();
    const entities = this.config.entities
      ? this.config.entities
          .filter((e) => metadataStorage.hasEntityMetadata(e))
          .map((e) => metadataStorage.getEntityMetadata(e))
      : metadataStorage.getAllEntities();

    const differ = new SchemaDiff(this.adapter);
    return differ.diff(entities);
  }

  /**
   * Apply a previously-computed diff to the live database.
   */
  async applyDiff(diff: SchemaDiffResult): Promise<void> {
    this.assertConnected();
    const differ = new SchemaDiff(this.adapter);
    await differ.apply(diff);
  }

  /**
   * Generate a TypeScript migration file source from a diff.
   */
  generateMigration(diff: SchemaDiffResult, name: string): string {
    const differ = new SchemaDiff(this.adapter);
    return differ.generateMigrationSource(diff, name);
  }

  //Mg

  async runMigrations(): Promise<void> {
    this.assertConnected();
    const runner = new MigrationRunner(this.adapter);
    const migrations = (this.config.migrations ?? []).filter(
      (m): m is new () => MigrationInterface => typeof m === 'function'
    );
    await runner.run(migrations);
  }

  async revertLastMigration(): Promise<void> {
    this.assertConnected();
    const runner = new MigrationRunner(this.adapter);
    await runner.revert();
  }

  getAdapter(): Adapter {
    this.assertConnected();
    return this.adapter;
  }

  private assertConnected(): void {
    if (!this._connected) {
      throw new ConnectionError('DataSource is not connected. Call ds.connect() first.');
    }
  }

  private createAdapter(type: string): Adapter {
    switch (type) {
      case 'memory':   return new MemoryAdapter();
      case 'postgres': return new PostgresAdapter();
      case 'mysql':    return new MySQLAdapter();
      case 'sqlite':   return new SQLiteAdapter();
      default:
        throw new ConnectionError(`Unknown adapter type: "${type}". Use memory | postgres | mysql | sqlite.`);
    }
  }
}


/**
 * lightweight DataSource-like object passed to transaction callbacks.
 * It binds all repositories to the transaction's adapter.
 */
export class TransactionScope {
  constructor(
    private readonly txAdapter: Adapter,
    private readonly parent: DataSource
  ) {}

  getRepository<T extends object>(entity: Constructor<T>): Repository<T> {
    return new Repository<T>(entity, this.txAdapter);
  }

  createQueryBuilder<T = any>(): QueryBuilder<T> {
    return new QueryBuilder<T>(this.txAdapter);
  }

  async query<T = any>(sql: string, params?: any[]): Promise<T[]> {
    const result = await this.txAdapter.query<T>(sql, params);
    return result.rows;
  }
}
