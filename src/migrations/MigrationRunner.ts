import { Adapter } from '../adapters/Adapter';
import { MigrationInterface, QueryRunner, ColumnDefinition, QueryResult } from '../types';
import { MigrationError } from '../errors/OrmError';
import { logger } from '../utils/logger';

const MIGRATIONS_TABLE = 'quickorm_migrations';

/**
 * Tracks and runs database migrations.
 *
 * Migration records are stored in a `quickorm_migrations` table that is
 * auto-created on first run.
 */
export class MigrationRunner {
  private queryRunner: QueryRunnerImpl;

  constructor(private readonly adapter: Adapter) {
    this.queryRunner = new QueryRunnerImpl(adapter);
  }



  async run(migrations: Array<new () => MigrationInterface>): Promise<void> {
    await this.ensureMigrationsTable();
    const executed = await this.getExecutedMigrations();

    const pending = migrations
      .map((M) => new M())
      .filter((m) => !executed.includes(m.name))
      .sort((a, b) => a.name.localeCompare(b.name));

    if (!pending.length) {
      logger.info('No pending migrations');
      return;
    }

    logger.info(`Running ${pending.length} migration(s)…`);

    for (const migration of pending) {
      logger.info(`  up ${migration.name}`);
      try {
        await this.adapter.transaction(async () => {
          await migration.up(this.queryRunner);
          await this.recordMigration(migration.name);
        });
      } catch (err: any) {
        throw new MigrationError(`Failed to run migration "${migration.name}"`, migration.name, err);
      }
    }

    logger.info(`Done. ${pending.length} migration(s) applied.`);
  }

  //rv

  async revert(migrations?: Array<new () => MigrationInterface>): Promise<void> {
    await this.ensureMigrationsTable();
    const executed = await this.getExecutedMigrations();
    if (!executed.length) {
      logger.info('Nothing to revert');
      return;
    }

    const lastName = executed[executed.length - 1];
    logger.info(`  ↓ ${lastName}`);

    if (migrations) {
      const MigClass = migrations.map((M) => new M()).find((m) => m.name === lastName);
      if (MigClass) {
        try {
          await this.adapter.transaction(async () => {
            await MigClass.down(this.queryRunner);
            await this.removeMigration(lastName);
          });
        } catch (err: any) {
          throw new MigrationError(`Failed to revert migration "${lastName}"`, lastName, err);
        }
      }
    } else {
      // Just remove the record without a down script
      await this.removeMigration(lastName);
    }
  }

  async getExecutedMigrations(): Promise<string[]> {
    const result = await this.adapter.query(
      `SELECT name FROM ${MIGRATIONS_TABLE} ORDER BY executed_at ASC`
    );
    return result.rows.map((r: any) => r.name);
  }

  private async ensureMigrationsTable(): Promise<void> {
    const q = (id: string) => this.adapter.quoteIdentifier(id);
    await this.adapter.query(`
      CREATE TABLE IF NOT EXISTS ${q(MIGRATIONS_TABLE)} (
        id        INTEGER PRIMARY KEY,
        name      VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  private async recordMigration(name: string): Promise<void> {
    const q = (id: string) => this.adapter.quoteIdentifier(id);
    const p1 = this.adapter.getPlaceholder(1);
    const p2 = this.adapter.getPlaceholder(2);
    await this.adapter.query(
      `INSERT INTO ${q(MIGRATIONS_TABLE)} (name, executed_at) VALUES (${p1}, ${p2})`,
      [name, new Date()]
    );
  }

  private async removeMigration(name: string): Promise<void> {
    const q  = (id: string) => this.adapter.quoteIdentifier(id);
    const p1 = this.adapter.getPlaceholder(1);
    await this.adapter.query(
      `DELETE FROM ${q(MIGRATIONS_TABLE)} WHERE name = ${p1}`,
      [name]
    );
  }
}

class QueryRunnerImpl implements QueryRunner {
  constructor(private readonly adapter: Adapter) {}

  async query(sql: string, params?: any[]): Promise<QueryResult> {
    return this.adapter.query(sql, params);
  }

  async createTable(tableName: string, columns: ColumnDefinition[]): Promise<void> {
    const q   = (id: string) => this.adapter.quoteIdentifier(id);
    const defs = columns.map((col) => {
      let def = `${q(col.name)} ${col.type.toUpperCase()}`;
      if (col.length) def += `(${col.length})`;
      if (col.primary) def += ' PRIMARY KEY';
      if (col.autoIncrement) def += ' AUTOINCREMENT';
      if (!col.nullable && !col.primary) def += ' NOT NULL';
      if (col.unique && !col.primary) def += ' UNIQUE';
      if (col.default !== undefined) def += ` DEFAULT ${typeof col.default === 'string' ? `'${col.default}'` : col.default}`;
      return def;
    });
    await this.adapter.query(`CREATE TABLE IF NOT EXISTS ${q(tableName)} (${defs.join(', ')})`);
  }

  async dropTable(tableName: string): Promise<void> {
    await this.adapter.query(`DROP TABLE IF EXISTS ${this.adapter.quoteIdentifier(tableName)}`);
  }

  async addColumn(tableName: string, col: ColumnDefinition): Promise<void> {
    const q   = (id: string) => this.adapter.quoteIdentifier(id);
    let def   = `${q(col.name)} ${col.type.toUpperCase()}`;
    if (col.length) def += `(${col.length})`;
    if (!col.nullable) def += ' NOT NULL';
    if (col.default !== undefined) def += ` DEFAULT ${typeof col.default === 'string' ? `'${col.default}'` : col.default}`;
    await this.adapter.query(`ALTER TABLE ${q(tableName)} ADD COLUMN ${def}`);
  }

  async dropColumn(tableName: string, columnName: string): Promise<void> {
    const q = (id: string) => this.adapter.quoteIdentifier(id);
    await this.adapter.query(`ALTER TABLE ${q(tableName)} DROP COLUMN ${q(columnName)}`);
  }

  async createIndex(tableName: string, columns: string[], unique = false, name?: string): Promise<void> {
    const q    = (id: string) => this.adapter.quoteIdentifier(id);
    const idxName = name ?? `idx_${tableName}_${columns.join('_')}`;
    const cols = columns.map(q).join(', ');
    await this.adapter.query(
      `CREATE ${unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS ${q(idxName)} ON ${q(tableName)} (${cols})`
    );
  }

  async dropIndex(name: string): Promise<void> {
    await this.adapter.query(`DROP INDEX IF EXISTS ${this.adapter.quoteIdentifier(name)}`);
  }
}
