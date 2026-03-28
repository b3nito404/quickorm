import { Adapter } from '../adapters/Adapter';
import { ColumnType } from '../types';

export interface LiveColumn {
  columnName: string;
  type: string;
  nullable: boolean;
  isPrimary: boolean;
  defaultValue: any;
  length?: number;
}

export interface LiveTable {
  tableName: string;
  columns: LiveColumn[];
  indices: Array<{ name: string; columns: string[]; unique: boolean }>;
}

export class SchemaInspector {
  constructor(private readonly adapter: Adapter) {}

  async getTables(): Promise<string[]> {
    switch (this.adapter.type) {
      case 'postgres': return this.getTablesPostgres();
      case 'mysql':    return this.getTablesMySQL();
      case 'sqlite':   return this.getTablesSQLite();
      case 'memory':   return this.getTablesMemory();
      default:         return [];
    }
  }

  async getTable(tableName: string): Promise<LiveTable | null> {
    switch (this.adapter.type) {
      case 'postgres': return this.getTablePostgres(tableName);
      case 'mysql':    return this.getTableMySQL(tableName);
      case 'sqlite':   return this.getTableSQLite(tableName);
      case 'memory':   return this.getTableMemory(tableName);
      default:         return null;
    }
  }

  async getAllTables(): Promise<LiveTable[]> {
    const names = await this.getTables();
    const tables: LiveTable[] = [];
    for (const name of names) {
      const t = await this.getTable(name);
      if (t) tables.push(t);
    }
    return tables;
  }

  //PostgreSQL
  private async getTablesPostgres(): Promise<string[]> {
    const r = await this.adapter.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`
    );
    return r.rows.map((row: any) => row.table_name);
  }

  private async getTablePostgres(tableName: string): Promise<LiveTable | null> {
    const colR = await this.adapter.query(
      `SELECT column_name, data_type, is_nullable, column_default, character_maximum_length
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
      [tableName]
    );
    if (!colR.rows.length) return null;

    const pkR = await this.adapter.query(
      `SELECT kcu.column_name FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
       WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_name = $1`,
      [tableName]
    );
    const pkCols = new Set(pkR.rows.map((r: any) => r.column_name));

    const idxR = await this.adapter.query(
      `SELECT i.relname as index_name, ix.indisunique as is_unique, a.attname as column_name
       FROM pg_class t JOIN pg_index ix ON t.oid = ix.indrelid
       JOIN pg_class i ON i.oid = ix.indexrelid
       JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
       WHERE t.relname = $1`,
      [tableName]
    );

    return {
      tableName,
      columns: colR.rows.map((r: any) => ({
        columnName:   r.column_name,
        type:         r.data_type,
        nullable:     r.is_nullable === 'YES',
        isPrimary:    pkCols.has(r.column_name),
        defaultValue: r.column_default,
        length:       r.character_maximum_length ?? undefined,
      })),
      indices: this.groupIndices(idxR.rows),
    };
  }

  //MySql
  private async getTablesMySQL(): Promise<string[]> {
    const r = await this.adapter.query(
      `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME`
    );
    return r.rows.map((row: any) => row.TABLE_NAME);
  }

  private async getTableMySQL(tableName: string): Promise<LiveTable | null> {
    const r = await this.adapter.query(
      `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT, CHARACTER_MAXIMUM_LENGTH, COLUMN_KEY
       FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
      [tableName]
    );
    if (!r.rows.length) return null;

    const idxR = await this.adapter.query(
      `SELECT INDEX_NAME, NON_UNIQUE, COLUMN_NAME FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [tableName]
    );

    return {
      tableName,
      columns: r.rows.map((row: any) => ({
        columnName:   row.COLUMN_NAME,
        type:         row.DATA_TYPE,
        nullable:     row.IS_NULLABLE === 'YES',
        isPrimary:    row.COLUMN_KEY === 'PRI',
        defaultValue: row.COLUMN_DEFAULT,
        length:       row.CHARACTER_MAXIMUM_LENGTH ?? undefined,
      })),
      indices: this.groupIndices(idxR.rows.map((r: any) => ({
        index_name: r.INDEX_NAME, is_unique: !r.NON_UNIQUE, column_name: r.COLUMN_NAME,
      }))),
    };
  }

  //SQLite
  private async getTablesSQLite(): Promise<string[]> {
    const r = await this.adapter.query(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
    );
    return r.rows.map((row: any) => row.name);
  }

  private async getTableSQLite(tableName: string): Promise<LiveTable | null> {
    const r = await this.adapter.query(`PRAGMA table_info(${this.adapter.quoteIdentifier(tableName)})`);
    if (!r.rows.length) return null;

    const idxListR = await this.adapter.query(`PRAGMA index_list(${this.adapter.quoteIdentifier(tableName)})`);
    const indices: LiveTable['indices'] = [];
    for (const idx of idxListR.rows as any[]) {
      const infoR = await this.adapter.query(`PRAGMA index_info(${this.adapter.quoteIdentifier(idx.name)})`);
      indices.push({
        name:    idx.name,
        columns: (infoR.rows as any[]).map((i) => i.name),
        unique:  Boolean(idx.unique),
      });
    }

    return {
      tableName,
      columns: (r.rows as any[]).map((col) => ({
        columnName:   col.name,
        type:         col.type,
        nullable:     !col.notnull,
        isPrimary:    Boolean(col.pk),
        defaultValue: col.dflt_value,
      })),
      indices,
    };
  }
  private async getTablesMemory(): Promise<string[]> {
    const adapter = this.adapter as any;
    if (typeof adapter.tables?.keys === 'function') {
      return Array.from(adapter.tables.keys() as Iterable<string>);
    }
    return [];
  }

  private async getTableMemory(tableName: string): Promise<LiveTable | null> {
    const adapter = this.adapter as any;
    if (!adapter.tableExists?.(tableName)) return null;
    // Memory adapter has no column metadata —> return minimal info
    const rows = adapter.getTable(tableName) as any[];
    if (!rows.length) return { tableName, columns: [], indices: [] };
    const columns: LiveColumn[] = Object.keys(rows[0]).map((col) => ({
      columnName: col, type: 'varchar', nullable: true, isPrimary: col === 'id', defaultValue: null,
    }));
    return { tableName, columns, indices: [] };
  }
  private groupIndices(rows: any[]): LiveTable['indices'] {
    const map = new Map<string, { name: string; columns: string[]; unique: boolean }>();
    for (const r of rows) {
      const name = r.index_name ?? r.INDEX_NAME;
      if (!map.has(name)) map.set(name, { name, columns: [], unique: Boolean(r.is_unique) });
      map.get(name)!.columns.push(r.column_name ?? r.COLUMN_NAME);
    }
    return Array.from(map.values());
  }
}
