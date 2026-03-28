import 'reflect-metadata';
import {
  EntityOptions,
  ColumnOptions,
  ColumnType,
  PrimaryColumnOptions,
  RelationOptions,
  JoinTableOptions,
  IndexOptions,
  HookType,
  ColumnMetadata,
  RelationMetadata,
} from '../types';
import { metadataStorage } from '../core/MetadataStorage';
import { defaultTableName, toSnakeCase } from '../utils/string';
import { generateUUID } from '../utils/uuid';


/**
 * Marks a class as a database entity.
 *
 * @example
 * @Entity('users')
 * class User extends BaseModel { ... }
 */
export function Entity(options?: EntityOptions | string): ClassDecorator {
  return (target: Function) => {
    const tableName =
      typeof options === 'string'
        ? options
        : options?.name ?? defaultTableName(target.name);

    const schema  = typeof options === 'object' ? options.schema   : undefined;
    const comment = typeof options === 'object' ? options.comment  : undefined;

    metadataStorage.registerEntity(target, tableName, schema, comment);
    metadataStorage.finalizeEntity(target);
  };
}


/**
 * Marks a class property as a database column.
 *
 * @example
 * @Column({ type: 'varchar', length: 255, nullable: false })
 * name: string;
 */
export function Column(options: ColumnOptions = {}): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    const key = propertyKey.toString();
    const reflectedType = Reflect.getMetadata('design:type', target, propertyKey);
    const type = options.type ?? inferColumnType(reflectedType);

    metadataStorage.registerColumn(target.constructor, key, {
      propertyKey: key,
      columnName: options.name ?? toSnakeCase(key),
      type,
      options,
      isPrimary: false,
      isGenerated: false,
      isCreatedAt: false,
      isUpdatedAt: false,
      isDeletedAt: false,
    });
  };
}

//pc

/**
 * Marks a property as the primary key column.
 *
 * @example
 * @PrimaryColumn()           // auto-generates a UUID
 * id: string;
 *
 * @PrimaryColumn({ generated: 'increment' })
 * id: number;
 */
export function PrimaryColumn(options: PrimaryColumnOptions = {}): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    const key = propertyKey.toString();
    const reflectedType = Reflect.getMetadata('design:type', target, propertyKey);
    const generated = options.generated !== undefined ? options.generated : 'uuid';
    const type = options.type ?? (generated === 'increment' ? 'int' : 'uuid');

    metadataStorage.registerColumn(target.constructor, key, {
      propertyKey: key,
      columnName: options.name ?? toSnakeCase(key),
      type,
      options,
      isPrimary: true,
      isGenerated: generated !== false,
      generationStrategy: generated !== false ? generated : undefined,
      isCreatedAt: false,
      isUpdatedAt: false,
      isDeletedAt: false,
    });
  };
}

/**
 * Automatically sets this column to the current date when a record is created.
 */
export function CreatedAt(): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    const key = propertyKey.toString();
    metadataStorage.registerColumn(target.constructor, key, {
      propertyKey: key,
      columnName: toSnakeCase(key),
      type: 'timestamp',
      options: { nullable: false },
      isPrimary: false,
      isGenerated: false,
      isCreatedAt: true,
      isUpdatedAt: false,
      isDeletedAt: false,
    });
  };
}

/**
 * Automatically updates this column to the current date on every save.
 */
export function UpdatedAt(): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    const key = propertyKey.toString();
    metadataStorage.registerColumn(target.constructor, key, {
      propertyKey: key,
      columnName: toSnakeCase(key),
      type: 'timestamp',
      options: { nullable: true },
      isPrimary: false,
      isGenerated: false,
      isCreatedAt: false,
      isUpdatedAt: true,
      isDeletedAt: false,
    });
  };
}

export function DeletedAt(): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    const key = propertyKey.toString();
    metadataStorage.registerColumn(target.constructor, key, {
      propertyKey: key,
      columnName: toSnakeCase(key),
      type: 'timestamp',
      options: { nullable: true },
      isPrimary: false,
      isGenerated: false,
      isCreatedAt: false,
      isUpdatedAt: false,
      isDeletedAt: true,
    });
  };
}

function buildRelation(
  type: RelationMetadata['type'],
  options: RelationOptions
): RelationMetadata {
  return {
    type,
    target: options.target,
    propertyKey: '', // set by the PropertyDecorator
    foreignKey: options.foreignKey ?? '',
    eager: options.eager ?? false,
    cascade: options.cascade ?? false,
    nullable: options.nullable ?? true,
    onDelete: options.onDelete ?? 'NO ACTION',
    onUpdate: options.onUpdate ?? 'NO ACTION',
    inverseSide: options.inverseSide,
  };
}

/**
 * A one-to-one relation.
 *
 * @example
 * @OneToOne({ target: () => Profile, foreignKey: 'userId' })
 * profile: Profile;
 */
export function OneToOne(options: RelationOptions): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    const key = propertyKey.toString();
    const relation = buildRelation('one-to-one', options);
    relation.propertyKey = key;
    relation.foreignKey = options.foreignKey ?? `${toSnakeCase(key)}_id`;
    metadataStorage.registerRelation(target.constructor, relation);
  };
}

/**
 * The owning side of a one-to-many relation
 *
 * @example
 * @ManyToOne({ target: () => Team, foreignKey: 'team_id' })
 * team: Team;
 */
export function ManyToOne(options: RelationOptions): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    const key = propertyKey.toString();
    const relation = buildRelation('many-to-one', options);
    relation.propertyKey = key;
    relation.foreignKey = options.foreignKey ?? `${toSnakeCase(key)}_id`;
    metadataStorage.registerRelation(target.constructor, relation);
  };
}

/**
 * The inverse side of a many-to-one relation.
 *
 * @example
 * @OneToMany({ target: () => Post, foreignKey: 'author_id', inverseSide: 'author' })
 * posts: Post[];
 */
export function OneToMany(options: RelationOptions): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    const key = propertyKey.toString();
    const relation = buildRelation('one-to-many', options);
    relation.propertyKey = key;
    relation.foreignKey = options.foreignKey ?? `${toSnakeCase(target.constructor.name)}_id`;
    metadataStorage.registerRelation(target.constructor, relation);
  };
}

/**
 * A many-to-many relation, backed by a join table.
 *
 * @example
 * @ManyToMany({ target: () => Tag })
 * @JoinTable({ name: 'post_tags' })
 * tags: Tag[];
 */
export function ManyToMany(options: RelationOptions): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    const key = propertyKey.toString();
    const ctor = target.constructor as Function;
    const relation = buildRelation('many-to-many', options);
    relation.propertyKey = key;

    // Pick up any @JoinTable options that fired before us (bottom-up stacking)
    const pendingJoinTable = Reflect.getMetadata(`quickorm:joinTable:${key}`, ctor);
    if (pendingJoinTable) {
      relation.joinTable = pendingJoinTable;
      Reflect.deleteMetadata(`quickorm:joinTable:${key}`, ctor);
    }

    metadataStorage.registerRelation(ctor, relation);
  };
}

/**
 * Configures the join table for a @ManyToMany relation.
 * Decorators on a property run bottom-up (@JoinTable fires before @ManyToMany
 * when stacked), so we store the options on the prototype and let ManyToMany
 * pick them up — or merge them if the relation is already registered.
 */
export function JoinTable(options: JoinTableOptions = {}): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    const key = propertyKey.toString();
    const ctor = target.constructor as Function;

    // Case 1: relation already registered (ManyToMany ran first) —> attach directly.
    const relations: any[] = Reflect.getMetadata('quickorm:relations', ctor) ?? [];
    const existing = relations.find((r: any) => r.propertyKey === key);
    if (existing) {
      existing.joinTable = options;
      Reflect.defineMetadata('quickorm:relations', relations, ctor);
      return;
    }

    // Case 2: @ManyToMany hasn't run yet —> stash for later pickup.
    Reflect.defineMetadata(`quickorm:joinTable:${key}`, options, ctor);
  };
}

function createHookDecorator(type: HookType): MethodDecorator {
  return (target: object, propertyKey: string | symbol) => {
    metadataStorage.registerHook(target.constructor as Function, type, propertyKey.toString());
  };
}

/** Called before INSERT */
export const BeforeInsert = () => createHookDecorator('BeforeInsert');
/** Called after INSERT */
export const AfterInsert  = () => createHookDecorator('AfterInsert');
/** Called before UPDATE */
export const BeforeUpdate = () => createHookDecorator('BeforeUpdate');
/** Called after UPDATE */
export const AfterUpdate  = () => createHookDecorator('AfterUpdate');
/** Called before DELETE */
export const BeforeDelete = () => createHookDecorator('BeforeDelete');
/** Called after DELETE */
export const AfterDelete  = () => createHookDecorator('AfterDelete');
/** Called after a row is loaded from the DB */
export const AfterLoad    = () => createHookDecorator('AfterLoad');



/**
 * Creates a database index on the decorated property.
 *
 * @example
 * @Index()
 * @Column()
 * email: string;
 *
 * // Or as a class decorator for composite indexes:
 * @Entity()
 * @Index(['firstName', 'lastName'], { unique: true })
 * class User { ... }
 */
export function Index(columnsOrOptions?: string[] | IndexOptions, options?: IndexOptions): any {
  return (target: any, propertyKey?: string | symbol) => {
    if (propertyKey !== undefined) {
      // Property decorator usage
      const key = propertyKey.toString();
      const opts = typeof columnsOrOptions === 'object' && !Array.isArray(columnsOrOptions)
        ? columnsOrOptions
        : options ?? {};
      metadataStorage.registerIndex(target.constructor, [key], opts);
    } else {
      const columns = Array.isArray(columnsOrOptions) ? columnsOrOptions : [];
      metadataStorage.registerIndex(target, columns, options ?? {});
    }
  };
}

/**
 * Shorthand for @Column({ unique: true }) without repeating options.
 */
export function Unique(): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    const key = propertyKey.toString();
    metadataStorage.registerIndex(target.constructor, [key], { unique: true });
  };
}
function inferColumnType(reflectedType: any): ColumnType {
  if (!reflectedType) return 'varchar';
  switch (reflectedType) {
    case String:   return 'varchar';
    case Number:   return 'float';
    case Boolean:  return 'boolean';
    case Date:     return 'timestamp';
    default:       return 'varchar';
  }
}
