//Column Types
export type ColumnType =
  | 'varchar'
  | 'text'
  | 'char'
  | 'int'
  | 'bigint'
  | 'smallint'
  | 'tinyint'
  | 'float'
  | 'double'
  | 'decimal'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'timestamp'
  | 'time'
  | 'json'
  | 'jsonb'
  | 'uuid'
  | 'blob'
  | 'enum';

export interface EntityOptions {
  /** Table name in the database. Defaults to the class name (snake_cased). */
  name?: string;
  schema?: string;
  comment?: string;
}

export interface ColumnOptions {
  /** Column type. Inferred from TypeScript type when omitted. */
  type?: ColumnType;
  /** Column name in the database. Defaults to the property name. */
  name?: string;
  length?: number;
  nullable?: boolean;
  unique?: boolean;
  default?: any;
  precision?: number;
  scale?: number;
  comment?: string;
  enum?: any[];
  transformer?: {
    to(value: any): any;
    from(value: any): any;
  };
}

export interface PrimaryColumnOptions extends Omit<ColumnOptions, 'nullable' | 'unique'> {
  generated?: 'uuid' | 'increment' | false;
}

export interface IndexOptions {
  name?: string;
  unique?: boolean;
}

export interface RelationOptions {
  /** Lazy resolver for the target entity class (avoids circular deps). */
  target: () => new (...args: any[]) => any;
  /** Name of the foreign key column. */
  foreignKey?: string;
  /** Load the relation automatically in every query. */
  eager?: boolean;
  /** Propagate insert/update/delete to related entities. */
  cascade?: boolean | Array<'insert' | 'update' | 'delete'>;
  nullable?: boolean;
  onDelete?: 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION';
  onUpdate?: 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION';
  inverseSide?: string;
}

export interface JoinTableOptions {
  name?: string;
  joinColumn?: string;
  inverseJoinColumn?: string;
}

export interface ColumnMetadata {
  propertyKey: string;
  columnName: string;
  type: ColumnType;
  options: ColumnOptions;
  isPrimary: boolean;
  isGenerated: boolean;
  generationStrategy?: 'uuid' | 'increment';
  isCreatedAt: boolean;
  isUpdatedAt: boolean;
  isDeletedAt: boolean;
}

export type RelationType = 'one-to-one' | 'one-to-many' | 'many-to-one' | 'many-to-many';

export interface RelationMetadata {
  propertyKey: string;
  type: RelationType;
  target: () => new (...args: any[]) => any;
  foreignKey: string;
  eager: boolean;
  cascade: boolean | string[];
  nullable: boolean;
  onDelete: string;
  onUpdate: string;
  joinTable?: JoinTableOptions;
  inverseSide?: string;
}

export interface IndexMetadata {
  columns: string[];
  unique: boolean;
  name?: string;
}

export type HookType =
  | 'BeforeInsert'
  | 'AfterInsert'
  | 'BeforeUpdate'
  | 'AfterUpdate'
  | 'BeforeDelete'
  | 'AfterDelete'
  | 'AfterLoad';

export interface HookMetadata {
  type: HookType;
  method: string;
}

export interface EntityMetadata {
  target: Function;
  tableName: string;
  schema?: string;
  columns: ColumnMetadata[];
  relations: RelationMetadata[];
  hooks: HookMetadata[];
  indices: IndexMetadata[];
  comment?: string;
}

export type QueryOperator =
  | '='
  | '!='
  | '>'
  | '>='
  | '<'
  | '<='
  | 'LIKE'
  | 'ILIKE'
  | 'IN'
  | 'NOT IN'
  | 'IS NULL'
  | 'IS NOT NULL'
  | 'BETWEEN';

export interface WhereClause {
  field: string;
  operator: QueryOperator;
  value?: any;
  connector: 'AND' | 'OR';
}

export interface OrderByClause {
  field: string;
  direction: 'ASC' | 'DESC';
}

export interface JoinClause {
  type: 'INNER' | 'LEFT' | 'RIGHT' | 'FULL';
  table: string;
  alias: string;
  condition: string;
}

export interface FindOptions<T = any> {
  where?: DeepPartial<T> | WhereClause[];
  relations?: (keyof T & string)[];
  order?: Partial<Record<keyof T, 'ASC' | 'DESC'>>;
  limit?: number;
  offset?: number;
  select?: (keyof T)[];
  withDeleted?: boolean;
}

export interface FindOneOptions<T = any> extends Omit<FindOptions<T>, 'limit' | 'offset'> {}
export type AdapterType = 'memory' | 'postgres' | 'mysql' | 'sqlite';

export interface DataSourceConfig {
  type: AdapterType;
  /** Postgres / MySQL */
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  database?: string;
  /** SQLite */
  filename?: string;
  synchronize?: boolean;
  logging?: boolean;
  poolSize?: number;
  ssl?: boolean;
  migrations?: Array<string | (new () => MigrationInterface)>;
  entities?: Function[];
  /** Run migrations automatically on connect */
  migrationsRun?: boolean;
}

export interface QueryResult<T = any> {
  rows: T[];
  rowCount: number;
}
export interface MigrationInterface {
  name: string;
  up(runner: QueryRunner): Promise<void>;
  down(runner: QueryRunner): Promise<void>;
}

export interface QueryRunner {
  query(sql: string, params?: any[]): Promise<QueryResult>;
  createTable(tableName: string, columns: ColumnDefinition[]): Promise<void>;
  dropTable(tableName: string): Promise<void>;
  addColumn(tableName: string, column: ColumnDefinition): Promise<void>;
  dropColumn(tableName: string, columnName: string): Promise<void>;
  createIndex(tableName: string, columns: string[], unique?: boolean, name?: string): Promise<void>;
  dropIndex(name: string): Promise<void>;
}

export interface ColumnDefinition {
  name: string;
  type: ColumnType;
  length?: number;
  nullable?: boolean;
  unique?: boolean;
  primary?: boolean;
  default?: any;
  precision?: number;
  scale?: number;
  autoIncrement?: boolean;
  enum?: any[];
}

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export type Primitive = string | number | boolean | null | undefined;

export interface Constructor<T = any> {
  new (...args: any[]): T;
}
