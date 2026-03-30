import 'reflect-metadata';
import { MemoryAdapter } from '../../src/adapters/MemoryAdapter';
import { SchemaDiff } from '../../src/core/SchemaDiff';
import { metadataStorage } from '../../src/core/MetadataStorage';
import { Entity, PrimaryColumn, Column, Index } from '../../src/index';
import { BaseModel } from '../../src/models/BaseModel';

@Entity('diff_products')
class DiffProduct extends BaseModel {
  @PrimaryColumn() id!: string;
  @Column({ type: 'varchar', length: 100 }) name!: string;
  @Column({ type: 'decimal', precision: 10, scale: 2 }) price!: number;
  @Index()
  @Column({ type: 'varchar', length: 50, nullable: true }) sku?: string;
}

@Entity('diff_orders')
class DiffOrder extends BaseModel {
  @PrimaryColumn() id!: string;
  @Column({ type: 'varchar' }) status!: string;
}

describe('SchemaDiff', () => {
  let adapter: MemoryAdapter;
  let differ: SchemaDiff;

  beforeEach(async () => {
    adapter = new MemoryAdapter();
    await adapter.connect({ type: 'memory' });
    differ  = new SchemaDiff(adapter);
  });

  afterEach(async () => {
    await adapter.disconnect();
  });

  test('detects tables that need to be created', async () => {
    const meta = metadataStorage.getEntityMetadata(DiffProduct);
    const diff = await differ.diff([meta]);

    expect(diff.upToDate).toBe(false);
    expect(diff.actions.some((a) => a.type === 'CREATE_TABLE')).toBe(true);
    expect(diff.actions.some((a) => a.tableName === 'diff_products')).toBe(true);
    expect(diff.summary).toContain('table');
  });

  test('reports up-to-date when table already exists with all columns', async () => {
    // Create the table first
    await adapter.query(
      'CREATE TABLE "diff_orders" ("id" VARCHAR(36), "status" VARCHAR(255))'
    );
    const meta = metadataStorage.getEntityMetadata(DiffOrder);
    const diff = await differ.diff([meta]);

    // Should have no CREATE_TABLE action for diff_orders
    const creates = diff.actions.filter(
      (a) => a.type === 'CREATE_TABLE' && a.tableName === 'diff_orders'
    );
    expect(creates).toHaveLength(0);
  });

  test('detects missing columns on existing table', async () => {
    // Create table without the price column
    await adapter.query(
      'CREATE TABLE "diff_products" ("id" VARCHAR(36), "name" VARCHAR(100))'
    );
    const meta = metadataStorage.getEntityMetadata(DiffProduct);
    const diff = await differ.diff([meta]);

    const addCols = diff.actions.filter((a) => a.type === 'ADD_COLUMN');
    const colNames = addCols.map((a) => a.sql);
    expect(addCols.length).toBeGreaterThanOrEqual(1);
    expect(diff.summary).toContain('column');
  });

  test('apply() executes all actions', async () => {
    const meta = metadataStorage.getEntityMetadata(DiffProduct);
    const diff = await differ.diff([meta]);
    await differ.apply(diff);

    // Table should now exist
    expect(adapter.tableExists('diff_products')).toBe(true);
  });

  test('sync() is idempotent — second call has no actions', async () => {
    const meta = metadataStorage.getEntityMetadata(DiffProduct);
    await differ.sync([meta]);

    // Second sync memory adapter tables exist, no new columns to add
    const diff2 = await differ.diff([meta]);
    const creates = diff2.actions.filter((a) => a.type === 'CREATE_TABLE');
    expect(creates).toHaveLength(0);
  });

  test('generateMigrationSource() produces valid TypeScript', async () => {
    const meta = metadataStorage.getEntityMetadata(DiffProduct);
    const diff = await differ.diff([meta]);
    const src  = differ.generateMigrationSource(diff, 'CreateDiffProducts');

    expect(src).toContain('extends Migration');
    expect(src).toContain('async up(');
    expect(src).toContain('async down(');
    expect(src).toContain('runner.query');
  });

  test('diff summary is human-readable', async () => {
    const meta = metadataStorage.getEntityMetadata(DiffProduct);
    const diff = await differ.diff([meta]);
    expect(typeof diff.summary).toBe('string');
    expect(diff.summary.length).toBeGreaterThan(0);
    console.log('  Summary:', diff.summary);
  });

  test('DiffAction has reverseSql for CREATE_TABLE', async () => {
    const meta    = metadataStorage.getEntityMetadata(DiffProduct);
    const diff    = await differ.diff([meta]);
    const creates = diff.actions.filter((a) => a.type === 'CREATE_TABLE');
    expect(creates[0].reverseSql).toContain('DROP TABLE');
  });
});
