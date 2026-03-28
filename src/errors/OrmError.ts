export class OrmError extends Error {
  public readonly code: string;
  public readonly cause?: Error;

  constructor(message: string, code: string, cause?: Error) {
    super(message);
    this.name = 'OrmError';
    this.code = code;
    this.cause = cause;
    Error.captureStackTrace(this, this.constructor);
  }

  toString(): string {
    return `[${this.name}:${this.code}] ${this.message}${
      this.cause ? `\n  Caused by: ${this.cause.message}` : ''
    }`;
  }
}

export class ConnectionError extends OrmError {
  constructor(message: string, cause?: Error) {
    super(message, 'CONNECTION_ERROR', cause);
    this.name = 'ConnectionError';
  }
}

export class QueryError extends OrmError {
  public readonly sql?: string;
  public readonly params?: any[];

  constructor(message: string, sql?: string, params?: any[], cause?: Error) {
    super(message, 'QUERY_ERROR', cause);
    this.name = 'QueryError';
    this.sql = sql;
    this.params = params;
  }

  toString(): string {
    return [
      super.toString(),
      this.sql ? `  SQL: ${this.sql}` : '',
      this.params?.length ? `  Params: ${JSON.stringify(this.params)}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }
}

export class ValidationError extends OrmError {
  public readonly field?: string;
  public readonly value?: any;

  constructor(message: string, field?: string, value?: any) {
    super(message, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
    this.field = field;
    this.value = value;
  }
}

export class EntityNotFoundError extends OrmError {
  public readonly entity: string;
  public readonly criteria: any;

  constructor(entity: string, criteria: any) {
    super(
      `Entity "${entity}" not found for criteria: ${JSON.stringify(criteria)}`,
      'ENTITY_NOT_FOUND'
    );
    this.name = 'EntityNotFoundError';
    this.entity = entity;
    this.criteria = criteria;
  }
}

export class MigrationError extends OrmError {
  public readonly migrationName?: string;

  constructor(message: string, migrationName?: string, cause?: Error) {
    super(message, 'MIGRATION_ERROR', cause);
    this.name = 'MigrationError';
    this.migrationName = migrationName;
  }
}

export class MetadataError extends OrmError {
  constructor(message: string) {
    super(message, 'METADATA_ERROR');
    this.name = 'MetadataError';
  }
}

export class TransactionError extends OrmError {
  constructor(message: string, cause?: Error) {
    super(message, 'TRANSACTION_ERROR', cause);
    this.name = 'TransactionError';
  }
}
