import 'reflect-metadata';
import {
  EntityMetadata,
  ColumnMetadata,
  RelationMetadata,
  HookMetadata,
  IndexMetadata,
  HookType,
  ColumnOptions,
  PrimaryColumnOptions,
  RelationOptions,
  RelationType,
  JoinTableOptions,
  IndexOptions,
} from '../types';
import { MetadataError } from '../errors/OrmError';
import { defaultTableName } from '../utils/string';

// Reflect metadata keys
const METADATA_KEY = {
  ENTITY:   'quickorm:entity',
  COLUMNS:  'quickorm:columns',
  RELATIONS:'quickorm:relations',
  HOOKS:    'quickorm:hooks',
  INDICES:  'quickorm:indices',
};

/**
 * Global singleton that stores all entity/column/relation metadata
 * registered by decorators at class-definition time.
 */
export class MetadataStorage {
  private static instance: MetadataStorage;
  private entities: Map<Function, EntityMetadata> = new Map();

  private constructor() {}

  static getInstance(): MetadataStorage {
    if (!MetadataStorage.instance) {
      MetadataStorage.instance = new MetadataStorage();
    }
    return MetadataStorage.instance;
  }

  registerEntity(target: Function, tableName: string, schema?: string, comment?: string): void {
    const existing = this.entities.get(target);
    if (existing) {
      existing.tableName = tableName;
      existing.schema = schema;
      existing.comment = comment;
    } else {
      this.entities.set(target, {
        target,
        tableName,
        schema,
        comment,
        columns:   this.getColumnsFromPrototype(target) ?? [],
        relations: this.getRelationsFromPrototype(target) ?? [],
        hooks:     this.getHooksFromPrototype(target) ?? [],
        indices:   this.getIndicesFromPrototype(target) ?? [],
      });
    }
  }

  registerColumn(
    target: Function,
    propertyKey: string,
    columnMeta: Omit<ColumnMetadata, 'columnName'> & { columnName?: string }
  ): void {
    const columns: ColumnMetadata[] = Reflect.getMetadata(METADATA_KEY.COLUMNS, target) ?? [];
    const resolved: ColumnMetadata = {
      ...columnMeta,
      columnName: columnMeta.columnName ?? columnMeta.propertyKey,
    } as ColumnMetadata;

    const existing = columns.findIndex((c) => c.propertyKey === propertyKey);
    if (existing >= 0) {
      columns[existing] = resolved;
    } else {
      columns.push(resolved);
    }

    Reflect.defineMetadata(METADATA_KEY.COLUMNS, columns, target);
  }

  registerRelation(target: Function, relation: RelationMetadata): void {
    const relations: RelationMetadata[] = Reflect.getMetadata(METADATA_KEY.RELATIONS, target) ?? [];
    const existing = relations.findIndex((r) => r.propertyKey === relation.propertyKey);
    if (existing >= 0) {
      relations[existing] = relation;
    } else {
      relations.push(relation);
    }
    Reflect.defineMetadata(METADATA_KEY.RELATIONS, relations, target);

    // Also sync into the already-finalized entity metadata cache (for imperative decorators)
    if (this.entities.has(target)) {
      const meta = this.entities.get(target)!;
      const cachedIdx = meta.relations.findIndex((r) => r.propertyKey === relation.propertyKey);
      if (cachedIdx >= 0) {
        meta.relations[cachedIdx] = relation;
      } else {
        meta.relations.push(relation);
      }
    }
  }


  registerHook(target: Function, type: HookType, method: string): void {
    const hooks: HookMetadata[] = Reflect.getMetadata(METADATA_KEY.HOOKS, target) ?? [];
    hooks.push({ type, method });
    Reflect.defineMetadata(METADATA_KEY.HOOKS, hooks, target);
  }


  registerIndex(target: Function, columns: string[], options: IndexOptions = {}): void {
    const indices: IndexMetadata[] = Reflect.getMetadata(METADATA_KEY.INDICES, target) ?? [];
    indices.push({ columns, unique: options.unique ?? false, name: options.name });
    Reflect.defineMetadata(METADATA_KEY.INDICES, indices, target);
  }

  getEntityMetadata(target: Function): EntityMetadata {
   //find the right metadata
    let proto: Function | null = target;
    while (proto && proto !== Function.prototype) {
      if (this.entities.has(proto)) {
        return this.entities.get(proto)!;
      }
      proto = Object.getPrototypeOf(proto) as Function | null;
    }
    throw new MetadataError(
      `No entity metadata found for "${target.name}". Did you forget @Entity()?`
    );
  }

  hasEntityMetadata(target: Function): boolean {
    try {
      this.getEntityMetadata(target);
      return true;
    } catch {
      return false;
    }
  }

  getAllEntities(): EntityMetadata[] {
    return Array.from(this.entities.values());
  }

  getPrimaryColumn(target: Function): ColumnMetadata {
    const meta = this.getEntityMetadata(target);
    const pk = meta.columns.find((c) => c.isPrimary);
    if (!pk) {
      throw new MetadataError(`Entity "${target.name}" has no primary column.`);
    }
    return pk;
  }

  getColumnByProperty(target: Function, propertyKey: string): ColumnMetadata | undefined {
    return this.getEntityMetadata(target).columns.find((c) => c.propertyKey === propertyKey);
  }

  getColumnByName(target: Function, columnName: string): ColumnMetadata | undefined {
    return this.getEntityMetadata(target).columns.find((c) => c.columnName === columnName);
  }

  getRelation(target: Function, propertyKey: string): RelationMetadata | undefined {
    return this.getEntityMetadata(target).relations.find((r) => r.propertyKey === propertyKey);
  }

  private getColumnsFromPrototype(target: Function): ColumnMetadata[] {
    return Reflect.getMetadata(METADATA_KEY.COLUMNS, target) ?? [];
  }

  private getRelationsFromPrototype(target: Function): RelationMetadata[] {
    return Reflect.getMetadata(METADATA_KEY.RELATIONS, target) ?? [];
  }

  private getHooksFromPrototype(target: Function): HookMetadata[] {
    return Reflect.getMetadata(METADATA_KEY.HOOKS, target) ?? [];
  }

  private getIndicesFromPrototype(target: Function): IndexMetadata[] {
    return Reflect.getMetadata(METADATA_KEY.INDICES, target) ?? [];
  }

  /** Called by @Entity to finalize metadata (columns may be registered before entity) */
  finalizeEntity(target: Function): void {
    const meta = this.entities.get(target);
    if (!meta) return;

    // Merge prototype-registered columns/relations/hooks/indices
    const columns   = this.getColumnsFromPrototype(target);
    const relations = this.getRelationsFromPrototype(target);
    const hooks     = this.getHooksFromPrototype(target);
    const indices   = this.getIndicesFromPrototype(target);

    // Merge prototype data takes precedence over previously stored
    meta.columns   = columns.length   ? columns   : meta.columns;
    meta.relations = relations.length ? relations : meta.relations;
    meta.hooks     = hooks.length     ? hooks     : meta.hooks;
    meta.indices   = indices.length   ? indices   : meta.indices;
  }

  clear(): void {
    this.entities.clear();
  }
}

export const metadataStorage = MetadataStorage.getInstance();
