export abstract class BaseModel {
  id?: string | number;
  createdAt?: Date;
  updatedAt?: Date;
  toJSON() { return { ...this }; }
}
