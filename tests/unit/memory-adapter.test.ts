import 'reflect-metadata';
import { MemoryAdapter } from '../../src/adapters/MemoryAdapter';

describe('MemoryAdapter', () => {
  let adapter: MemoryAdapter;

  beforeEach(async () => {
    adapter = new MemoryAdapter();
    await adapter.connect({ type: 'memory' });
  });

  afterEach(async () => {
    await adapter.disconnect();
  });


  test('connects and reports isConnected', () => {
    expect(adapter.isConnected()).toBe(true);
  });

  test('disconnects cleanly', async () => {
    await adapter.disconnect();
    expect(adapter.isConnected()).toBe(false);
  });


  test('CREATE TABLE', async () => {
    await adapter.query('CREATE TABLE "users" ("id" VARCHAR(36), "name" VARCHAR(255))');
    expect(adapter.tableExists('users')).toBe(true);
  });

  test('DROP TABLE', async () => {
    await adapter.query('CREATE TABLE "items" ("id" VARCHAR(36))');
    await adapter.query('DROP TABLE "items"');
    expect(adapter.tableExists('items')).toBe(false);
  });


  test('INSERT and SELECT *', async () => {
    await adapter.query('CREATE TABLE "users" ("id" VARCHAR(36), "name" VARCHAR(255))');
    await adapter.query('INSERT INTO "users" ("id","name") VALUES (?,?)', ['u1', 'Alice']);
    const result = await adapter.query('SELECT * FROM "users"');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ id: 'u1', name: 'Alice' });
  });

  test('INSERT multiple rows', async () => {
    await adapter.query('CREATE TABLE "t" ("id" VARCHAR(36), "v" VARCHAR(10))');
    await adapter.query('INSERT INTO "t" ("id","v") VALUES (?,?)', ['1', 'a']);
    await adapter.query('INSERT INTO "t" ("id","v") VALUES (?,?)', ['2', 'b']);
    const result = await adapter.query('SELECT * FROM "t"');
    expect(result.rows).toHaveLength(2);
  });


  test('SELECT with WHERE =', async () => {
    await adapter.query('CREATE TABLE "u" ("id" VARCHAR(36), "name" VARCHAR(255))');
    await adapter.query('INSERT INTO "u" ("id","name") VALUES (?,?)', ['1', 'Alice']);
    await adapter.query('INSERT INTO "u" ("id","name") VALUES (?,?)', ['2', 'Bob']);
    const result = await adapter.query('SELECT * FROM "u" WHERE "name" = ?', ['Alice']);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].name).toBe('Alice');
  });

  test('SELECT with WHERE IS NULL', async () => {
    await adapter.query('CREATE TABLE "u" ("id" VARCHAR(36), "v" VARCHAR(10))');
    await adapter.query('INSERT INTO "u" ("id","v") VALUES (?,?)', ['1', null]);
    await adapter.query('INSERT INTO "u" ("id","v") VALUES (?,?)', ['2', 'hello']);
    const result = await adapter.query('SELECT * FROM "u" WHERE "v" IS NULL');
    expect(result.rows).toHaveLength(1);
  });

  test('SELECT with WHERE IN', async () => {
    await adapter.query('CREATE TABLE "u" ("id" VARCHAR(36), "name" VARCHAR(255))');
    await adapter.query('INSERT INTO "u" ("id","name") VALUES (?,?)', ['1', 'Alice']);
    await adapter.query('INSERT INTO "u" ("id","name") VALUES (?,?)', ['2', 'Bob']);
    await adapter.query('INSERT INTO "u" ("id","name") VALUES (?,?)', ['3', 'Carol']);
    const result = await adapter.query('SELECT * FROM "u" WHERE "name" IN (?,?)', ['Alice', 'Carol']);
    expect(result.rows).toHaveLength(2);
  });

  test('SELECT with ORDER BY ASC', async () => {
    await adapter.query('CREATE TABLE "u" ("id" VARCHAR(36), "age" INTEGER)');
    await adapter.query('INSERT INTO "u" ("id","age") VALUES (?,?)', ['1', 30]);
    await adapter.query('INSERT INTO "u" ("id","age") VALUES (?,?)', ['2', 20]);
    await adapter.query('INSERT INTO "u" ("id","age") VALUES (?,?)', ['3', 25]);
    const result = await adapter.query('SELECT * FROM "u" ORDER BY "age" ASC');
    expect((result.rows[0] as any).age).toBe(20);
    expect((result.rows[2] as any).age).toBe(30);
  });

  test('SELECT with LIMIT and OFFSET', async () => {
    await adapter.query('CREATE TABLE "u" ("id" VARCHAR(36))');
    for (let i = 1; i <= 5; i++) {
      await adapter.query('INSERT INTO "u" ("id") VALUES (?)', [String(i)]);
    }
    const result = await adapter.query('SELECT * FROM "u" LIMIT 2 OFFSET 2');
    expect(result.rows).toHaveLength(2);
  });

  test('SELECT COUNT(*)', async () => {
    await adapter.query('CREATE TABLE "u" ("id" VARCHAR(36))');
    await adapter.query('INSERT INTO "u" ("id") VALUES (?)', ['1']);
    await adapter.query('INSERT INTO "u" ("id") VALUES (?)', ['2']);
    const result = await adapter.query('SELECT COUNT(*) as count FROM "u"');
    expect(Number((result.rows[0] as any).count)).toBe(2);
  });


  test('UPDATE with WHERE', async () => {
    await adapter.query('CREATE TABLE "u" ("id" VARCHAR(36), "name" VARCHAR(255))');
    await adapter.query('INSERT INTO "u" ("id","name") VALUES (?,?)', ['1', 'Alice']);
    await adapter.query('UPDATE "u" SET "name" = ? WHERE "id" = ?', ['Alice Updated', '1']);
    const result = await adapter.query('SELECT * FROM "u" WHERE "id" = ?', ['1']);
    expect(result.rows[0]).toMatchObject({ name: 'Alice Updated' });
  });


  test('DELETE with WHERE', async () => {
    await adapter.query('CREATE TABLE "u" ("id" VARCHAR(36))');
    await adapter.query('INSERT INTO "u" ("id") VALUES (?)', ['1']);
    await adapter.query('INSERT INTO "u" ("id") VALUES (?)', ['2']);
    await adapter.query('DELETE FROM "u" WHERE "id" = ?', ['1']);
    const result = await adapter.query('SELECT * FROM "u"');
    expect(result.rows).toHaveLength(1);
  });


  test('transaction commits', async () => {
    await adapter.query('CREATE TABLE "u" ("id" VARCHAR(36))');
    await adapter.transaction(async (a) => {
      await a.query('INSERT INTO "u" ("id") VALUES (?)', ['tx1']);
    });
    const result = await adapter.query('SELECT * FROM "u"');
    expect(result.rows).toHaveLength(1);
  });

  test('transaction rolls back on error', async () => {
    await adapter.query('CREATE TABLE "u" ("id" VARCHAR(36))');
    try {
      await adapter.transaction(async (a) => {
        await a.query('INSERT INTO "u" ("id") VALUES (?)', ['tx1']);
        throw new Error('deliberate failure');
      });
    } catch {
      // expected
    }
    const result = await adapter.query('SELECT * FROM "u"');
    expect(result.rows).toHaveLength(0);
  });


  test('SELECT with WHERE LIKE', async () => {
    await adapter.query('CREATE TABLE "u" ("id" VARCHAR(36), "email" VARCHAR(255))');
    await adapter.query('INSERT INTO "u" ("id","email") VALUES (?,?)', ['1', 'alice@example.com']);
    await adapter.query('INSERT INTO "u" ("id","email") VALUES (?,?)', ['2', 'bob@other.com']);
    const result = await adapter.query('SELECT * FROM "u" WHERE "email" LIKE ?', ['%example%']);
    expect(result.rows).toHaveLength(1);
  });
});
