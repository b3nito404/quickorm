import 'reflect-metadata';
import { DataSource } from '../../src/core/DataSource';
import { ConnectionError } from '../../src/errors/OrmError';
import { User, Post } from '../entities';

describe('DataSource', () => {
  //Connect /Disconnect

  test('connects with memory adapter', async () => {
    const ds = new DataSource({ type: 'memory', entities: [User] });
    await ds.connect();
    expect(ds.isConnected).toBe(true);
    await ds.disconnect();
    expect(ds.isConnected).toBe(false);
  });

  test('calling connect() twice is idempotent', async () => {
    const ds = new DataSource({ type: 'memory', entities: [User] });
    await ds.connect();
    await ds.connect(); // should not throw
    expect(ds.isConnected).toBe(true);
    await ds.disconnect();
  });

  test('throws ConnectionError for unknown adapter type', async () => {
    const ds = new DataSource({ type: 'oracle' as any });
    await expect(ds.connect()).rejects.toThrow(ConnectionError);
  });

  //getRepository

  test('getRepository() is cached per entity', async () => {
    const ds = new DataSource({ type: 'memory', entities: [User], synchronize: true });
    await ds.connect();
    const r1 = ds.getRepository(User);
    const r2 = ds.getRepository(User);
    expect(r1).toBe(r2);
    await ds.disconnect();
  });

  test('getRepository() throws when not connected', () => {
    const ds = new DataSource({ type: 'memory', entities: [User] });
    expect(() => ds.getRepository(User)).toThrow(ConnectionError);
  });

  test('synchronize: true creates tables automatically', async () => {
    const ds = new DataSource({ type: 'memory', entities: [User, Post], synchronize: true });
    await ds.connect();
    // If tables are created, we can insert without errors
    const repo = ds.getRepository(User);
    const user = Object.assign(new User(), { name: 'Test', email: 't@t.com' });
    await expect(repo.insert(user)).resolves.toBeTruthy();
    await ds.disconnect();
  });

  test('query() executes raw SQL', async () => {
    const ds = new DataSource({ type: 'memory', entities: [User], synchronize: true });
    await ds.connect();
    const rows = await ds.query('SELECT * FROM "users"');
    expect(Array.isArray(rows)).toBe(true);
    await ds.disconnect();
  });
  test('createQueryBuilder() returns a QueryBuilder', async () => {
    const ds = new DataSource({ type: 'memory', entities: [User], synchronize: true });
    await ds.connect();
    const qb  = ds.createQueryBuilder().from('users');
    const rows = await qb.getMany();
    expect(Array.isArray(rows)).toBe(true);
    await ds.disconnect();
  });
});
