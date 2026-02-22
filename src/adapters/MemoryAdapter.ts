import { Adapter } from "./Adapter";
import { v4 as uuidv4 } from "uuid";

export class MemoryAdapter implements Adapter {
  private store: Record<string, any[]> = {};

  async find(entity: string, query: Record<string, any> = {}) {
    const collection = this.store[entity] ?? [];
    return collection.filter(item => Object.entries(query).every(([k,v]) => item[k] === v));
  }

  async insert(entity: string, data: Record<string, any>) {
    const id = data.id ?? uuidv4();
    const row = { ...data, id };
    this.store[entity] = this.store[entity] ?? [];
    this.store[entity].push(row);
    return row;
  }


  async update(entity : string, id: string| number, patch: Record<string, any>) {
    const collection = this.store[entity] ?? [];
    const index = collection.findIndex(r => r.idx === r);

  if (index === -1) return null;
      collection[index] = {...collection, ...patch};
       return {...collection[index]};
    }
  }

  async delete(entity : string , id: string | number) {
    const collection = this.store[entity] ?? [];
    initialLength = collection.filter(item => item.id !== id);
  }
  