# QuickORM

<p align="center">
  <a href="https://github.com/b3nito404/quickorm">
    <img src="https://img.shields.io/badge/GitHub-Repository-black?logo=github" />
  </a>
  <a href="https://www.npmjs.com/package/quickorm">
    <img src="https://img.shields.io/npm/v/quickorm.svg" />
  </a>
  <a href="https://www.npmjs.com/package/quickorm">
    <img src="https://img.shields.io/npm/dm/quickorm.svg" />
  </a>
</p>

A TypeScript ORM built around one idea: your database schema should follow your code, not the other way around.

QuickORM uses decorators to map TypeScript classes to database tables. You define your entities, your relations, your constraints and QuickORM handles the SQL, the mapping, the migrations, and the edge cases.

Works with PostgreSQL, MySQL, SQLite, and an in-memory adapter for testing.

---

## Why QuickORM

Most ORMs make you choose between two trade-offs: a heavy schema file disconnected from your code (Prisma), or a complex API that requires significant boilerplate to get anything done (TypeORM, MikroORM).

QuickORM takes a different position. Entities are plain TypeScript classes. Decorators are the only annotation layer. The API stays close to what you would write by hand, without forcing you to learn a parallel language or a code generation step.

A few properties worth noting:

- **No code generation.** No `.prisma` file, no `npx prisma generate`. Your entities are your source of truth at runtime.
- **Anti-N+1 built in.** Relation loading uses a DataLoader pattern. Loading 200 posts with their authors fires one query, not 200.
- **Schema diff without migrations pain.** `ds.diff()` compares your entities against the live database and tells you exactly what would change before touching anything.
- **One adapter interface.** The same repository and query builder code runs against every supported database. Switching adapters does not change your application code.
- **In-memory adapter.** Write tests against the same repository and query builder without a database process. No mocking, no setup, no teardown.

---

## Installation
```bash
npm install quickorm reflect-metadata
```

Install the driver for your database:
```bash
npm install pg                # PostgreSQL
npm install mysql2            # MySQL / MariaDB
npm install better-sqlite3    # SQLite
```

---

## TypeScript configuration

Two compiler options are required:
```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

And one import at the entry point of your application, before anything else:
```typescript
import 'reflect-metadata';
```

---

## Getting started

### 1. Define an entity
```typescript
import 'reflect-metadata';
import {
  Entity,
  PrimaryColumn,
  Column,
  CreatedAt,
  UpdatedAt,
  DeletedAt,
  BaseModel,
} from 'quickorm';

@Entity('users')
export class User extends BaseModel {
  @PrimaryColumn()
  id!: string;

  @Column({ type: 'varchar', length: 100, nullable: false })
  name!: string;

  @Column({ type: 'varchar', length: 255, nullable: false })
  email!: string;

  @Column({ type: 'int', nullable: true })
  age?: number;

  @Column({ type: 'boolean', default: true })
  active: boolean = true;

  @CreatedAt()
  createdAt!: Date;

  @UpdatedAt()
  updatedAt?: Date;

  @DeletedAt()
  deletedAt?: Date;
}
```

`@PrimaryColumn()` generates a UUID automatically on insert.
`@DeletedAt()` activates soft delete: `repo.delete()` sets the column instead of removing the row.

### 2. Create a DataSource
```typescript
import { DataSource } from 'quickorm';
import { User } from './entities/User';

const ds = new DataSource({
  type: 'postgres',
  host: 'localhost',
  port: 5432,
  username: 'postgres',
  password: 'secret',
  database: 'myapp',
  entities: [User],
  synchronize: true,
  logging: true,
});

await ds.connect();
```

`synchronize: true` creates missing tables and columns on connect. It never drops or alters existing data. Disable it in production and use migrations instead.

### 3. Use the repository
```typescript
const repo = ds.getRepository(User);

// Insert
const user = Object.assign(new User(), {
  name: 'Alice',
  email: 'alice@example.com',
  age: 28,
});
await repo.save(user);
// user.id is now set, createdAt and updatedAt are populated

// Query
const all     = await repo.findAll();
const byId    = await repo.findById(user.id);
const byEmail = await repo.findOneBy({ email: 'alice@example.com' });
const active  = await repo.findBy({ active: true });

// Update
user.name = 'Alice Martin';
await repo.save(user);

// Partial update
await repo.updateById(user.id, { age: 29 });

// Soft delete (sets deletedAt)
await repo.delete(user);

// Restore
await repo.restore(user.id);

// Hard delete (permanent)
await repo.hardDelete(user);

// Pagination
const page = await repo.paginate(1, 20, { order: { createdAt: 'DESC' } });
// { data, total, page, perPage, lastPage }

// Aggregation
const count  = await repo.count({ active: true });
const exists = await repo.exists({ email: 'alice@example.com' });
```

---

## Query builder

For queries that go beyond simple conditions:
```typescript
const results = await repo.createQueryBuilder()
  .where('age', '>=', 18)
  .andWhere('active', '=', true)
  .orderBy('name', 'ASC')
  .limit(10)
  .offset(20)
  .getMany<User>();
```

Available filter methods:
```typescript
.where(field, operator, value)
.andWhere(field, operator, value)
.orWhere(field, operator, value)
.whereIn(field, values)
.whereNotIn(field, values)
.whereNull(field)
.whereNotNull(field)
.whereBetween(field, min, max)
.whereLike(field, '%pattern%')
```

Supported operators: `=`, `!=`, `>`, `>=`, `<`, `<=`, `LIKE`, `ILIKE`, `IN`, `NOT IN`, `IS NULL`, `IS NOT NULL`, `BETWEEN`.

Cross-table query using the raw builder:
```typescript
const stats = await ds.createQueryBuilder()
  .from('users', 'u')
  .leftJoin('posts', 'p', 'p.author_id = u.id')
  .select('u.id', 'u.name', 'COUNT(p.id) as total_posts')
  .groupBy('u.id')
  .having('total_posts', '>', 5)
  .orderBy('total_posts', 'DESC')
  .getMany();
```

Terminal methods:
```typescript
.getMany<T>()    // T[]
.getOne<T>()     // T | null
.getCount()      // number
.exists()        // boolean
.execute()       // QueryResult
.build()         // { sql, params } — no execution
```

---

## Relations

### ManyToOne and OneToMany
```typescript
@Entity('posts')
export class Post extends BaseModel {
  @PrimaryColumn()
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  title!: string;

  @Column({ type: 'varchar', nullable: true })
  author_id?: string;

  @ManyToOne({ target: () => User, foreignKey: 'author_id' })
  author?: User;
}

@Entity('users')
export class User extends BaseModel {
  @PrimaryColumn()
  id!: string;

  @OneToMany({ target: () => Post, foreignKey: 'author_id', inverseSide: 'author' })
  posts?: Post[];
}
```

### ManyToMany
```typescript
@Entity('articles')
export class Article extends BaseModel {
  @PrimaryColumn()
  id!: string;

  @ManyToMany({ target: () => Tag })
  @JoinTable({
    name: 'article_tags',
    joinColumn: 'article_id',
    inverseJoinColumn: 'tag_id',
  })
  tags?: Tag[];
}
```

### Loading relations
```typescript
const posts = await postRepo.find({
  relations: ['author', 'tags'],
  order: { createdAt: 'DESC' },
  limit: 10,
});

posts[0].author  // populated
posts[0].tags    // populated
```

### Lazy loading

Relations can be loaded lazily by setting `lazy: true` on the decorator. The property becomes a `Promise<T>` resolved only on first access, with an internal cache so subsequent awaits do not fire additional queries.

```typescript
@Entity('posts')
export class Post extends BaseModel {
  @PrimaryColumn()
  id!: string;

  @Column({ type: 'varchar', nullable: true })
  author_id?: string;

  @ManyToOne({ target: () => User, foreignKey: 'author_id', lazy: true })
  author!: Promise<User | null>;
}

// Usage : no relations option needed
const post   = await postRepo.findById(id);
const author = await post.author;  // loads on first access
const again  = await post.author;  // returns cached value, no query

---

## Lifecycle hooks
```typescript
@Entity('users')
export class User extends BaseModel {
  @BeforeInsert()
  normalizeEmail() {
    this.email = this.email.toLowerCase().trim();
  }

  @AfterInsert()
  async sendWelcome() {
    await mailer.send(this.email, 'Welcome');
  }

  @BeforeUpdate()
  validateAge() {
    if (this.age !== undefined && this.age < 0) {
      throw new Error('Age cannot be negative');
    }
  }
}
```

Available hooks: `@BeforeInsert`, `@AfterInsert`, `@BeforeUpdate`, `@AfterUpdate`, `@BeforeDelete`, `@AfterDelete`, `@AfterLoad`.

---

## Transactions
```typescript
await ds.transaction(async (tx) => {
  const userRepo    = tx.getRepository(User);
  const accountRepo = tx.getRepository(Account);

  await userRepo.save(newUser);
  await accountRepo.updateById(accountId, { balance: newBalance });

  // Any error thrown here triggers an automatic rollback.
  // On success, the transaction commits automatically.
});
```

---

## Migrations

### Create a migration file
```bash
npx quickorm migration:create CreateUsersTable
```

### Implement it
```typescript
import { Migration, QueryRunner } from 'quickorm';

export class CreateUsersTable1700000000000 extends Migration {
  name = 'CreateUsersTable1700000000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.createTable('users', [
      { name: 'id',         type: 'uuid',      primary: true,  nullable: false },
      { name: 'email',      type: 'varchar',   length: 255,    nullable: false, unique: true },
      { name: 'name',       type: 'varchar',   length: 100,    nullable: false },
      { name: 'created_at', type: 'timestamp', nullable: false },
    ]);
    await runner.createIndex('users', ['email'], true);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.dropTable('users');
  }
}
```

### Run migrations
```typescript
const ds = new DataSource({
  migrations: [CreateUsersTable1700000000000],
  migrationsRun: true,
});

// Or manually:
await ds.runMigrations();
await ds.revertLastMigration();
```

### QueryRunner API
```typescript
runner.query(sql, params?)
runner.createTable(name, columns)
runner.dropTable(name)
runner.addColumn(tableName, column)
runner.dropColumn(tableName, columnName)
runner.createIndex(tableName, columns, unique?, name?)
runner.dropIndex(name)
```

---

## Schema diff
```typescript
const diff = await ds.diff();

console.log(diff.summary);
// "2 table(s) to create, 1 column(s) to add"

diff.actions.forEach(a => {
  console.log(a.description);
  console.log(a.sql);
});

// Apply the changes
await ds.applyDiff(diff);

// Or generate a migration file from the diff
const source = ds.generateMigration(diff, 'AddAgeColumn');
```

---

## Testing
```typescript
import { DataSource } from 'quickorm';
import { User } from '../entities/User';

describe('UserRepository', () => {
  let ds: DataSource;

  beforeEach(async () => {
    ds = new DataSource({
      type: 'memory',
      entities: [User],
      synchronize: true,
    });
    await ds.connect();
  });

  afterEach(async () => {
    await ds.disconnect();
  });

  test('creates a user with a generated id', async () => {
    const repo = ds.getRepository(User);
    const user = Object.assign(new User(), {
      name: 'Alice',
      email: 'alice@example.com',
    });
    await repo.save(user);
    expect(user.id).toBeTruthy();
    expect(user.createdAt).toBeInstanceOf(Date);
  });
});
```

---

## Column types

`varchar`, `text`, `char`, `int`, `bigint`, `smallint`, `tinyint`, `float`, `double`, `decimal`, `boolean`, `date`, `datetime`, `timestamp`, `time`, `json`, `jsonb`, `uuid`, `blob`, `enum`.

---

## Column options
```typescript
@Column({
  type: 'varchar',
  name: 'user_email',
  length: 255,
  nullable: false,
  unique: true,
  default: 'active',
  precision: 10,
  scale: 2,
  enum: ['admin', 'user', 'guest'],
  transformer: {
    to:   (value: string) => value.toLowerCase(),
    from: (value: string) => value,
  },
})
email!: string;
```

---

## Supported databases

| Database        | Adapter           | Package           |
|-----------------|-------------------|-------------------|
| PostgreSQL      | `PostgresAdapter` | `pg`              |
| MySQL / MariaDB | `MySQLAdapter`    | `mysql2`          |
| SQLite          | `SQLiteAdapter`   | `better-sqlite3`  |
| In-memory       | `MemoryAdapter`   | built-in          |

---

## Error types
```typescript
import {
  OrmError,
  ConnectionError,
  QueryError,
  EntityNotFoundError,
  MigrationError,
  MetadataError,
  TransactionError,
  ValidationError,
} from 'quickorm';
```

`QueryError` exposes `.sql` and `.params` for debugging. `EntityNotFoundError` exposes `.entity` and `.criteria`.

---

## DataSource options

| Option          | Type       | Description                                              |
|-----------------|------------|----------------------------------------------------------|
| `type`          | string     | `postgres`, `mysql`, `sqlite`, `memory`                  |
| `host`          | string     | Database host                                            |
| `port`          | number     | Database port                                            |
| `username`      | string     | Database user                                            |
| `password`      | string     | Database password                                        |
| `database`      | string     | Database name                                            |
| `filename`      | string     | SQLite file path                                         |
| `entities`      | Function[] | Entity classes to register                               |
| `synchronize`   | boolean    | Create missing tables on connect (disable in production) |
| `logging`       | boolean    | Log generated SQL to the console                         |
| `migrations`    | array      | Migration classes to register                            |
| `migrationsRun` | boolean    | Run pending migrations on connect                        |
| `poolSize`      | number     | Connection pool size                                     |
| `ssl`           | boolean    | Enable SSL                                               |

---

## Known limitations for the v1.1.0

- `ALTER COLUMN` for SQLite is not supported. SQLite does not allow column type changes via DDL. PostgreSQL and MySQL generate the correct statement automatically.
- The in-memory adapter resolves scalar subqueries and basic `GROUP BY / HAVING` but does not support window functions (`OVER`, `PARTITION BY`, `RANK`, etc.).
---

## License

MIT
