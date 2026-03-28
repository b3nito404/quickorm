import 'reflect-metadata';

export { DataSource, TransactionScope } from './core/DataSource';

export {
  Entity, Column, PrimaryColumn,
  CreatedAt, UpdatedAt, DeletedAt,
  OneToOne, ManyToOne, OneToMany, ManyToMany, JoinTable,
  BeforeInsert, AfterInsert, BeforeUpdate, AfterUpdate,
  BeforeDelete, AfterDelete, AfterLoad,
  Index, Unique,
} from './decorators';

export { QueryBuilder }               from './core/QueryBuilder';
export { SchemaBuilder }              from './core/SchemaBuilder';
export { SchemaDiff }                 from './core/SchemaDiff';
export { SchemaInspector }            from './core/SchemaInspector';
export { MetadataStorage, metadataStorage } from './core/MetadataStorage';
export { DataLoader }                 from './core/DataLoader';
export { RelationLoader }             from './core/RelationLoader';

export { Repository } from './repositories/Repository';

export { BaseModel } from './models/BaseModel';

export { Adapter, BaseAdapter }  from './adapters/Adapter';
export { MemoryAdapter }         from './adapters/MemoryAdapter';
export { PostgresAdapter }       from './adapters/PostgresAdapter';
export { MySQLAdapter }          from './adapters/MySQLAdapter';
export { SQLiteAdapter }         from './adapters/SQLiteAdapter';

export { Migration }       from './migrations/Migration';
export { MigrationRunner } from './migrations/MigrationRunner';

export {
  OrmError, ConnectionError, QueryError, ValidationError,
  EntityNotFoundError, MigrationError, MetadataError, TransactionError,
} from './errors/OrmError';

export type {
  DataSourceConfig, EntityOptions, ColumnOptions, PrimaryColumnOptions,
  RelationOptions, JoinTableOptions, IndexOptions, ColumnType,
  ColumnMetadata, EntityMetadata, RelationMetadata,
  FindOptions, FindOneOptions, DeepPartial, Constructor,
  MigrationInterface, QueryRunner, QueryResult, ColumnDefinition,
} from './types';

export type { DiffResult, DiffAction } from './core/SchemaDiff';
export type { LiveTable, LiveColumn }  from './core/SchemaInspector';
