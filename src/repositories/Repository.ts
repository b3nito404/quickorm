import { Adapter } from "../adapters/Adapter";

export type Query = Record<string, any>;

export class Repository<T extends { id?: string | number }> {
  protected adapter: Adapter;
  protected entityName: string;
  constructor(adapter: Adapter, entityName: string) {
    this.adapter = adapter;
    this.entityName = entityName;
  }

  async create(item: Omit<T,'id'>): Promise<T> {
    const inserted = await this.adapter.insert(this.entityName, item as Record<string,any>);
    return inserted as T;
  }

  async findById(id: string|number): Promise<T|null> {
    const rows = await this.adapter.find(this.entityName, { id });
    return rows.length ? rows[0] as T : null;
  }

  async find(query: Query = {}): Promise<T[]> {
    return (await this.adapter.find(this.entityName, query)) as T[];
  }

  async update(id: string|number, patch: Partial<T>): Promise<T|null> {
    return (await this.adapter.update(this.entityName, id, patch as Record<string,any>)) as T | null;
  }

  async delete(id: string|number): Promise<Boolean> {
    return await this.adapter.delete(this.entityName, id);
  }
}
