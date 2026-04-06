# QuickORM

<p align="center">
  <a href="https://github.com/b3nito404/quickorm"><img src="https://img.shields.io/badge/GitHub-Repository-black?logo=github" /></a>
  <a href="https://www.npmjs.com/package/quickorm"><img src="https://img.shields.io/npm/v/quickorm.svg" /></a>
  <a href="https://www.npmjs.com/package/quickorm"><img src="https://img.shields.io/npm/dm/quickorm.svg" /></a>
</p>

<p align="center">
  A TypeScript ORM where your schema lives in your code - not the other way around.
</p>

---

## What makes it different

Most ORMs force a trade-off: heavy schema files disconnected from your code (Prisma), or verbose boilerplate that gets in your way (TypeORM). QuickORM doesn't.

- **No code generation.** Your entities are TypeScript classes. No `.prisma` file, no `npx generate`. What you write is what runs.
- **Anti-N+1 by default.** Relations load via a DataLoader pattern - 200 posts with their authors, one query.
- **Schema diff, no surprises.** `ds.diff()` shows exactly what changes before touching your database.
- **One API, four databases.** PostgreSQL, MySQL, SQLite, and an in-memory adapter for tests — same code, swap the config.

---

## Install

```bash
npm install quickorm reflect-metadata
npm install pg           # or mysql2 / better-sqlite3
```

Add to `tsconfig.json`:
```json
{ "experimentalDecorators": true, "emitDecoratorMetadata": true }
```

---

## Quick example

```typescript
import 'reflect-metadata';
import { Entity, PrimaryColumn, Column, CreatedAt, BaseModel } from 'quickorm';

@Entity('users')
export class User extends BaseModel {
  @PrimaryColumn()                           id!: string;      // UUID auto-generated
  @Column({ type: 'varchar', length: 100 })  name!: string;
  @Column({ type: 'varchar', length: 255 })  email!: string;
  @CreatedAt()                               createdAt!: Date;
}
```

```typescript
const ds = new DataSource({ type: 'postgres', /* ... */, entities: [User], synchronize: true });
await ds.connect();

const repo = ds.getRepository(User);
await repo.save(Object.assign(new User(), { name: 'Alice', email: 'alice@example.com' }));

const user = await repo.findOneBy({ email: 'alice@example.com' });
await repo.updateById(user.id, { name: 'Alice Martin' });
await repo.delete(user);  // soft delete : sets deletedAt
```

---

## Supports

| Database   | Package          |
|------------|------------------|
| PostgreSQL | `pg`             |
| MySQL      | `mysql2`         |
| SQLite     | `better-sqlite3` |
| In-memory  | built-in         |

Relations, lazy loading, transactions, lifecycle hooks, migrations, schema diff, pagination — all included.

---

## Full documentation

**[quickorm-documentation.vercel.app](https://quickorm-documentation.vercel.app)**

---

## License

MIT