import { Adapter } from '../adapters/Adapter';
import { metadataStorage } from './MetadataStorage';
import { QueryBuilder } from './QueryBuilder';
import { DataLoader } from './DataLoader';
import { Constructor } from '../types';

/**
 * Loads relations for arrays of hydrated entities with automatic N+1 batching.
 * All FK lookups in the same tick are merged into a single IN(...) query.
 */
export class RelationLoader {
  private loaders = new Map<string, DataLoader<any, any>>();

  constructor(private readonly adapter: Adapter) {}

  async loadRelations<T extends object>(
    entities: T[],
    entityClass: Constructor<T>,
    relations: string[]
  ): Promise<void> {
    if (!entities.length || !relations.length) return;
    for (const rel of relations) {
      await this.loadRelation(entities, entityClass, rel);
    }
  }

  private async loadRelation<T extends object>(
    entities: T[],
    entityClass: Constructor<T>,
    relationName: string
  ): Promise<void> {
    const meta     = metadataStorage.getEntityMetadata(entityClass);
    const relation = meta.relations.find((r) => r.propertyKey === relationName);
    if (!relation) return;
    const targetClass = relation.target();
    switch (relation.type) {
      case 'many-to-one':
      case 'one-to-one':
        await this.loadManyToOne(entities, relation.foreignKey, relationName, targetClass);
        break;
      case 'one-to-many':
        await this.loadOneToMany(entities, entityClass, relation.foreignKey, relationName, targetClass);
        break;
      case 'many-to-many':
        await this.loadManyToMany(entities, entityClass, relation, relationName, targetClass);
        break;
    }
  }

  private async loadManyToOne<T extends object>(
    entities: T[],
    foreignKey: string,
    propertyKey: string,
    targetClass: Constructor<any>
  ): Promise<void> {
    const targetMeta = metadataStorage.getEntityMetadata(targetClass);
    const targetPk   = metadataStorage.getPrimaryColumn(targetClass);
    const loaderKey  = `mto:${targetMeta.tableName}`;

    const loader = this.getOrCreateLoader(loaderKey, async (ids: any[]) => {
      const rows = await new QueryBuilder(this.adapter)
        .from(targetMeta.tableName)
        .whereIn(targetPk.columnName, ids)
        .getMany<Record<string, any>>();
      const map = new Map<any, any>();
      for (const row of rows) {
        map.set(row[targetPk.columnName], this.hydrate(row, targetClass));
      }
      return map;
    });

    const fkProp = this.resolveFkProperty(entities[0], foreignKey);
    await Promise.all(entities.map(async (entity) => {
      const fkValue = (entity as any)[fkProp];
      (entity as any)[propertyKey] = fkValue != null ? await loader.load(fkValue) : null;
    }));
  }

  // one-to-many: batch all parent PKs -> one IN query

  private async loadOneToMany<T extends object>(
    entities: T[],
    entityClass: Constructor<T>,
    foreignKey: string,
    propertyKey: string,
    targetClass: Constructor<any>
  ): Promise<void> {
    const ownerPk    = metadataStorage.getPrimaryColumn(entityClass);
    const targetMeta = metadataStorage.getEntityMetadata(targetClass);
    const loaderKey  = `otm:${targetMeta.tableName}:${foreignKey}`;

    const loader = this.getOrCreateLoader<any, any[]>(loaderKey, async (parentIds: any[]) => {
      const rows = await new QueryBuilder(this.adapter)
        .from(targetMeta.tableName)
        .whereIn(foreignKey, parentIds)
        .getMany<Record<string, any>>();
      const map = new Map<any, any[]>();
      for (const row of rows) {
        const fk = row[foreignKey];
        if (!map.has(fk)) map.set(fk, []);
        map.get(fk)!.push(this.hydrate(row, targetClass));
      }
      return map;
    });

    await Promise.all(entities.map(async (entity) => {
      const pkVal = (entity as any)[ownerPk.propertyKey];
      (entity as any)[propertyKey] = (await loader.load(pkVal)) ?? [];
    }));
  }

  //many-to-many: two simple IN queries (no JOIN —> works on all adapters)
  // Query 1: join table -> get all (ownerId, targetId) pairs for these owners
  // Query 2: target table -> fetch all targets in one IN(...)
  // Total: always 2 queries regardless of how many entities we're loading.

  private async loadManyToMany<T extends object>(
    entities: T[],
    entityClass: Constructor<T>,
    relation: any,
    propertyKey: string,
    targetClass: Constructor<any>
  ): Promise<void> {
    const ownerMeta  = metadataStorage.getEntityMetadata(entityClass);
    const targetMeta = metadataStorage.getEntityMetadata(targetClass);
    const ownerPk    = metadataStorage.getPrimaryColumn(entityClass);
    const targetPk   = metadataStorage.getPrimaryColumn(targetClass);

    const joinTable      = relation.joinTable?.name ?? `${ownerMeta.tableName}_${targetMeta.tableName}`;
    const joinCol        = relation.joinTable?.joinColumn ?? `${ownerMeta.tableName.replace(/s$/, '')}_id`;
    const inverseJoinCol = relation.joinTable?.inverseJoinColumn ?? `${targetMeta.tableName.replace(/s$/, '')}_id`;

    const q        = (s: string) => this.adapter.quoteIdentifier(s);
    const ownerIds = entities.map((e) => (e as any)[ownerPk.propertyKey]).filter(Boolean);
    if (!ownerIds.length) { entities.forEach((e) => ((e as any)[propertyKey] = [])); return; }

    // Query 1: fetch all join-table rows for these owner IDs
    const ph1  = ownerIds.map((_, i) => this.adapter.getPlaceholder(i + 1));
    const sql1 = `SELECT ${q(joinCol)}, ${q(inverseJoinCol)} FROM ${q(joinTable)} WHERE ${q(joinCol)} IN (${ph1.join(', ')})`;
    const joinRows = (await this.adapter.query<Record<string, any>>(sql1, ownerIds)).rows;

    if (!joinRows.length) {
      entities.forEach((e) => ((e as any)[propertyKey] = []));
      return;
    }

  
    const targetIds = [...new Set(joinRows.map((r) => r[inverseJoinCol]))];

    // Query 2: fetch target entities in one IN(...)
    const ph2  = targetIds.map((_, i) => this.adapter.getPlaceholder(i + 1));
    const sql2 = `SELECT * FROM ${q(targetMeta.tableName)} WHERE ${q(targetPk.columnName)} IN (${ph2.join(', ')})`;
    const targetRows = (await this.adapter.query<Record<string, any>>(sql2, targetIds)).rows;

    // Build a map: targetId -> hydrated entity
    const targetMap = new Map<any, any>();
    for (const row of targetRows) {
      targetMap.set(row[targetPk.columnName], this.hydrate(row, targetClass));
    }

    // Build a map: ownerId -> [target entities]
    const ownerMap = new Map<any, any[]>();
    for (const jrow of joinRows) {
      const ownerId  = jrow[joinCol];
      const targetId = jrow[inverseJoinCol];
      if (!ownerMap.has(ownerId)) ownerMap.set(ownerId, []);
      const target = targetMap.get(targetId);
      if (target) ownerMap.get(ownerId)!.push(target);
    }

    entities.forEach((e) => {
      (e as any)[propertyKey] = ownerMap.get((e as any)[ownerPk.propertyKey]) ?? [];
    });
  }

  private getOrCreateLoader<K extends string | number, V>(
    key: string,
    batchFn: (keys: K[]) => Promise<Map<K, V>>
  ): DataLoader<K, V> {
    if (!this.loaders.has(key)) {
      this.loaders.set(key, new DataLoader<K, V>(batchFn));
    }
    return this.loaders.get(key)!;
  }

  private hydrate<T extends object>(row: Record<string, any>, targetClass: Constructor<T>): T {
    const instance = new targetClass();
    const meta     = metadataStorage.getEntityMetadata(targetClass);
    for (const col of meta.columns) {
      let val = row[col.columnName] ?? row[col.propertyKey];
      if (col.options.transformer && val !== undefined) val = col.options.transformer.from(val);
      (instance as any)[col.propertyKey] = val;
    }
    return instance;
  }

  private resolveFkProperty(entity: object, foreignKey: string): string {
    const camel = foreignKey.replace(/_([a-z])/g, (_, l) => l.toUpperCase());
    return camel in entity ? camel : foreignKey;
  }
}
