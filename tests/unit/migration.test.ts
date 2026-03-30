import 'reflect-metadata';
import { MigrationRunner } from '../../src/migrations/MigrationRunner';
import { Migration } from '../../src/migrations/Migration';
import { MemoryAdapter } from '../../src/adapters/MemoryAdapter';
import { QueryRunner } from '../../src/types';

class CreateUsersTable extends Migration {
  name = 'CreateUsersTable';

  async up(runner: QueryRunner): Promise<void> {
    await runner.createTable('users', [
      { name: 'id',    type: 'uuid',    primary: true, nullable: false },
      { name: 'email', type: 'varchar', length: 255,   nullable: false },
    ]);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.dropTable('users');
  }
}

class AddNameToUsers extends Migration {
  name = 'AddNameToUsers';

  async up(runner: QueryRunner): Promise<void> {
    await runner.addColumn('users', {
      name: 'name', type: 'varchar', length: 100, nullable: true,
    });
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.dropColumn('users', 'name');
  }
}

describe('MigrationRunner', () => {
  let adapter: MemoryAdapter;
  let runner: MigrationRunner;

  beforeEach(async () => {
    adapter = new MemoryAdapter();
    await adapter.connect({ type: 'memory' });
    runner = new MigrationRunner(adapter);
  });

  afterEach(async () => {
    await adapter.disconnect();
  });

  test('runs pending migrations in order', async () => {
    await runner.run([CreateUsersTable, AddNameToUsers]);
    const executed = await runner.getExecutedMigrations();
    expect(executed).toContain('CreateUsersTable');
    expect(executed).toContain('AddNameToUsers');
  });

  test('skips already-executed migrations', async () => {
    await runner.run([CreateUsersTable]);
    await runner.run([CreateUsersTable, AddNameToUsers]);
    const executed = await runner.getExecutedMigrations();
    expect(executed).toHaveLength(2);
  });

  test('run() with no pending migrations does not throw', async () => {
    await expect(runner.run([])).resolves.not.toThrow();
  });
});
