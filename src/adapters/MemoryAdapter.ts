import { BaseAdapter } from './Adapter';
import { QueryResult, DataSourceConfig } from '../types';
import { QueryError } from '../errors/OrmError';

type Row = Record<string, any>;
type Table = Row[];

/**
 * A fully in-memory adapter — no database required.
 * Perfect for unit tests and rapid prototyping.
 *
 * It parses a limited subset of SQL so the same Repository / QueryBuilder
 * code works without any actual database.
 */
export class MemoryAdapter extends BaseAdapter {
  readonly type = 'memory';

  private tables: Map<string, Table> = new Map();
  private autoIncrements: Map<string, number> = new Map();
  private inTransaction: boolean = false;
  private snapshot: Map<string, Table> | null = null;

  // Lifecycle

  async connect(_config: DataSourceConfig): Promise<void> {
    this._connected = true;
  }

  async disconnect(): Promise<void> {
    this._connected = false;
    this.tables.clear();
  }

  // Transactions

  async beginTransaction(): Promise<void> {
    this.inTransaction = true;
    this.snapshot = new Map(
      Array.from(this.tables.entries()).map(([k, v]) => [k, v.map((r) => ({ ...r }))])
    );
  }

  async commitTransaction(): Promise<void> {
    this.inTransaction = false;
    this.snapshot = null;
  }

  async rollbackTransaction(): Promise<void> {
    if (this.snapshot) {
      this.tables = this.snapshot;
      this.snapshot = null;
    }
    this.inTransaction = false;
  }

  // DDL

  quoteIdentifier(id: string): string {
    return `"${id}"`;
  }

  getPlaceholder(_index: number): string {
    return '?';
  }

  // Core query engine

  async query<T = any>(sql: string, params: any[] = []): Promise<QueryResult<T>> {
    const s = sql.trim();
    try {
      if (/^CREATE\s+TABLE/i.test(s)) return this.execCreateTable(s);
      if (/^DROP\s+TABLE/i.test(s)) return this.execDropTable(s);
      if (/^INSERT\s+INTO/i.test(s)) return this.execInsert(s, params);
      if (/^SELECT/i.test(s)) return this.execSelect(s, params);
      if (/^UPDATE/i.test(s)) return this.execUpdate(s, params);
      if (/^DELETE\s+FROM/i.test(s)) return this.execDelete(s, params);
      if (/^CREATE\s+INDEX/i.test(s)) return { rows: [], rowCount: 0 };
      if (/^DROP\s+INDEX/i.test(s)) return { rows: [], rowCount: 0 };
      if (/^ALTER\s+TABLE/i.test(s)) return this.execAlterTable(s);
      return { rows: [], rowCount: 0 };
    } catch (err: any) {
      throw new QueryError(err.message, sql, params, err);
    }
  }

  // Table management

  ensureTable(name: string): void {
    if (!this.tables.has(name)) this.tables.set(name, []);
  }

  getTable(name: string): Table {
    return this.tables.get(name) ?? [];
  }

  tableExists(name: string): boolean {
    return this.tables.has(name);
  }

  // DDL executors

  private execCreateTable(sql: string): QueryResult {
    const match = sql.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?/i);
    if (match) {
      const name = match[1];
      if (!this.tables.has(name)) this.tables.set(name, []);
    }
    return { rows: [], rowCount: 0 };
  }

  private execDropTable(sql: string): QueryResult {
    const match = sql.match(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?"?(\w+)"?/i);
    if (match) this.tables.delete(match[1]);
    return { rows: [], rowCount: 0 };
  }

  private execAlterTable(_sql: string): QueryResult {
    return { rows: [], rowCount: 0 };
  }

  // DML executors

  private execInsert(sql: string, params: any[]): QueryResult {
    const tableMatch = sql.match(/INSERT\s+INTO\s+"?(\w+)"?/i);
    if (!tableMatch) throw new Error('Malformed INSERT statement');
    const tableName = tableMatch[1];

    const colMatch = sql.match(/\(([^)]+)\)\s+VALUES/i);
    if (!colMatch) throw new Error('Could not parse INSERT columns');

    const columns = colMatch[1]
      .split(',')
      .map((c) => c.trim().replace(/"/g, ''));

    const row: Row = {};
    columns.forEach((col, i) => {
      row[col] = params[i] ?? null;
    });

    this.ensureTable(tableName);
    this.tables.get(tableName)!.push(row);

    return { rows: [row], rowCount: 1 };
  }

  private execSelect<T>(sql: string, params: any[]): QueryResult<T> {
    const tableMatch = sql.match(/FROM\s+"?(\w+)"?/i);
    if (!tableMatch) throw new Error('Could not parse SELECT table');
    const tableName = tableMatch[1];

    let rows: Row[] = [...(this.tables.get(tableName) ?? [])];

    rows = this.applyWhere(rows, sql, params);

    const orderMatch = sql.match(/ORDER\s+BY\s+(.+?)(?:\s+LIMIT|\s+OFFSET|$)/i);
    if (orderMatch) {
      const parts = orderMatch[1].trim().split(',');
      for (const part of parts.reverse()) {
        const m = part.trim().match(/"?(\w+)"?\s*(ASC|DESC)?/i);
        if (m) {
          const field = m[1];
          const dir = (m[2] ?? 'ASC').toUpperCase();
          rows.sort((a, b) => {
            const av = a[field], bv = b[field];
            if (av == null && bv == null) return 0;
            if (av == null) return dir === 'ASC' ? -1 : 1;
            if (bv == null) return dir === 'ASC' ? 1 : -1;
            return dir === 'ASC'
              ? (av < bv ? -1 : av > bv ? 1 : 0)
              : (av > bv ? -1 : av < bv ? 1 : 0);
          });
        }
      }
    }

    // Aggregate functions: COUNT, SUM, AVG, MIN, MAX
    if (/\b(COUNT|SUM|AVG|MIN|MAX)\s*\(/i.test(sql) && !/GROUP\s+BY/i.test(sql)) {
      const filtered = this.applyWhere([...rows], sql, params);
      const aggResult = this.computeAggregates(sql, filtered);
      return { rows: [aggResult as any], rowCount: 1 };
    }

    // GROUP BY with aggregates
    if (/GROUP\s+BY/i.test(sql)) {
      const filtered = this.applyWhere([...rows], sql, params);
      const grouped = this.computeGroupBy(sql, filtered);
      const having = this.applyHaving(grouped, sql);
      return { rows: having as any[], rowCount: having.length };
    }

    const limitMatch = sql.match(/LIMIT\s+(\d+)/i);
    const offsetMatch = sql.match(/OFFSET\s+(\d+)/i);
    const offset = offsetMatch ? parseInt(offsetMatch[1]) : 0;
    const limit = limitMatch ? parseInt(limitMatch[1]) : undefined;

    if (offset) rows = rows.slice(offset);
    if (limit !== undefined) rows = rows.slice(0, limit);

    const selectPart = sql.match(/^SELECT\s+(.*?)\s+FROM/is)?.[1]?.trim();
    if (selectPart && selectPart !== '*') {
      const cols = selectPart.split(',').map((c) => c.trim().replace(/"/g, ''));
      rows = rows.map((r) => {
        const out: Row = {};
        cols.forEach((c) => {
          out[c] = r[c];
        });
        return out;
      });
    }

    return { rows: rows as T[], rowCount: rows.length };
  }

  private execUpdate(sql: string, params: any[]): QueryResult {
    const tableMatch = sql.match(/UPDATE\s+"?(\w+)"?\s+SET/i);
    if (!tableMatch) throw new Error('Malformed UPDATE statement');
    const tableName = tableMatch[1];

    const setMatch = sql.match(/SET\s+(.+?)\s+(?:WHERE|$)/is);
    if (!setMatch) throw new Error('Could not parse SET clause');

    const setParts = setMatch[1].split(',').map((p) => p.trim());
    const setColumns: string[] = [];
    let paramIndex = 0;

    for (const part of setParts) {
      const colMatch = part.match(/"?(\w+)"?\s*=\s*\?/);
      if (colMatch) setColumns.push(colMatch[1]);
    }

    const setValues = params.slice(0, setColumns.length);
    paramIndex = setColumns.length;
    const whereParams = params.slice(paramIndex);

    const table = this.tables.get(tableName) ?? [];
    const toUpdate = this.applyWhere(table, sql, whereParams);

    let updated = 0;
    for (const row of table) {
      if (toUpdate.includes(row)) {
        setColumns.forEach((col, i) => {
          row[col] = setValues[i];
        });
        updated++;
      }
    }

    return { rows: [], rowCount: updated };
  }

  private execDelete(sql: string, params: any[]): QueryResult {
    const tableMatch = sql.match(/DELETE\s+FROM\s+"?(\w+)"?/i);
    if (!tableMatch) throw new Error('Malformed DELETE statement');
    const tableName = tableMatch[1];

    const table = this.tables.get(tableName) ?? [];
    const toDelete = this.applyWhere(table, sql, params);

    const before = table.length;
    this.tables.set(tableName, table.filter((r) => !toDelete.includes(r)));

    return { rows: [], rowCount: before - this.tables.get(tableName)!.length };
  }

  // WHERE parsing

  private applyWhere(rows: Row[], sql: string, params: any[]): Row[] {
    const whereMatch = sql.match(/WHERE\s+(.+?)(?:\s+ORDER|\s+LIMIT|\s+OFFSET|$)/is);
    if (!whereMatch) return rows;

    let whereClause = whereMatch[1].trim();

    whereClause = this.resolveSubqueries(whereClause, params);

    const conditions = this.parseWhereConditions(whereClause, params);
    return rows.filter((row) => conditions.every((cond) => this.evalCondition(row, cond)));
  }

  private computeAggregates(sql: string, rows: Row[]): Row {
    const result: Row = {};
    const selectPart = sql.match(/^SELECT\s+(.+?)\s+FROM/is)?.[1] ?? '';
    const exprs = selectPart.split(',').map((e) => e.trim());

    for (const expr of exprs) {
      const aliasMatch = expr.match(/(?:AS\s+)?"?(\w+)"?\s*$/i);
      const alias = aliasMatch?.[1] ?? expr.replace(/[^a-z0-9_]/gi, '_');

      if (/COUNT\(\*\)/i.test(expr)) {
        result[alias] = rows.length;
      } else {
        const fnMatch = expr.match(/(COUNT|SUM|AVG|MIN|MAX)\s*\(\s*"?(\w+)"?\s*\)/i);
        if (fnMatch) {
          const fn = fnMatch[1].toUpperCase();
          const col = fnMatch[2];
          const vals = rows.map((r) => Number(r[col])).filter((v) => !isNaN(v));

          switch (fn) {
            case 'COUNT':
              result[alias] = rows.filter((r) => r[col] != null).length;
              break;
            case 'SUM':
              result[alias] = vals.reduce((a, b) => a + b, 0);
              break;
            case 'AVG':
              result[alias] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
              break;
            case 'MIN':
              result[alias] = vals.length ? Math.min(...vals) : null;
              break;
            case 'MAX':
              result[alias] = vals.length ? Math.max(...vals) : null;
              break;
          }
        } else {
          const colMatch = expr.match(/"?(\w+)"?/);
          if (colMatch && rows.length) result[alias] = rows[0][colMatch[1]];
        }
      }
    }

    return result;
  }

  private computeGroupBy(sql: string, rows: Row[]): Row[] {
    const groupMatch = sql.match(/GROUP\s+BY\s+(.+?)(?:\s+HAVING|\s+ORDER|\s+LIMIT|$)/i);
    if (!groupMatch) return rows;

    const groupCols = groupMatch[1].split(',').map((c) => c.trim().replace(/"/g, ''));
    const groups = new Map<string, Row[]>();

    for (const row of rows) {
      const key = groupCols.map((c) => String(row[c] ?? '')).join('||');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    }

    return Array.from(groups.values()).map((grp) => this.computeAggregates(sql, grp));
  }

  private applyHaving(rows: Row[], sql: string): Row[] {
    const havingMatch = sql.match(/HAVING\s+(.+?)(?:\s+ORDER|\s+LIMIT|$)/i);
    if (!havingMatch) return rows;

    const clause = havingMatch[1].trim();
    const m = clause.match(/"?(\w+)"?\s*(=|!=|>|>=|<|<=)\s*([\d.]+)/);
    if (!m) return rows;

    const [, col, op, valStr] = m;
    const val = parseFloat(valStr);

    return rows.filter((row) => {
      const v = Number(row[col]);
      switch (op) {
        case '=':
          return v === val;
        case '!=':
          return v !== val;
        case '>':
          return v > val;
        case '>=':
          return v >= val;
        case '<':
          return v < val;
        case '<=':
          return v <= val;
        default:
          return true;
      }
    });
  }

  private resolveSubqueries(clause: string, _params: any[]): string {
    const subRe = /"?(\w+)"?\s+IN\s+\(\s*SELECT\s+(.+?)\s+FROM\s+"?(\w+)"?(?:\s+WHERE\s+(.+?))?\s*\)/gi;
    return clause.replace(subRe, (match, col, selectCol, fromTable, subWhere) => {
      const table = this.getTable(fromTable);
      if (!table.length) return `"${col}" IN (NULL)`;

      const cleanCol = selectCol.trim().replace(/"/g, '');
      let rows = [...table];

      if (subWhere) {
        const eqMatch = subWhere.match(/"?(\w+)"?\s*=\s*'([^']+)'/);
        if (eqMatch) {
          rows = rows.filter((r) => String(r[eqMatch[1]]) === eqMatch[2]);
        }
      }

      const values = rows.map((r) => r[cleanCol]).filter((v) => v != null);
      if (!values.length) return `"${col}" IN (NULL)`;

      const placeholders = values.map((v) => (typeof v === 'string' ? `'${v}'` : String(v)));
      return `"${col}" IN (${placeholders.join(', ')})`;
    });
  }

  private parseWhereConditions(clause: string, params: any[]): Array<{
    col: string;
    op: string;
    val: any;
    connector: string;
  }> {
    const betweens: Array<{ col: string }> = [];
    let normalized = clause.replace(
      /"?(\w+)"?\s+BETWEEN\s+\?\s+AND\s+\?/gi,
      (_match, col) => {
        betweens.push({ col });
        return `__BETWEEN_${betweens.length - 1}__`;
      }
    );

    const parts = normalized.split(/\s+(AND|OR)\s+/i);
    const conditions: Array<{ col: string; op: string; val: any; connector: string }> = [];
    let paramIdx = 0;
    let connector = 'AND';

    for (const part of parts) {
      if (/^(AND|OR)$/i.test(part.trim())) {
        connector = part.trim().toUpperCase();
        continue;
      }

      const trimmedPart = part.trim();

      const btMatch = trimmedPart.match(/^__BETWEEN_(\d+)__$/);
      if (btMatch) {
        const idx = parseInt(btMatch[1]);
        const v1 = params[paramIdx++];
        const v2 = params[paramIdx++];
        conditions.push({ col: betweens[idx].col, op: 'BETWEEN', val: [v1, v2], connector });
        connector = 'AND';
        continue;
      }

      const isNull = trimmedPart.match(/"?(\w+)"?\s+IS\s+NULL/i);
      const isNotNull = trimmedPart.match(/"?(\w+)"?\s+IS\s+NOT\s+NULL/i);
      const inClause = trimmedPart.match(/"?(\w+)"?\s+IN\s+\(([^)]+)\)/i);
      const notIn = trimmedPart.match(/"?(\w+)"?\s+NOT\s+IN\s+\(([^)]+)\)/i);
      const basic = trimmedPart.match(/"?(\w+)"?\s*(=|!=|>=|<=|>|<|LIKE|ILIKE)\s*\?/i);

      if (isNotNull) {
        conditions.push({ col: isNotNull[1], op: 'IS NOT NULL', val: null, connector });
      } else if (isNull) {
        conditions.push({ col: isNull[1], op: 'IS NULL', val: null, connector });
      } else if (notIn) {
        const rawNotIn = notIn[2].trim();
        const values = rawNotIn.includes('?')
          ? params.slice(paramIdx, paramIdx + rawNotIn.split(',').length)
          : rawNotIn.split(',').map((v: string) => v.trim().replace(/^'|'$/g, ''));
        paramIdx += rawNotIn.includes('?') ? rawNotIn.split(',').length : 0;
        conditions.push({ col: notIn[1], op: 'NOT IN', val: values, connector });
      } else if (inClause) {
        const rawIn = inClause[2].trim();
        const values = rawIn.includes('?')
          ? params.slice(paramIdx, paramIdx + rawIn.split(',').length)
          : rawIn.split(',').map((v: string) => v.trim().replace(/^'|'$/g, ''));
        paramIdx += rawIn.includes('?') ? rawIn.split(',').length : 0;
        conditions.push({ col: inClause[1], op: 'IN', val: values, connector });
      } else if (basic) {
        const val = params[paramIdx++];
        conditions.push({ col: basic[1], op: basic[2].toUpperCase(), val, connector });
      }

      connector = 'AND';
    }

    return conditions;
  }

  private evalCondition(row: Row, cond: { col: string; op: string; val: any }): boolean {
    const v = row[cond.col];
    switch (cond.op) {
      case '=':
        return v == cond.val;
      case '!=':
        return v != cond.val;
      case '>':
        return v > cond.val;
      case '>=':
        return v >= cond.val;
      case '<':
        return v < cond.val;
      case '<=':
        return v <= cond.val;
      case 'IS NULL':
        return v === null || v === undefined;
      case 'IS NOT NULL':
        return v !== null && v !== undefined;
      case 'BETWEEN':
        return v >= cond.val[0] && v <= cond.val[1];
      case 'IN':
        return (cond.val as any[]).includes(v);
      case 'NOT IN':
        return !(cond.val as any[]).includes(v);
      case 'LIKE':
      case 'ILIKE': {
        const pattern = String(cond.val)
          .replace(/%/g, '.*')
          .replace(/_/g, '.');
        const flags = cond.op === 'ILIKE' ? 'i' : '';
        return new RegExp(`^${pattern}$`, flags).test(String(v ?? ''));
      }
      default:
        return true;
    }
  }
}