import { Adapter } from "./Adapter";
import { v4 as uuidv4 } from "uuid";

export class MemoryAdapter implements Adapter {
  private store: Record<string, any[]> = {};

  async find(entity: string, query: Record<string, any> = {}) {
    const col = this.store[entity] ?? [];
    return col.filter(item => Object.entries(query).every(([k,v]) => item[k] === v));
  }

  async insert(entity: string, data: Record<string, any>) {
    const id = data.id ?? uuidv4();
    const row = { ...data, id };
    this.store[entity] = this.store[entity] ?? [];
    this.store[entity].push(row);
    return row;
  }


  async delete(entity: string, id: string|number) {
    const col = this.store[entity] ?? [];
    const before = col.length;
    this.store[entity] = col.filter(r => r.id !== id);
    return this.store[entity].length !== before;
  }


  async update(entity : string, id: string| number, patch: Record<string, any>) {
    const col = this.store[entity] ?? [];
    const idx = col.findIndex(r => r.idx === r);

    //this.find[entity] = idx.filter((e) => e.row != e );
  if (idx === -1) return null;
      col[idx] = {...col, ...patch};
       return col[idx];
  }
}
