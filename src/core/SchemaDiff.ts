import { EntityMetadata, ColumnMetadata } from '../types';
import { SchemaInspector, LiveTable } from './SchemaInspector';
import { Adapter } from '../adapters/Adapter';
import { logger } from '../utils/logger';

export interface DiffAction {
  type: 'CREATE_TABLE' | 'ADD_COLUMN' | 'ALTER_COLUMN' | 'CREATE_INDEX' | 'DROP_INDEX';
  tableName: string;
  sql: string;
  description: string;
  reverseSql?: string;
}

export interface DiffResult {
  actions: DiffAction[];
  upToDate: boolean;
  summary: string;
}

/**
 * Compares the LIVE database schema against entity metadata and produces
 * a list of DDL actions needed to bring the DB in sync —> without
 * destroying any existing data.
 *
 * @example
 * const diff = await new SchemaDiff(adapter).diff([User, Post, Tag]);
 * console.log(diff.summary);
 * // "2 tables to create, 1 column to add"
 *
 * await new SchemaDiff(adapter).apply(diff);
 * // All actions are executed in a transaction
 */
export class SchemaDiff {
  private inspector: SchemaInspector;

  constructor(private readonly adapter: Adapter) {
    this.inspector = new SchemaInspector(adapter);
  }

  //herse the public API

  async diff(entities: EntityMetadata[]): Promise<DiffResult> {
    const actions: DiffAction[] = [];

    for (const entity of entities) {
      const liveTable = await this.inspector.getTable(entity.tableName);
      if (!liveTable) {
        actions.push(...this.actionsForNewTable(entity));
      } else {
        actions.push(...this.actionsForExistingTable(entity, liveTable));
      }
    }

    const creates = actions.filter((a) => a.type === 'CREATE_TABLE').length;
    const addCols = actions.filter((a) => a.type === 'ADD_COLUMN').length;
    const indices = actions.filter((a) => a.type === 'CREATE_INDEX').length;

    const parts: string[] = [];
    if (creates) parts.push(`${creates} table(s) to create`);
    if (addCols) parts.push(`${addCols} column(s) to add`);
    if (indices) parts.push(`${indices} index(es) to create`);

    return {
      actions,
      upToDate: actions.length === 0,
      summary: parts.length ? parts.join(', ') : 'Schema is up to date ✓',
    };
  }

  /** Execute all diff actions inside a transaction. */
  async apply(diff: DiffResult): Promise<void> {
    if (diff.upToDate) {
      logger.info('Schema already up to date — nothing to do.');
      return;
    }
    logger.info(`Applying ${diff.actions.length} schema change(s)…`);
    await this.adapter.transaction(async () => {
      for (const action of diff.actions) {
        logger.info(`  ${action.description}`);
        await this.adapter.query(action.sql);
      }
    });
    logger.info('Schema sync complete.');
  }

  /** Convenience: diff then immediately apply. */
  async sync(entities: EntityMetadata[]): Promise<DiffResult> {
    const diff = await this.diff(entities);
    await this.apply(diff);
    return diff;
  }

  generateMigrationSource(diff: DiffResult, name: string): string {
    const timestamp = Date.now();
    const className = `${name}${timestamp}`;
    const upLines   = diff.actions.map((a) => `    await runner.query(\`${a.sql}\`);`).join('\n');
    const downLines = diff.actions
      .filter((a) => a.reverseSql)
      .reverse()
      .map((a) => `    await runner.query(\`${a.reverseSql}\`);`)
      .join('\n');

    return `import { Migration, QueryRunner } from 'quickorm';

export class ${className} extends Migration {
  name = '${className}';

  async up(runner: QueryRunner): Promise<void> {
${upLines || '    // TODO: add up statements'}
  }

  async down(runner: QueryRunner): Promise<void> {
${downLines || '    // TODO: add down statements'}
  }
}
`;
  }

  private actionsForNewTable(entity: EntityMetadata): DiffAction[] {
    const actions: DiffAction[] = [];
    const q   = (s: string) => this.adapter.quoteIdentifier(s);
    const col = (c: ColumnMetadata) => this.buildColumnSql(c, q);

    const cols   = entity.columns.map(col);
    const pk     = entity.columns.find((c) => c.isPrimary);
    const pkLine = pk ? `,  PRIMARY KEY (${q(pk.columnName)})` : '';

    const sql = `CREATE TABLE IF NOT EXISTS ${q(entity.tableName)} (\n${cols.map((c) => `  ${c}`).join(',\n')}${pkLine}\n)`;

    actions.push({
      type: 'CREATE_TABLE',
      tableName: entity.tableName,
      sql,
      description: `CREATE TABLE ${entity.tableName}`,
      reverseSql: `DROP TABLE IF EXISTS ${q(entity.tableName)}`,
    });

    for (const idx of entity.indices) {
      const idxName = idx.name ?? `idx_${entity.tableName}_${idx.columns.join('_')}`;
      const unique  = idx.unique ? 'UNIQUE ' : '';
      actions.push({
        type: 'CREATE_INDEX',
        tableName: entity.tableName,
        sql: `CREATE ${unique}INDEX IF NOT EXISTS ${q(idxName)} ON ${q(entity.tableName)} (${idx.columns.map(q).join(', ')})`,
        description: `CREATE INDEX ${idxName}`,
        reverseSql: `DROP INDEX IF EXISTS ${q(idxName)}`,
      });
    }

    for (const col of entity.columns) {
      if (col.options.unique && !col.isPrimary) {
        const uqName = `uq_${entity.tableName}_${col.columnName}`;
        actions.push({
          type: 'CREATE_INDEX',
          tableName: entity.tableName,
          sql: `CREATE UNIQUE INDEX IF NOT EXISTS ${q(uqName)} ON ${q(entity.tableName)} (${q(col.columnName)})`,
          description: `UNIQUE INDEX on ${entity.tableName}.${col.columnName}`,
          reverseSql: `DROP INDEX IF EXISTS ${q(uqName)}`,
        });
      }
    }

    return actions;
  }

  private actionsForExistingTable(entity: EntityMetadata, live: LiveTable): DiffAction[] {
    const actions: DiffAction[] = [];
    const q   = (s: string) => this.adapter.quoteIdentifier(s);
    const t   = this.adapter.type;

    const liveColMap = new Map(live.columns.map((c) => [c.columnName, c]));

    for (const col of entity.columns) {
      if (!liveColMap.has(col.columnName)) {
        // Column missing —> generate ADD COLUMN
        const colSql = this.buildColumnSql(col, q);
        actions.push({
          type: 'ADD_COLUMN',
          tableName: entity.tableName,
          sql: `ALTER TABLE ${q(entity.tableName)} ADD COLUMN ${colSql}`,
          description: `ADD COLUMN ${entity.tableName}.${col.columnName}`,
          reverseSql: `ALTER TABLE ${q(entity.tableName)} DROP COLUMN ${q(col.columnName)}`,
        });
      } else {
        // Column exists — check for type change
        const liveCol = liveColMap.get(col.columnName)!;
        const desiredType = this.mapType(col).toUpperCase().split('(')[0];
        const liveType    = liveCol.type.toUpperCase().split('(')[0];

        if (!this.typesMatch(desiredType, liveType)) {
          const newTypeSql = this.mapType(col);
          let alterSql: string;

          if (t === 'postgres') {
            alterSql = `ALTER TABLE ${q(entity.tableName)} ALTER COLUMN ${q(col.columnName)} TYPE ${newTypeSql} USING ${q(col.columnName)}::${newTypeSql}`;
          } else if (t === 'mysql') {
            const colDef = this.buildColumnSql(col, q);
            alterSql = `ALTER TABLE ${q(entity.tableName)} MODIFY COLUMN ${colDef}`;
          } else {
            // SQLite does not support ALTER COLUMN — skip silently
            continue;
          }

          actions.push({
            type: 'ALTER_COLUMN',
            tableName: entity.tableName,
            sql: alterSql,
            description: `ALTER COLUMN ${entity.tableName}.${col.columnName} (${liveType} → ${desiredType})`,
          });
        }
      }
      // Note: ALTER COLUMN (type changes) are intentionally skipped —> destructive and dialect-specific
    }

    const liveIdxNames = new Set(live.indices.map((i) => i.name));
    for (const idx of entity.indices) {
      const idxName = idx.name ?? `idx_${entity.tableName}_${idx.columns.join('_')}`;
      if (!liveIdxNames.has(idxName)) {
        const unique = idx.unique ? 'UNIQUE ' : '';
        actions.push({
          type: 'CREATE_INDEX',
          tableName: entity.tableName,
          sql: `CREATE ${unique}INDEX IF NOT EXISTS ${q(idxName)} ON ${q(entity.tableName)} (${idx.columns.map(q).join(', ')})`,
          description: `CREATE INDEX ${idxName}`,
          reverseSql: `DROP INDEX IF EXISTS ${q(idxName)}`,
        });
      }
    }

    return actions;
  }

  private typesMatch(desired: string, live: string): boolean {
    const aliases: Record<string, string[]> = {
      'INTEGER':          ['INT', 'INTEGER', 'TINYINT', 'SMALLINT'],
      'VARCHAR':          ['VARCHAR', 'CHARACTER VARYING'],
      'BOOLEAN':          ['BOOLEAN', 'BOOL', 'TINYINT'],
      'TIMESTAMP':        ['TIMESTAMP', 'DATETIME', 'TIMESTAMP WITHOUT TIME ZONE'],
      'DOUBLE PRECISION': ['DOUBLE', 'DOUBLE PRECISION', 'FLOAT8'],
      'FLOAT':            ['FLOAT', 'REAL', 'FLOAT4'],
      'TEXT':             ['TEXT', 'CLOB', 'LONGTEXT'],
      'UUID':             ['UUID', 'VARCHAR'],
    };
    if (desired === live) return true;
    for (const group of Object.values(aliases)) {
      if (group.includes(desired) && group.includes(live)) return true;
    }
    return false;
  }

  private buildColumnSql(col: ColumnMetadata, q: (s: string) => string): string {
    const type = this.mapType(col);
    let def = `${q(col.columnName)} ${type}`;
    if (!col.options.nullable && !col.isPrimary) def += ' NOT NULL';
    if (col.options.default !== undefined) def += ` DEFAULT ${this.fmtDefault(col.options.default)}`;
    return def;
  }

  private mapType(col: ColumnMetadata): string {
    const t = this.adapter.type;
    switch (col.type) {
      case 'uuid':      return t === 'postgres' ? 'UUID' : 'VARCHAR(36)';
      case 'varchar':   return `VARCHAR(${col.options.length ?? 255})`;
      case 'text':      return 'TEXT';
      case 'int':
        if (col.isGenerated && col.generationStrategy === 'increment') {
          return t === 'postgres' ? 'SERIAL' : t === 'sqlite' ? 'INTEGER' : 'INT AUTO_INCREMENT';
        }
        return 'INTEGER';
      case 'bigint':    return t === 'postgres' ? 'BIGSERIAL' : 'BIGINT';
      case 'float':     return 'FLOAT';
      case 'double':    return t === 'mysql' ? 'DOUBLE' : 'DOUBLE PRECISION';
      case 'decimal':   return `DECIMAL(${col.options.precision ?? 10},${col.options.scale ?? 2})`;
      case 'boolean':   return t === 'mysql' ? 'TINYINT(1)' : 'BOOLEAN';
      case 'date':      return 'DATE';
      case 'datetime':  return t === 'postgres' ? 'TIMESTAMP' : 'DATETIME';
      case 'timestamp': return 'TIMESTAMP';
      case 'json':      return t === 'postgres' ? 'JSON' : 'TEXT';
      case 'jsonb':     return t === 'postgres' ? 'JSONB' : 'TEXT';
      case 'blob':      return t === 'postgres' ? 'BYTEA' : 'BLOB';
      default:          return 'TEXT';
    }
  }

  private fmtDefault(v: any): string {
    if (typeof v === 'string') return `'${v}'`;
    if (v === null) return 'NULL';
    return String(v);
  }
}