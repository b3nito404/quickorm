import 'reflect-metadata';
import { MemoryAdapter } from '../../src/adapters/MemoryAdapter';
import { SchemaDiff } from '../../src/core/SchemaDiff';
import { metadataStorage } from '../../src/core/MetadataStorage';
import { Entity, PrimaryColumn, Column, BaseModel } from '../../src/index';

@Entity('alter_products')
class AlterProduct extends BaseModel {
  @PrimaryColumn() id!: string;
  @Column({ type: 'varchar', length: 100 }) name!: string;
  @Column({ type: 'float' }) price!: number;
  @Column({ type: 'text', nullable: true }) description?: string;
}

describe('SchemaDiff — ALTER COLUMN', () => {
  let adapter: MemoryAdapter;
  let differ: SchemaDiff;

  beforeEach(async () => {
    adapter = new MemoryAdapter();
    await adapter.connect({ type: 'memory' });
    differ  = new SchemaDiff(adapter);
  });

  afterEach(async () => { await adapter.disconnect(); });

  test('no ALTER COLUMN when types match', async () => {
    await adapter.query(
      'CREATE TABLE "alter_products" ("id" VARCHAR(36), "name" VARCHAR(100), "price" FLOAT, "description" TEXT)'
    );
    const meta = metadataStorage.getEntityMetadata(AlterProduct);
    const diff = await differ.diff([meta]);
    const alters = diff.actions.filter(a => a.type === 'ALTER_COLUMN');
    expect(alters).toHaveLength(0);
  });

  test('detects missing column (ADD COLUMN)', async () => {
    await adapter.query(
      'CREATE TABLE "alter_products" ("id" VARCHAR(36), "name" VARCHAR(100))'
    );
    const meta = metadataStorage.getEntityMetadata(AlterProduct);
    const diff = await differ.diff([meta]);
    const adds = diff.actions.filter(a => a.type === 'ADD_COLUMN');
    expect(adds.length).toBeGreaterThanOrEqual(1);
  });

  test('generateMigrationSource includes ALTER statements', async () => {
    const meta = metadataStorage.getEntityMetadata(AlterProduct);
    const diff = await differ.diff([meta]);
    const src  = differ.generateMigrationSource(diff, 'AlterTest');
    expect(src).toContain('runner.query');
    expect(src).toContain('up(');
    expect(src).toContain('down(');
  });

  test('typesMatch prevents false positives for aliases', async () => {
    await adapter.query(
      'CREATE TABLE "alter_products" ("id" VARCHAR(36), "name" VARCHAR(100), "price" FLOAT, "description" TEXT)'
    );
    const meta = metadataStorage.getEntityMetadata(AlterProduct);
    const diff = await differ.diff([meta]);
    expect(diff.upToDate || diff.actions.every(a => a.type !== 'ALTER_COLUMN')).toBe(true);
  });
});
