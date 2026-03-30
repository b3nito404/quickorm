import 'reflect-metadata';
import { DataSource } from '../../src/core/DataSource';
import { Repository } from '../../src/repositories/Repository';
import { User, Post, Product } from '../entities';

describe('Repository (MemoryAdapter)', () => {
  let ds: DataSource;
  let userRepo: Repository<User>;
  let postRepo: Repository<Post>;
  let productRepo: Repository<Product>;

  beforeEach(async () => {
    ds = new DataSource({
      type: 'memory',
      entities: [User, Post, Product],
      synchronize: true,
      logging: false,
    });
    await ds.connect();
    userRepo    = ds.getRepository(User);
    postRepo    = ds.getRepository(Post);
    productRepo = ds.getRepository(Product);
  });

  afterEach(async () => {
    await ds.disconnect();
  });

  test('insert() generates a UUID and timestamps', async () => {
    const user = new User();
    user.name  = 'Alice';
    user.email = 'alice@example.com';

    const saved = await userRepo.insert(user);
    expect(saved.id).toBeTruthy();
    expect(saved.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(saved.createdAt).toBeInstanceOf(Date);
    expect(saved.updatedAt).toBeInstanceOf(Date);
  });

  test('insert() fires BeforeInsert and AfterInsert hooks', async () => {
    const user = new User();
    user.name  = 'Hook Test';
    user.email = 'hook@test.com';

    await userRepo.insert(user);
    expect(user.hookLog).toContain('BeforeInsert');
    expect(user.hookLog).toContain('AfterInsert');
  });

  test('save() on new entity calls insert', async () => {
    const user  = new User();
    user.name   = 'New User';
    user.email  = 'new@test.com';
    const saved = await userRepo.save(user);
    expect(saved.id).toBeTruthy();
  });

  test('find() returns all records', async () => {
    await userRepo.insert(Object.assign(new User(), { name: 'A', email: 'a@t.com' }));
    await userRepo.insert(Object.assign(new User(), { name: 'B', email: 'b@t.com' }));
    const users = await userRepo.find();
    expect(users).toHaveLength(2);
  });

  test('findById() returns the correct entity', async () => {
    const user = await userRepo.insert(Object.assign(new User(), { name: 'Alice', email: 'a@t.com' }));
    const found = await userRepo.findById(user.id);
    expect(found).not.toBeNull();
    expect(found!.name).toBe('Alice');
  });

  test('findById() returns null when not found', async () => {
    const found = await userRepo.findById('non-existent-id');
    expect(found).toBeNull();
  });

  test('findOneBy() with conditions', async () => {
    await userRepo.insert(Object.assign(new User(), { name: 'Alice', email: 'alice@ex.com' }));
    const found = await userRepo.findOneBy({ email: 'alice@ex.com' });
    expect(found?.name).toBe('Alice');
  });

  test('findByIdOrFail() throws EntityNotFoundError', async () => {
    await expect(userRepo.findByIdOrFail('bad-id')).rejects.toThrow('Entity "User" not found');
  });

  test('find() with order', async () => {
    await userRepo.insert(Object.assign(new User(), { name: 'Bob', email: 'b@t.com', age: 30 }));
    await userRepo.insert(Object.assign(new User(), { name: 'Alice', email: 'a@t.com', age: 25 }));
    const users = await userRepo.find({ order: { name: 'ASC' } });
    expect(users[0].name).toBe('Alice');
    expect(users[1].name).toBe('Bob');
  });

  test('find() with limit and offset', async () => {
    for (let i = 0; i < 5; i++) {
      await userRepo.insert(Object.assign(new User(), { name: `User${i}`, email: `u${i}@t.com` }));
    }
    const page = await userRepo.find({ limit: 2, offset: 2 });
    expect(page).toHaveLength(2);
  });


  test('save() on existing entity calls update', async () => {
    const user = await userRepo.insert(Object.assign(new User(), { name: 'Alice', email: 'a@t.com' }));
    user.name = 'Alice Updated';
    await userRepo.save(user);
    const found = await userRepo.findById(user.id);
    expect(found?.name).toBe('Alice Updated');
  });

  test('updateById() applies partial update', async () => {
    const user = await userRepo.insert(Object.assign(new User(), { name: 'Alice', email: 'a@t.com' }));
    await userRepo.updateById(user.id, { name: 'Alice Smith' });
    const found = await userRepo.findById(user.id);
    expect(found?.name).toBe('Alice Smith');
  });


  test('delete() soft-deletes (sets deletedAt)', async () => {
    const user = await userRepo.insert(Object.assign(new User(), { name: 'Alice', email: 'a@t.com' }));
    await userRepo.delete(user);

    const found    = await userRepo.findById(user.id);
    const withDel  = await userRepo.find({ withDeleted: true });
    expect(found).toBeNull();              // excluded by default
    expect(withDel).toHaveLength(1);       // visible when withDeleted: true
  });

  test('restore() un-soft-deletes', async () => {
    const user = await userRepo.insert(Object.assign(new User(), { name: 'Alice', email: 'a@t.com' }));
    await userRepo.delete(user);
    await userRepo.restore(user.id);
    const found = await userRepo.findById(user.id);
    expect(found).not.toBeNull();
  });

  test('hardDelete() removes the row entirely', async () => {
    const user = await userRepo.insert(Object.assign(new User(), { name: 'Alice', email: 'a@t.com' }));
    await userRepo.hardDelete(user);
    const withDel = await userRepo.find({ withDeleted: true });
    expect(withDel).toHaveLength(0);
  });


  test('count() returns correct count', async () => {
    await userRepo.insert(Object.assign(new User(), { name: 'A', email: 'a@t.com' }));
    await userRepo.insert(Object.assign(new User(), { name: 'B', email: 'b@t.com' }));
    expect(await userRepo.count()).toBe(2);
  });

  test('exists() returns true when record exists', async () => {
    const user = await userRepo.insert(Object.assign(new User(), { name: 'Alice', email: 'a@t.com' }));
    expect(await userRepo.exists({ id: user.id })).toBe(true);
    expect(await userRepo.exists({ id: 'nope' })).toBe(false);
  });

  

  test('upsert() inserts when not found', async () => {
    const user  = Object.assign(new User(), { name: 'Alice', email: 'alice@upsert.com' });
    await userRepo.upsert(user, 'email');
    expect(await userRepo.count()).toBe(1);
  });

  test('upsert() updates when found', async () => {
    const user = await userRepo.insert(Object.assign(new User(), { name: 'Alice', email: 'alice@upsert.com' }));
    const dup  = Object.assign(new User(), { id: user.id, name: 'Alice Updated', email: 'alice@upsert.com' });
    await userRepo.upsert(dup, 'email');
    const found = await userRepo.findOneBy({ email: 'alice@upsert.com' });
    expect(found?.name).toBe('Alice Updated');
    expect(await userRepo.count()).toBe(1);
  });

  // ── PAGINATION ────────────────────────────────────────────────────────────

  test('paginate() returns correct structure', async () => {
    for (let i = 0; i < 7; i++) {
      await userRepo.insert(Object.assign(new User(), { name: `U${i}`, email: `u${i}@t.com` }));
    }
    const page = await userRepo.paginate(2, 3);
    expect(page.data).toHaveLength(3);
    expect(page.total).toBe(7);
    expect(page.lastPage).toBe(3);
    expect(page.page).toBe(2);
  });

  // ── QUERY BUILDER access ──────────────────────────────────────────────────

  test('createQueryBuilder() returns a working builder', async () => {
    await userRepo.insert(Object.assign(new User(), { name: 'Alice', email: 'a@t.com', age: 25 }));
    await userRepo.insert(Object.assign(new User(), { name: 'Bob', email: 'b@t.com', age: 30 }));

    const count = await userRepo.createQueryBuilder()
      .where('age', '>', 26)
      .getCount();
    expect(count).toBe(1);
  });

  // ── TRANSACTION ───────────────────────────────────────────────────────────

  test('transaction() commits all operations', async () => {
    await ds.transaction(async (tx) => {
      const repo = tx.getRepository(User);
      await repo.insert(Object.assign(new User(), { name: 'TxUser', email: 'tx@t.com' }));
    });
    expect(await userRepo.count()).toBe(1);
  });

  test('transaction() rolls back on error', async () => {
    try {
      await ds.transaction(async (tx) => {
        const repo = tx.getRepository(User);
        await repo.insert(Object.assign(new User(), { name: 'TxUser', email: 'tx@t.com' }));
        throw new Error('abort!');
      });
    } catch {
      // expected
    }
    expect(await userRepo.count()).toBe(0);
  });

  // ── saveMany ──────────────────────────────────────────────────────────────

  test('saveMany() persists all entities', async () => {
    const users = [
      Object.assign(new User(), { name: 'A', email: 'a@t.com' }),
      Object.assign(new User(), { name: 'B', email: 'b@t.com' }),
      Object.assign(new User(), { name: 'C', email: 'c@t.com' }),
    ];
    await userRepo.saveMany(users);
    expect(await userRepo.count()).toBe(3);
  });
});
