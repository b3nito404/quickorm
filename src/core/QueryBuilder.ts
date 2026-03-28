import { WhereClause, OrderByClause, JoinClause, QueryOperator, QueryResult } from '../types';
import { Adapter } from '../adapters/Adapter';
import { QueryError } from '../errors/OrmError';

export type QueryType = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'COUNT';

/**
 * adapter-agnostic SQL query builder.
 *
 * Works with any adapter via the getPlaceholder() contract, so the same
 * builder code runs against PostgreSQL ($1), MySQL (?), and SQLite (?).
 *
 * @example
 * const users = await new QueryBuilder(adapter)
 *   .from('users')
 *   .where('age', '>', 18)
 *   .andWhere('active', '=', true)
 *   .orderBy('name', 'ASC')
 *   .limit(20)
 *   .getMany<User>();
 */
export class QueryBuilder<T = any> {
  private queryType: QueryType = 'SELECT';
  private tableName: string = '';
  private tableAlias: string = '';
  private selectColumns: string[] = ['*'];
  private whereClauses: WhereClause[] = [];
  private orderByClauses: OrderByClause[] = [];
  private joinClauses: JoinClause[] = [];
  private limitValue: number | undefined;
  private offsetValue: number | undefined;
  private setValues: Record<string, any> = {};
  private insertValues: Record<string, any>[] = [];
  private returningColumns: string[] = [];
  private groupByColumns: string[] = [];
  private havingClauses: WhereClause[] = [];
  private parameters: any[] = [];
  private distinctFlag: boolean = false;
  private lockMode: 'FOR UPDATE' | 'FOR SHARE' | undefined;

  constructor(private readonly adapter: Adapter) {}

  //alias tab

  from(table: string, alias?: string): this {
    this.tableName  = table;
    this.tableAlias = alias ?? '';
    return this;
  }


  select(...columns: string[]): this {
    this.selectColumns = columns.length ? columns : ['*'];
    return this;
  }

  addSelect(...columns: string[]): this {
    this.selectColumns.push(...columns);
    return this;
  }

  distinct(): this {
    this.distinctFlag = true;
    return this;
  }

  where(field: string, operator: QueryOperator, value?: any): this {
    this.whereClauses = [{ field, operator, value, connector: 'AND' }];
    return this;
  }

  andWhere(field: string, operator: QueryOperator, value?: any): this {
    this.whereClauses.push({ field, operator, value, connector: 'AND' });
    return this;
  }

  orWhere(field: string, operator: QueryOperator, value?: any): this {
    this.whereClauses.push({ field, operator, value, connector: 'OR' });
    return this;
  }

  whereIn(field: string, values: any[]): this {
    return this.andWhere(field, 'IN', values);
  }

  whereNotIn(field: string, values: any[]): this {
    return this.andWhere(field, 'NOT IN', values);
  }

  whereNull(field: string): this {
    return this.andWhere(field, 'IS NULL');
  }

  whereNotNull(field: string): this {
    return this.andWhere(field, 'IS NOT NULL');
  }

  whereBetween(field: string, min: any, max: any): this {
    return this.andWhere(field, 'BETWEEN', [min, max]);
  }

  whereLike(field: string, pattern: string): this {
    return this.andWhere(field, 'LIKE', pattern);
  }

  whereEqual(conditions: Record<string, any>): this {
    for (const [field, value] of Object.entries(conditions)) {
      if (value === null || value === undefined) {
        this.andWhere(field, 'IS NULL');
      } else {
        this.andWhere(field, '=', value);
      }
    }
    return this;
  }

  orderBy(field: string, direction: 'ASC' | 'DESC' = 'ASC'): this {
    this.orderByClauses.push({ field, direction });
    return this;
  }

  groupBy(...columns: string[]): this {
    this.groupByColumns.push(...columns);
    return this;
  }

  having(field: string, operator: QueryOperator, value?: any): this {
    this.havingClauses.push({ field, operator, value, connector: 'AND' });
    return this;
  }
  limit(n: number): this {
    this.limitValue = n;
    return this;
  }

  offset(n: number): this {
    this.offsetValue = n;
    return this;
  }

  paginate(page: number, perPage: number): this {
    return this.limit(perPage).offset((page - 1) * perPage);
  }
  join(type: JoinClause['type'], table: string, alias: string, condition: string): this {
    this.joinClauses.push({ type, table, alias, condition });
    return this;
  }

  innerJoin(table: string, alias: string, condition: string): this {
    return this.join('INNER', table, alias, condition);
  }

  leftJoin(table: string, alias: string, condition: string): this {
    return this.join('LEFT', table, alias, condition);
  }

  rightJoin(table: string, alias: string, condition: string): this {
    return this.join('RIGHT', table, alias, condition);
  }

  forUpdate(): this {
    this.lockMode = 'FOR UPDATE';
    return this;
  }

  forShare(): this {
    this.lockMode = 'FOR SHARE';
    return this;
  }

  insert(values: Record<string, any> | Record<string, any>[]): this {
    this.queryType    = 'INSERT';
    this.insertValues = Array.isArray(values) ? values : [values];
    return this;
  }

  update(values: Record<string, any>): this {
    this.queryType = 'UPDATE';
    this.setValues = values;
    return this;
  }

  delete(): this {
    this.queryType = 'DELETE';
    return this;
  }

  returning(...columns: string[]): this {
    this.returningColumns = columns;
    return this;
  }

  //SQL Compilation

  build(): { sql: string; params: any[] } {
    this.parameters = [];
    switch (this.queryType) {
      case 'SELECT': return { sql: this.buildSelect(), params: this.parameters };
      case 'INSERT': return { sql: this.buildInsert(), params: this.parameters };
      case 'UPDATE': return { sql: this.buildUpdate(), params: this.parameters };
      case 'DELETE': return { sql: this.buildDelete(), params: this.parameters };
      default:       throw new QueryError(`Unknown query type: ${this.queryType}`);
    }
  }

  private q(id: string): string {
    return this.adapter.quoteIdentifier(id);
  }

  /** Quote a SELECT column —> skip if it looks like a raw expression */
  private quoteCol(col: string): string {
    if (col === '*') return '*';
    // Raw expression: contains (, ), *, space, or AS keyword -> don't quote
    if (/[()*\s]/.test(col) || /\bAS\b/i.test(col)) return col;
    // Qualified identifier: table.column -> quote each part
    if (col.includes('.')) {
      return col.split('.').map((p) => this.q(p)).join('.');
    }
    return this.q(col);
  }

  private placeholder(): string {
    return this.adapter.getPlaceholder(this.parameters.length);
  }

  private buildSelect(): string {
    const distinct = this.distinctFlag ? 'DISTINCT ' : '';
    const cols     = this.selectColumns.map((c) => this.quoteCol(c)).join(', ');
    const alias    = this.tableAlias ? ` ${this.tableAlias}` : '';
    let   sql      = `SELECT ${distinct}${cols} FROM ${this.q(this.tableName)}${alias}`;

    sql += this.buildJoins();
    sql += this.buildWhere(this.whereClauses);
    sql += this.buildGroupBy();
    sql += this.buildHaving();
    sql += this.buildOrderBy();
    if (this.limitValue  !== undefined) sql += ` LIMIT ${this.limitValue}`;
    if (this.offsetValue !== undefined) sql += ` OFFSET ${this.offsetValue}`;
    if (this.lockMode)                  sql += ` ${this.lockMode}`;

    return sql;
  }

  private buildInsert(): string {
    if (!this.insertValues.length) throw new QueryError('INSERT requires at least one row');

    const columns = Object.keys(this.insertValues[0]);
    const cols    = columns.map((c) => this.q(c)).join(', ');

    const valueRows = this.insertValues.map((row) => {
      const placeholders = columns.map((col) => {
        this.parameters.push(row[col]);
        return this.placeholder();
      });
      return `(${placeholders.join(', ')})`;
    });

    let sql = `INSERT INTO ${this.q(this.tableName)} (${cols}) VALUES ${valueRows.join(', ')}`;

    if (this.returningColumns.length) {
      sql += ` RETURNING ${this.returningColumns.map((c) => this.q(c)).join(', ')}`;
    }

    return sql;
  }

  private buildUpdate(): string {
    const entries = Object.entries(this.setValues);
    if (!entries.length) throw new QueryError('UPDATE requires at least one SET value');

    const setClauses = entries.map(([col, val]) => {
      this.parameters.push(val);
      return `${this.q(col)} = ${this.placeholder()}`;
    });

    let sql = `UPDATE ${this.q(this.tableName)} SET ${setClauses.join(', ')}`;
    sql += this.buildWhere(this.whereClauses);

    if (this.returningColumns.length) {
      sql += ` RETURNING ${this.returningColumns.map((c) => this.q(c)).join(', ')}`;
    }

    return sql;
  }

  private buildDelete(): string {
    let sql = `DELETE FROM ${this.q(this.tableName)}`;
    sql += this.buildWhere(this.whereClauses);
    return sql;
  }

  private buildWhere(clauses: WhereClause[]): string {
    if (!clauses.length) return '';

    const parts = clauses.map((clause, i) => {
      const prefix = i === 0 ? '' : ` ${clause.connector} `;
      return prefix + this.buildWhereClause(clause);
    });

    return ` WHERE ${parts.join('')}`;
  }

  private buildWhereClause(clause: WhereClause): string {
    const col = clause.field.includes('.')
      ? clause.field  // already qualified 
      : this.q(clause.field);

    switch (clause.operator) {
      case 'IS NULL':
        return `${col} IS NULL`;
      case 'IS NOT NULL':
        return `${col} IS NOT NULL`;
      case 'BETWEEN': {
        const [min, max] = clause.value as [any, any];
        this.parameters.push(min);
        const p1 = this.placeholder();
        this.parameters.push(max);
        const p2 = this.placeholder();
        return `${col} BETWEEN ${p1} AND ${p2}`;
      }
      case 'IN':
      case 'NOT IN': {
        const values = clause.value as any[];
        const placeholders = values.map((v) => {
          this.parameters.push(v);
          return this.placeholder();
        });
        return `${col} ${clause.operator} (${placeholders.join(', ')})`;
      }
      default: {
        this.parameters.push(clause.value);
        return `${col} ${clause.operator} ${this.placeholder()}`;
      }
    }
  }

  private buildJoins(): string {
    return this.joinClauses
      .map((j) => ` ${j.type} JOIN ${this.q(j.table)} ${j.alias} ON ${j.condition}`)
      .join('');
  }

  private buildOrderBy(): string {
    if (!this.orderByClauses.length) return '';
    return (
      ' ORDER BY ' +
      this.orderByClauses.map((o) => `${this.q(o.field)} ${o.direction}`).join(', ')
    );
  }

  private buildGroupBy(): string {
    if (!this.groupByColumns.length) return '';
    return ' GROUP BY ' + this.groupByColumns.map((c) => this.q(c)).join(', ');
  }

  private buildHaving(): string {
    if (!this.havingClauses.length) return '';
    const parts = this.havingClauses.map((c, i) => {
      const prefix = i === 0 ? '' : ` ${c.connector} `;
      return prefix + this.buildWhereClause(c);
    });
    return ` HAVING ${parts.join('')}`;
  }

  //exec

  async execute<R = T>(): Promise<QueryResult<R>> {
    const { sql, params } = this.build();
    return this.adapter.query<R>(sql, params);
  }

  async getMany<R = T>(): Promise<R[]> {
    const result = await this.execute<R>();
    return result.rows;
  }

  async getOne<R = T>(): Promise<R | null> {
    this.limit(1);
    const result = await this.execute<R>();
    return result.rows[0] ?? null;
  }

  async getCount(): Promise<number> {
    const original = this.selectColumns;
    this.selectColumns = ['COUNT(*) as count'];
    const result = await this.execute();
    this.selectColumns = original;
    return Number((result.rows[0] as any)?.count ?? 0);
  }

  async exists(): Promise<boolean> {
    return (await this.getCount()) > 0;
  }

  /** Clone this builder (it will be useful for sub-queries) */
  clone(): QueryBuilder<T> {
    const qb = new QueryBuilder<T>(this.adapter);
    Object.assign(qb, JSON.parse(JSON.stringify({
      queryType:      this.queryType,
      tableName:      this.tableName,
      tableAlias:     this.tableAlias,
      selectColumns:  this.selectColumns,
      whereClauses:   this.whereClauses,
      orderByClauses: this.orderByClauses,
      joinClauses:    this.joinClauses,
      limitValue:     this.limitValue,
      offsetValue:    this.offsetValue,
      setValues:      this.setValues,
      insertValues:   this.insertValues,
      returningColumns: this.returningColumns,
      groupByColumns: this.groupByColumns,
      havingClauses:  this.havingClauses,
      distinctFlag:   this.distinctFlag,
    })));
    return qb;
  }
}
