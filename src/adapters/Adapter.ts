export interface Adapter {
  find(entity: string, query?: Record<string, any>): Promise<any[]>;
  insert(entity: string, data: Record<string, any>): Promise<any>;
  update(entity: string, id: string|number, patch: Record<string, any>): Promise<any>;
  delete(entity: string, id: string|number): Promise<boolean>;
  query?(raw: string, params?: any[]): Promise<any>;
}
