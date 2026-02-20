import { Repository } from "./Repository";
import { User } from "../models/User";
import { Adapter } from "../adapters/Adapter";

export class UserRepository extends Repository<User> {
  constructor(adapter: Adapter) { super(adapter, "users"); }
  // méthodes custom (ex: findByEmail)
}
