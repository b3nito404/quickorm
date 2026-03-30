import 'reflect-metadata';
import { MemoryAdapter } from '../../src/adapters/MemoryAdapter';
import { QueryBuilder } from '../../src/core/QueryBuilder';

describe('QueryBuilder', () => {
  let adapter: MemoryAdapter;

  beforeEach(async () => {
    adapter = new MemoryAdapter();
    await adapter.connect({ type: 'memory' });
    await adapter.query('CREATE TABLE "users" ("id" VARCHAR(36), "name" VARCHAR(255), "age" INTEGER, "active" INTEGER)');
    await adapter.query('INSERT INTO "users" ("id","name","age","active") VALUES (?,?,?,?)', ['1', 'Alice', 25, 1]);
    await adapter.query('INSERT INTO "users" ("id","name","age","active") VALUES (?,?,?,?)', ['2', 'Bob', 30, 1]);
    await adapter.query('INSERT INTO "users" ("id","name","age","active") VALUES (?,?,?,?)', ['3', 'Carol', 22, 0]);
  });

  afterEach(async () => {
    await adapter.disconnect();
  });


  test('SELECT * FROM table', async () => {
    const rows = await new QueryBuilder(adapter).from('users').getMany();
    expect(rows).toHaveLength(3);
  });

  test('SELECT with WHERE =', async () => {
    const rows = await new QueryBuilder(adapter)
      .from('users')
      .where('name', '=', 'Alice')
      .getMany();
    expect(rows).toHaveLength(1);
  });

  test('SELECT with WHERE > (greater than)', async () => {
    const rows = await new QueryBuilder(adapter)
      .from('users')
      .where('age', '>', 24)
      .getMany();
    expect(rows).toHaveLength(2);
  });

  test('SELECT with andWhere', async () => {
    const rows = await new QueryBuilder(adapter)
      .from('users')
      .where('active', '=', 1)
      .andWhere('age', '>', 26)
      .getMany();
    expect(rows).toHaveLength(1);
    expect((rows[0] as any).name).toBe('Bob');
  });

  test('SELECT with whereIn', async () => {
    const rows = await new QueryBuilder(adapter)
      .from('users')
      .whereIn('name', ['Alice', 'Carol'])
      .getMany();
    expect(rows).toHaveLength(2);
  });

  test('SELECT with whereNull', async () => {
    await adapter.query('INSERT INTO "users" ("id","name","age","active") VALUES (?,?,?,?)', ['4', 'Dave', null, 1]);
    const rows = await new QueryBuilder(adapter)
      .from('users')
      .whereNull('age')
      .getMany();
    expect(rows).toHaveLength(1);
  });

  test('SELECT with ORDER BY', async () => {
    const rows = await new QueryBuilder(adapter)
      .from('users')
      .orderBy('age', 'ASC')
      .getMany<{ age: number }>();
    expect(rows[0].age).toBe(22);
    expect(rows[2].age).toBe(30);
  });

  test('SELECT with LIMIT', async () => {
    const rows = await new QueryBuilder(adapter).from('users').limit(2).getMany();
    expect(rows).toHaveLength(2);
  });

  test('SELECT with paginate()', async () => {
    const rows = await new QueryBuilder(adapter)
      .from('users')
      .orderBy('id', 'ASC')
      .paginate(2, 2)
      .getMany();
    expect(rows).toHaveLength(1); // page 2 of 3 items with 2 per page = 1 item
  });

  test('getOne() returns first match or null', async () => {
    const row = await new QueryBuilder(adapter)
      .from('users')
      .where('name', '=', 'Bob')
      .getOne<{ name: string }>();
    expect(row?.name).toBe('Bob');

    const none = await new QueryBuilder(adapter)
      .from('users')
      .where('name', '=', 'Nobody')
      .getOne();
    expect(none).toBeNull();
  });

  test('getCount()', async () => {
    const count = await new QueryBuilder(adapter)
      .from('users')
      .where('active', '=', 1)
      .getCount();
    expect(count).toBe(2);
  });

  test('exists()', async () => {
    const yes = await new QueryBuilder(adapter)
      .from('users')
      .where('name', '=', 'Alice')
      .exists();
    expect(yes).toBe(true);

    const no = await new QueryBuilder(adapter)
      .from('users')
      .where('name', '=', 'Ghost')
      .exists();
    expect(no).toBe(false);
  });


  test('INSERT', async () => {
    await new QueryBuilder(adapter)
      .from('users')
      .insert({ id: '99', name: 'Eve', age: 28, active: 1 })
      .execute();
    const rows = await adapter.query('SELECT * FROM "users" WHERE "id" = ?', ['99']);
    expect(rows.rows).toHaveLength(1);
  });


  test('UPDATE', async () => {
    await new QueryBuilder(adapter)
      .from('users')
      .update({ name: 'Alice Smith' })
      .where('id', '=', '1')
      .execute();
    const rows = await adapter.query('SELECT * FROM "users" WHERE "id" = ?', ['1']);
    expect((rows.rows[0] as any).name).toBe('Alice Smith');
  });



  test('DELETE', async () => {
    await new QueryBuilder(adapter)
      .from('users')
      .delete()
      .where('id', '=', '1')
      .execute();
    const rows = await adapter.query('SELECT * FROM "users"');
    expect(rows.rows).toHaveLength(2);
  });


  test('build() returns correct SQL and params without executing', () => {
    const { sql, params } = new QueryBuilder(adapter)
      .from('users')
      .where('active', '=', 1)
      .andWhere('age', '>', 20)
      .orderBy('name', 'ASC')
      .limit(10)
      .build();

    expect(sql).toContain('SELECT');
    expect(sql).toContain('WHERE');
    expect(sql).toContain('ORDER BY');
    expect(sql).toContain('LIMIT 10');
    expect(params).toEqual([1, 20]);
  });

  test('BETWEEN', async () => {
    const rows = await new QueryBuilder(adapter)
      .from('users')
      .whereBetween('age', 22, 25)
      .getMany<{ age: number }>();
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.age >= 22 && r.age <= 25)).toBe(true);
  });

  test('LIKE', async () => {
    const rows = await new QueryBuilder(adapter)
      .from('users')
      .whereLike('name', 'A%')
      .getMany<{ name: string }>();
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Alice');
  });
});
