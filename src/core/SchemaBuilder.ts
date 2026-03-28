import { EntityMetadata, ColumnMetadata, ColumnType } from '../types';
import { Adapter } from '../adapters/Adapter';
import { logger } from '../utils/logger';

/**
 * Generates and executes DDL (CREATE TABLE, CREATE INDEX, etc.)
 * from entity metadata for the `synchronize` feature.
 */
export class SchemaBuilder {
  constructor(private readonly adapter: Adapter) {}

  async synchronize(entities: EntityMetadata[]): Promise<void> {
    for (const entity of entities) {
      await this.createTableIfNotExists(entity);
      await this.createIndices(entity);
    }
  }

  async createTableIfNotExists(entity: EntityMetadata): Promise<void> {
    const q = (id: string) => this.adapter.quoteIdentifier(id);
    const tableName = entity.schema
      ? `${q(entity.schema)}.${q(entity.tableName)}`
      : q(entity.tableName);

    const columnDefs = entity.columns.map((col) => this.buildColumnDef(col, q));
    const primaryKey = entity.columns.find((c) => c.isPrimary);

    const sql = [
      `CREATE TABLE IF NOT EXISTS ${tableName} (`,
      columnDefs.map((d) => `  ${d}`).join(',\n'),
      primaryKey ? `,  PRIMARY KEY (${q(primaryKey.columnName)})` : '',
      ')',
    ]
      .filter(Boolean)
      .join('\n');

    logger.info(`Synchronizing schema: ${entity.tableName}`);
    await this.adapter.query(sql);
  }

  async createIndices(entity: EntityMetadata): Promise<void> {
    const q = (id: string) => this.adapter.quoteIdentifier(id);

    for (const index of entity.indices) {
      const name    = index.name ?? `idx_${entity.tableName}_${index.columns.join('_')}`;
      const unique  = index.unique ? 'UNIQUE ' : '';
      const cols    = index.columns.map((c) => q(c)).join(', ');
      const sql     = `CREATE ${unique}INDEX IF NOT EXISTS ${q(name)} ON ${q(entity.tableName)} (${cols})`;
      await this.adapter.query(sql).catch(() => { /* index may already exist */ });
    }

    // Column-level unique indices
    for (const col of entity.columns) {
      if (col.options.unique && !col.isPrimary) {
        const name = `uq_${entity.tableName}_${col.columnName}`;
        const sql  = `CREATE UNIQUE INDEX IF NOT EXISTS ${q(name)} ON ${q(entity.tableName)} (${q(col.columnName)})`;
        await this.adapter.query(sql).catch(() => {});
      }
    }
  }

  async dropTable(tableName: string): Promise<void> {
    const sql = `DROP TABLE IF EXISTS ${this.adapter.quoteIdentifier(tableName)}`;
    await this.adapter.query(sql);
  }

  private buildColumnDef(
    col: ColumnMetadata,
    q: (s: string) => string
  ): string {
    let def = `${q(col.columnName)} ${this.mapType(col)}`;

    if (col.isGenerated && col.generationStrategy === 'increment') {
      def += ' AUTO_INCREMENT'; // MySQL; for Postgres use SERIAL; for SQLite INTEGER PRIMARY KEY auto-increments
    }

    if (!col.options.nullable && !col.isPrimary) {
      def += ' NOT NULL';
    }

    if (col.options.default !== undefined) {
      def += ` DEFAULT ${this.formatDefault(col.options.default)}`;
    }

    return def;
  }

  private mapType(col: ColumnMetadata): string {
    const adapterType = this.adapter.type;
    const len = col.options.length;
    const prec = col.options.precision;
    const scale = col.options.scale;

    switch (col.type) {
      case 'uuid':
        return adapterType === 'postgres' ? 'UUID' : 'VARCHAR(36)';
      case 'varchar':
        return `VARCHAR(${len ?? 255})`;
      case 'char':
        return `CHAR(${len ?? 1})`;
      case 'text':
        return 'TEXT';
      case 'int':
        return col.isGenerated && col.generationStrategy === 'increment' && adapterType === 'postgres'
          ? 'SERIAL'
          : 'INTEGER';
      case 'bigint':
        return col.isGenerated && col.generationStrategy === 'increment' && adapterType === 'postgres'
          ? 'BIGSERIAL'
          : 'BIGINT';
      case 'smallint':
        return 'SMALLINT';
      case 'tinyint':
        return adapterType === 'postgres' ? 'SMALLINT' : 'TINYINT';
      case 'float':
        return 'FLOAT';
      case 'double':
        return adapterType === 'mysql' ? 'DOUBLE' : 'DOUBLE PRECISION';
      case 'decimal':
        return `DECIMAL(${prec ?? 10}, ${scale ?? 2})`;
      case 'boolean':
        return adapterType === 'mysql' ? 'TINYINT(1)' : 'BOOLEAN';
      case 'date':
        return 'DATE';
      case 'time':
        return 'TIME';
      case 'datetime':
        return adapterType === 'postgres' ? 'TIMESTAMP' : 'DATETIME';
      case 'timestamp':
        return 'TIMESTAMP';
      case 'json':
        return adapterType === 'postgres' ? 'JSON' : 'TEXT';
      case 'jsonb':
        return adapterType === 'postgres' ? 'JSONB' : 'TEXT';
      case 'blob':
        return adapterType === 'postgres' ? 'BYTEA' : 'BLOB';
      case 'enum':
        if (adapterType === 'mysql' && col.options.enum) {
          return `ENUM(${col.options.enum.map((v: any) => `'${v}'`).join(', ')})`;
        }
        return 'VARCHAR(100)';
      default:
        return 'TEXT';
    }
  }

  private formatDefault(value: any): string {
    if (typeof value === 'string') return `'${value}'`;
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    if (value === null) return 'NULL';
    return String(value);
  }
}
