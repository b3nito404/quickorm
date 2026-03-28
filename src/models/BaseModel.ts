import { metadataStorage } from '../core/MetadataStorage';
import { DeepPartial } from '../types';

/**
 * Optional base class for entities.
 * Provides `assign()`, `toJSON()`, and `clone()` helpers.
 * Entities do NOT need to extend this — any class decorated with @Entity works.
 */
export abstract class BaseModel {
  /**
   * Assign plain object properties to this instance.
   * Only copies keys that exist on the class (skips unknown fields).
   */
  assign(data: DeepPartial<this>): this {
    for (const key of Object.keys(data) as (keyof typeof data)[]) {
      (this as any)[key] = data[key];
    }
    return this;
  }

  toJSON(): Record<string, any> {
    const out: Record<string, any> = {};
    let meta: any;
    try {
      meta = metadataStorage.getEntityMetadata(this.constructor);
    } catch {
      // Not a registered entity —> just dump own properties
      return { ...this };
    }

    for (const col of meta.columns) {
      const val = (this as any)[col.propertyKey];
      out[col.propertyKey] = col.options.transformer
        ? col.options.transformer.to(val)
        : val;
    }
    return out;
  }

  /** Return a shallow clone of this entity. */
  clone(): this {
    return Object.assign(Object.create(Object.getPrototypeOf(this)), this);
  }

  /** Static factory create an instance from a plain object. */
  static create<T extends BaseModel>(
    this: new () => T,
    data: DeepPartial<T>
  ): T {
    const instance = new this();
    return instance.assign(data as any);
  }
}
