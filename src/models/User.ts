import { BaseModel } from "./BaseModel";

export class User extends BaseModel {
  email!: string;
  name?: string;
}
