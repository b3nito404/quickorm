import { Adapter } from '../adapters/Adapter';
import { QueryBuilder } from '../core/QueryBuilder';
import { metadataStorage } from '../core/MetadataStorage';
import { RelationLoader } from '../core/RelationLoader';
import { EntityMetadata, ColumnMetadata, FindOptions, FindOneOptions, DeepPartial, Constructor } from '../types';
import { EntityNotFoundError, QueryError } from '../errors/OrmError';
import { generateUUID } from '../utils/uuid';
import { logger } from '../utils/logger';

/**
 * Generic repository providing full CRUD + a fluent query builder
 * for any @Entity-decorated class.
 *
 * @example
 * const repo = dataSource.getRepository(User);
 * const user = await repo.findOneBy({ email: 'a@b.com' });
 * await repo.save(user);
 *
 * // Load relations — zero N+1 (DataLoader batching):
 * const posts = await repo.find({ relations: ['author', 'tags'] });
 */
export class Repository<T extends object> {
  protected readonly meta: EntityMetadata;
  private readonly relationLoader: RelationLoader;

  constructor(
    protected readonly entity: Constructor<T>,
    protected readonly adapter: Adapter
  ) {
    this.meta           = metadataStorage.getEntityMetadata(entity);
    this.relationLoader = new RelationLoader(adapter);
  }

  /**
   * Get a fresh QueryBuilder scoped to this entity's table.
   *
   * @example
   * const users = await repo.createQueryBuilder()
   *   .where('age', '>', 18)
   *   .orderBy('name')
   *   .getMany<User>();
   */
  createQueryBuilder(alias?: string): QueryBuilder<T> {
    return new QueryBuilder<T>(this.adapter).from(this.meta.tableName, alias);
  }

  async find(options: FindOptions<T> = {}): Promise<T[]> {
    const qb = this.applyFindOptions(this.createQueryBuilder(), options);

    // Exclude sdeleted by default
    const deletedAt = this.deletedAtColumn();
    if (deletedAt && !options.withDeleted) {
      qb.whereNull(deletedAt.columnName);
    }

    const rows     = await qb.getMany();
    const entities = this.hydrateMany(rows);

    // Load relations if requested (N+1-free via DataLoader)
    if (options.relations?.length) {
      await this.relationLoader.loadRelations(entities, this.entity, options.relations as string[]);
    }

    return entities;
  }
  async findAll(): Promise<T[]> {
    return this.find();
  }

  async findBy(conditions: DeepPartial<T>): Promise<T[]> {
    return this.find({ where: conditions });
  }

  async findOne(options: FindOneOptions<T>): Promise<T | null> {
    const result = await this.find({ ...options, limit: 1 });
    return result[0] ?? null;
  }

  async findOneBy(conditions: DeepPartial<T>): Promise<T | null> {
    return this.findOne({ where: conditions });
  }

  async findById(id: any): Promise<T | null> {
    const pk = this.primaryColumn();
    return this.findOneBy({ [pk.propertyKey]: id } as any);
  }

  async findOneOrFail(options: FindOneOptions<T>): Promise<T> {
    const result = await this.findOne(options);
    if (!result) {
      throw new EntityNotFoundError(this.entity.name, options.where ?? {});
    }
    return result;
  }

  async findByIdOrFail(id: any): Promise<T> {
    const result = await this.findById(id);
    if (!result) {
      throw new EntityNotFoundError(this.entity.name, { id });
    }
    return result;
  }

  //agreg
  async count(conditions?: DeepPartial<T>): Promise<number> {
    const qb = this.createQueryBuilder().select('COUNT(*) as count');
    if (conditions) this.applyWhereConditions(qb, conditions);

    const deletedAt = this.deletedAtColumn();
    if (deletedAt) qb.whereNull(deletedAt.columnName);

    const result = await qb.execute();
    return Number((result.rows[0] as any)?.count ?? 0);
  }

  async exists(conditions: DeepPartial<T>): Promise<boolean> {
    return (await this.count(conditions)) > 0;
  }


  /**
   * Persist an entity.
   * - If it has no primary key -> INSERT.
   * - If it already has a primary key ->  UPDATE.
   */
  async save(entity: T): Promise<T> {
    const pk   = this.primaryColumn();
    const pkVal = (entity as any)[pk.propertyKey];

    if (pkVal === undefined || pkVal === null) {
      return this.insert(entity);
    }
    return this.update(entity);
  }

  async saveMany(entities: T[]): Promise<T[]> {
    return this.adapter.transaction(async () => {
      const results: T[] = [];
      for (const e of entities) {
        results.push(await this.save(e));
      }
      return results;
    });
  }

  async insert(entity: T): Promise<T> {
    // Run BeforeInsert hooks
    await this.runHooks(entity, 'BeforeInsert');

    const pk = this.primaryColumn();

    // pk
    if (pk.isGenerated && pk.generationStrategy === 'uuid') {
      if (!(entity as any)[pk.propertyKey]) {
        (entity as any)[pk.propertyKey] = generateUUID();
      }
    }

    // Ts
    const now = new Date();
    const createdAt = this.meta.columns.find((c) => c.isCreatedAt);
    const updatedAt = this.meta.columns.find((c) => c.isUpdatedAt);
    if (createdAt && !(entity as any)[createdAt.propertyKey]) {
      (entity as any)[createdAt.propertyKey] = now;
    }
    if (updatedAt) {
      (entity as any)[updatedAt.propertyKey] = now;
    }

    const row = this.toRow(entity);
    const qb  = new QueryBuilder(this.adapter)
      .from(this.meta.tableName)
      .insert(row);

    // For Postgres we can get the id back via RETURNING
    if (this.adapter.type === 'postgres') {
      qb.returning(pk.columnName);
    }

    const result = await qb.execute();

    // For auto-increment (MySQL/SQLite) —> fetch the inserted id from query result
    if (pk.isGenerated && pk.generationStrategy === 'increment') {
      const insertedId =
        (result.rows[0] as any)?.[pk.columnName] ??
        (result as any).insertId;
      if (insertedId !== undefined) {
        (entity as any)[pk.propertyKey] = insertedId;
      }
    }

    await this.runHooks(entity, 'AfterInsert');
    return entity;
  }

  async update(entity: T): Promise<T> {
    await this.runHooks(entity, 'BeforeUpdate');

    const pk    = this.primaryColumn();
    const pkVal = (entity as any)[pk.propertyKey];
    if (pkVal === undefined || pkVal === null) {
      throw new QueryError('Cannot UPDATE an entity without a primary key value');
    }

    const updatedAt = this.meta.columns.find((c) => c.isUpdatedAt);
    if (updatedAt) (entity as any)[updatedAt.propertyKey] = new Date();

    const row = this.toRow(entity);
    const { [pk.columnName]: _, ...updateData } = row;

    await new QueryBuilder(this.adapter)
      .from(this.meta.tableName)
      .update(updateData)
      .where(pk.columnName, '=', pkVal)
      .execute();

    await this.runHooks(entity, 'AfterUpdate');
    return entity;
  }

  async updateById(id: any, data: DeepPartial<T>): Promise<void> {
    const pk  = this.primaryColumn();
    const row = this.partialToRow(data);

    const updatedAt = this.meta.columns.find((c) => c.isUpdatedAt);
    if (updatedAt) row[updatedAt.columnName] = new Date();

    await new QueryBuilder(this.adapter)
      .from(this.meta.tableName)
      .update(row)
      .where(pk.columnName, '=', id)
      .execute();
  }


  /** Delete an entity (hard delete or delete if @DeletedAt is present). */
  async delete(entity: T): Promise<void> {
    await this.runHooks(entity, 'BeforeDelete');

    const pk    = this.primaryColumn();
    const pkVal = (entity as any)[pk.propertyKey];

    await this.deleteById(pkVal);
    await this.runHooks(entity, 'AfterDelete');
  }
//del by primary key 
  async deleteById(id: any): Promise<void> {
    const pk        = this.primaryColumn();
    const deletedAt = this.deletedAtColumn();

    if (deletedAt) {
      await new QueryBuilder(this.adapter)
        .from(this.meta.tableName)
        .update({ [deletedAt.columnName]: new Date() })
        .where(pk.columnName, '=', id)
        .execute();
    } else {
      await new QueryBuilder(this.adapter)
        .from(this.meta.tableName)
        .delete()
        .where(pk.columnName, '=', id)
        .execute();
    }
  }

  async hardDelete(entity: T): Promise<void> {
    const pk    = this.primaryColumn();
    const pkVal = (entity as any)[pk.propertyKey];

    await new QueryBuilder(this.adapter)
      .from(this.meta.tableName)
      .delete()
      .where(pk.columnName, '=', pkVal)
      .execute();
  }

  async restore(id: any): Promise<void> {
    const pk        = this.primaryColumn();
    const deletedAt = this.deletedAtColumn();
    if (!deletedAt) throw new QueryError('Entity does not have a @DeletedAt column');

    await new QueryBuilder(this.adapter)
      .from(this.meta.tableName)
      .update({ [deletedAt.columnName]: null })
      .where(pk.columnName, '=', id)
      .execute();
  }

  /** Delete all rows matching conditions. */
  async deleteBy(conditions: DeepPartial<T>): Promise<number> {
    const deletedAt = this.deletedAtColumn();
    const qb = new QueryBuilder(this.adapter).from(this.meta.tableName);
    this.applyWhereConditions(qb, conditions);

    if (deletedAt) {
      qb.update({ [deletedAt.columnName]: new Date() });
    } else {
      qb.delete();
    }

    const result = await qb.execute();
    return result.rowCount;
  }

  /**
   * Insert or update based on the conflict column.
   * Falls back to a find-then-save approach for broad adapter support.
   */
  async upsert(entity: T, conflictColumn: keyof T): Promise<T> {
    const conflictValue = (entity as any)[conflictColumn];
    const existing = await this.findOneBy({ [conflictColumn]: conflictValue } as any);
    if (existing) {
      const pk = this.primaryColumn();
      (entity as any)[pk.propertyKey] = (existing as any)[pk.propertyKey];
      return this.update(entity);
    }
    return this.insert(entity);
  }

 
  async query(sql: string, params?: any[]): Promise<T[]> {
    const result = await this.adapter.query<Record<string, any>>(sql, params);
    return this.hydrateMany(result.rows);
  }

  async paginate(
    page: number,
    perPage: number,
    options: FindOptions<T> = {}
  ): Promise<{ data: T[]; total: number; page: number; perPage: number; lastPage: number }> {
    const [data, total] = await Promise.all([
      this.find({ ...options, limit: perPage, offset: (page - 1) * perPage }),
      this.count(options.where as DeepPartial<T>),
    ]);
    return { data, total, page, perPage, lastPage: Math.ceil(total / perPage) };
  }


  protected primaryColumn(): ColumnMetadata {
    return metadataStorage.getPrimaryColumn(this.entity);
  }

  protected deletedAtColumn(): ColumnMetadata | undefined {
    return this.meta.columns.find((c) => c.isDeletedAt);
  }

  /** Convert entity instance -> plain row object (property -> column name) */
  protected toRow(entity: T): Record<string, any> {
    const row: Record<string, any> = {};
    for (const col of this.meta.columns) {
      let val = (entity as any)[col.propertyKey];
      if (col.options.transformer) val = col.options.transformer.to(val);
      row[col.columnName] = val;
    }
    return row;
  }

  protected partialToRow(data: DeepPartial<T>): Record<string, any> {
    const row: Record<string, any> = {};
    for (const [propKey, val] of Object.entries(data as any)) {
      const col = metadataStorage.getColumnByProperty(this.entity, propKey);
      if (col) {
        row[col.columnName] = col.options.transformer
          ? col.options.transformer.to(val)
          : val;
      }
    }
    return row;
  }

  protected hydrate(row: Record<string, any>): T {
    const instance = new this.entity();

    // Map column values
    for (const col of this.meta.columns) {
      let val = row[col.columnName];
      if (val === undefined) val = row[col.propertyKey];
      if (col.options.transformer && val !== undefined) {
        val = col.options.transformer.from(val);
      }
      (instance as any)[col.propertyKey] = val;
    }

    // Inject lazy relation getters
    for (const relation of this.meta.relations) {
      if (!relation.lazy) continue;
      const adapter  = this.adapter;
      const fkProp   = relation.foreignKey.replace(/_([a-z])/g, (_, l) => l.toUpperCase());
      const fkValue  = (instance as any)[fkProp] ?? (instance as any)[relation.foreignKey];
      const targetClass = relation.target();

      let targetMeta: any;
      try { targetMeta = metadataStorage.getEntityMetadata(targetClass); } catch { continue; }
      const targetPk   = metadataStorage.getPrimaryColumn(targetClass);

      if (relation.type === 'many-to-one' || relation.type === 'one-to-one') {
        let cached: any;
        let loaded = false;
        Object.defineProperty(instance, relation.propertyKey, {
          get(): Promise<any> {
            if (loaded) return Promise.resolve(cached);
            if (fkValue == null) { loaded = true; cached = null; return Promise.resolve(null); }
            return new QueryBuilder(adapter)
              .from(targetMeta.tableName)
              .where(targetPk.columnName, '=', fkValue)
              .getOne()
              .then((r: any) => { cached = r; loaded = true; return r; });
          },
          configurable: true,
          enumerable: true,
        });
      } else if (relation.type === 'one-to-many') {
        const ownerPkMeta = metadataStorage.getPrimaryColumn(this.entity);
        const ownerPkVal  = (instance as any)[ownerPkMeta.propertyKey];
        let cached: any;
        let loaded = false;
        Object.defineProperty(instance, relation.propertyKey, {
          get(): Promise<any[]> {
            if (loaded) return Promise.resolve(cached);
            return new QueryBuilder(adapter)
              .from(targetMeta.tableName)
              .where(relation.foreignKey, '=', ownerPkVal)
              .getMany()
              .then((r: any[]) => { cached = r; loaded = true; return r; });
          },
          configurable: true,
          enumerable: true,
        });
      }
    }

    return instance;
  }

  protected hydrateMany(rows: Record<string, any>[]): T[] {
    return rows.map((r) => this.hydrate(r));
  }

  private applyFindOptions(qb: QueryBuilder<T>, options: FindOptions<T>): QueryBuilder<T> {
    if (options.select?.length) {
      const cols = options.select.map((p) => {
        const col = metadataStorage.getColumnByProperty(this.entity, p as string);
        return col?.columnName ?? (p as string);
      });
      qb.select(...cols);
    }

    if (options.where) {
      this.applyWhereConditions(qb, options.where as DeepPartial<T>);
    }

    if (options.order) {
      for (const [prop, dir] of Object.entries(options.order)) {
        const col = metadataStorage.getColumnByProperty(this.entity, prop);
        qb.orderBy(col?.columnName ?? prop, dir as 'ASC' | 'DESC');
      }
    }

    if (options.limit  !== undefined) qb.limit(options.limit);
    if (options.offset !== undefined) qb.offset(options.offset);

    return qb;
  }

  private applyWhereConditions(qb: QueryBuilder<T>, conditions: DeepPartial<T>): void {
    for (const [propKey, val] of Object.entries(conditions as any)) {
      const col = metadataStorage.getColumnByProperty(this.entity, propKey);
      const colName = col?.columnName ?? propKey;
      if (val === null || val === undefined) {
        qb.whereNull(colName);
      } else {
        qb.andWhere(colName, '=', val);
      }
    }
  }

  private async runHooks(entity: T, hookType: string): Promise<void> {
    const hooks = this.meta.hooks.filter((h) => h.type === hookType);
    for (const hook of hooks) {
      await (entity as any)[hook.method]?.();
    }
  }
}