import 'reflect-metadata';
import { metadataStorage } from '../../src/core/MetadataStorage';
import { User, Post, Product } from '../entities';

describe('Decorators & MetadataStorage', () => {
  //@Entity 

  test('@Entity registers correct table name', () => {
    const meta = metadataStorage.getEntityMetadata(User);
    expect(meta.tableName).toBe('users');
  });

  test('@Entity registers correct table for Post', () => {
    const meta = metadataStorage.getEntityMetadata(Post);
    expect(meta.tableName).toBe('posts');
  });

  //@PrimaryColumn 

  test('@PrimaryColumn registers isPrimary=true with uuid strategy', () => {
    const pk = metadataStorage.getPrimaryColumn(User);
    expect(pk.isPrimary).toBe(true);
    expect(pk.isGenerated).toBe(true);
    expect(pk.generationStrategy).toBe('uuid');
    expect(pk.columnName).toBe('id');
  });

  test('@PrimaryColumn with increment strategy', () => {
    const pk = metadataStorage.getPrimaryColumn(Product);
    expect(pk.generationStrategy).toBe('increment');
    expect(pk.type).toBe('int');
  });

  //@Column 

  test('@Column registers all columns', () => {
    const meta  = metadataStorage.getEntityMetadata(User);
    const names = meta.columns.map((c) => c.propertyKey);
    expect(names).toContain('name');
    expect(names).toContain('email');
    expect(names).toContain('age');
    expect(names).toContain('active');
  });

  test('@Column respects options (nullable, length)', () => {
    const meta  = metadataStorage.getEntityMetadata(User);
    const email = meta.columns.find((c) => c.propertyKey === 'email');
    expect(email?.options.nullable).toBe(false);
    expect(email?.options.length).toBe(255);
  });

  test('@CreatedAt, @UpdatedAt, @DeletedAt flags', () => {
    const meta = metadataStorage.getEntityMetadata(User);
    expect(meta.columns.find((c) => c.isCreatedAt)?.propertyKey).toBe('createdAt');
    expect(meta.columns.find((c) => c.isUpdatedAt)?.propertyKey).toBe('updatedAt');
    expect(meta.columns.find((c) => c.isDeletedAt)?.propertyKey).toBe('deletedAt');
  });

  // Hooks 

  test('@BeforeInsert and @AfterInsert hooks are registered', () => {
    const meta = metadataStorage.getEntityMetadata(User);
    expect(meta.hooks.some((h) => h.type === 'BeforeInsert')).toBe(true);
    expect(meta.hooks.some((h) => h.type === 'AfterInsert')).toBe(true);
  });



  test('hasEntityMetadata() returns true for registered entities', () => {
    expect(metadataStorage.hasEntityMetadata(User)).toBe(true);
    expect(metadataStorage.hasEntityMetadata(Post)).toBe(true);
  });

  test('hasEntityMetadata() returns false for unregistered class', () => {
    class NotAnEntity {}
    expect(metadataStorage.hasEntityMetadata(NotAnEntity)).toBe(false);
  });

  test('getColumnByProperty() finds column by property name', () => {
    const col = metadataStorage.getColumnByProperty(User, 'email');
    expect(col?.columnName).toBe('email');
  });

  test('getColumnByName() finds column by DB column name', () => {
    const col = metadataStorage.getColumnByName(User, 'email');
    expect(col?.propertyKey).toBe('email');
  });
});
