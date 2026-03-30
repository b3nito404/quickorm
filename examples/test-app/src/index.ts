import 'reflect-metadata';
import {
  DataSource,
  Entity, BaseModel,
  PrimaryColumn, Column,
  CreatedAt, UpdatedAt, DeletedAt,
  ManyToOne, OneToMany, ManyToMany, JoinTable,
  BeforeInsert, AfterInsert, Index,
} from 'quickorm';

//Define entities
@Entity('categories')
class Category extends BaseModel {
  @PrimaryColumn()
  id!: string;

  @Column({ type: 'varchar', length: 100, nullable: false })
  name!: string;

  @OneToMany({ target: () => Article, foreignKey: 'category_id', inverseSide: 'category' })
  articles?: Article[];

  @CreatedAt()
  createdAt!: Date;
}

@Entity('tags')
class Tag extends BaseModel {
  @PrimaryColumn()
  id!: string;

  @Column({ type: 'varchar', length: 50, nullable: false })
  name!: string;
}

@Entity('articles')
class Article extends BaseModel {
  @PrimaryColumn()
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 255, nullable: false })
  title!: string;

  @Column({ type: 'text', nullable: true })
  body?: string;

  @Column({ type: 'boolean', default: false })
  published: boolean = false;

  @Column({ type: 'varchar', nullable: true })
  category_id?: string;

  @ManyToOne({ target: () => Category, foreignKey: 'category_id' })
  category?: Category;

  @ManyToMany({ target: () => Tag })
  @JoinTable({ name: 'article_tags', joinColumn: 'article_id', inverseJoinColumn: 'tag_id' })
  tags?: Tag[];

  @CreatedAt() createdAt!: Date;
  @UpdatedAt() updatedAt?: Date;
  @DeletedAt() deletedAt?: Date;

  @BeforeInsert()
  validateTitle() {
    if (!this.title?.trim()) throw new Error('Title cannot be empty');
    this.title = this.title.trim();
  }

  @AfterInsert()
  logCreated() {
    console.log(`Article created: "${this.title}" (id: ${this.id})`);
  }
}

//Bootstrap

async function main() {
  console.log('\nQuickORM Test \n');

  const ds = new DataSource({
    type: 'memory',          // swap for 'postgres' / 'mysql' / 'sqlite' in prod
    entities: [Category, Tag, Article],
    synchronize: true,
    logging: false,
  });

  await ds.connect();
  console.log('Connected\n');

  const catRepo  = ds.getRepository(Category);
  const tagRepo  = ds.getRepository(Tag);
  const artRepo  = ds.getRepository(Article);

  //categories
  console.log('Creating categories');
  const tech    = await catRepo.save(Object.assign(new Category(), { name: 'Technology' }));
  const science = await catRepo.save(Object.assign(new Category(), { name: 'Science' }));

  //tags
  console.log('Creating tags');
  const tsTag  = await tagRepo.save(Object.assign(new Tag(), { name: 'TypeScript' }));
  const ormTag = await tagRepo.save(Object.assign(new Tag(), { name: 'ORM' }));
  const aiTag  = await tagRepo.save(Object.assign(new Tag(), { name: 'Query' }));

  //(triggers @BeforeInsert + @AfterInsert)
  console.log('\n── Creating articles');
  const art1 = await artRepo.save(Object.assign(new Article(), {
    title: '  QuickORM is here  ',   // BeforeInsert will trim this
    body:  'The fastest TypeScript ORM.',
    published: true,
    category_id: tech.id,
  }));
  const art2 = await artRepo.save(Object.assign(new Article(), {
    title: 'Neural Networks Explained',
    body:  'A deep dive into ML.',
    published: false,
    category_id: science.id,
  }));
  const art3 = await artRepo.save(Object.assign(new Article(), {
    title: 'Decorators in TypeScript',
    category_id: tech.id,
  }));

 
  const adapter = ds.getAdapter() as any;
  adapter.ensureTable('article_tags');
  adapter.getTable('article_tags').push({ article_id: art1.id, tag_id: tsTag.id  });
  adapter.getTable('article_tags').push({ article_id: art1.id, tag_id: ormTag.id });
  adapter.getTable('article_tags').push({ article_id: art2.id, tag_id: aiTag.id  });
  adapter.getTable('article_tags').push({ article_id: art3.id, tag_id: tsTag.id  });


  console.log('\nFind all articles');
  const all = await artRepo.findAll();
  console.log(`  Total: ${all.length}`);

  // anti -n+1 batching
  console.log('\nLoad articles with category + tags (anti-N+1)');
  const withRel = await artRepo.find({ relations: ['category', 'tags'] });
  for (const a of withRel) {
    const cat  = a.category?.name ?? 'none';
    const tags = a.tags?.map(t => t.name).join(', ') ?? '—';
    console.log(`  "${a.title}" → [${cat}]  tags: ${tags}`);
  }

  //Qb
  console.log('\nQueryBuilder: published articles in Technology');
  const published = await artRepo.createQueryBuilder()
    .where('published', '=', true)
    .andWhere('category_id', '=', tech.id)
    .orderBy('title', 'ASC')
    .getMany<Article>();
  console.log(`  Found: ${published.length}`);

  console.log('\nPagination (page 1, 2 per page)');
  const page = await artRepo.paginate(1, 2, { order: { title: 'ASC' } });
  console.log(`  Page 1/${page.lastPage} — ${page.data.map(a => `"${a.title}"`).join(', ')}`);

  console.log('\nUpdate: publish art2');
  await artRepo.updateById(art2.id, { published: true });
  const updated = await artRepo.findById(art2.id);
  console.log(`  art2.published = ${updated?.published}`);


  console.log('\nSoft-delete art3');
  await artRepo.delete(art3);
  const afterDelete = await artRepo.count();
  const withDeleted = await artRepo.find({ withDeleted: true });
  console.log(`  Visible: ${afterDelete}  |  Including deleted: ${withDeleted.length}`);

  //restore
  console.log('\nRestore art3');
  await artRepo.restore(art3.id);
  console.log(`Visible after restore: ${await artRepo.count()}`);

  // ups
  console.log('\nUpsert: update art1 title via upsert');
  const upsertData = Object.assign(new Article(), {
    ...art1,
    title: 'QuickORM',
  });
  await artRepo.upsert(upsertData, 'id');
  const upserted = await artRepo.findById(art1.id);
  console.log(`  New title: "${upserted?.title}"`);


  console.log('\nTransaction: create category + article atomically');
  await ds.transaction(async (tx) => {
    const catTx = tx.getRepository(Category);
    const artTx = tx.getRepository(Article);
    const newCat = await catTx.save(Object.assign(new Category(), { name: 'Philosophy' }));
    await artTx.save(Object.assign(new Article(), {
      title: 'Descartes and Code',
      category_id: newCat.id,
    }));
    console.log('  Transaction committed');
  });
  console.log('\nSchema diff');
  const diff = await ds.diff();
  console.log(`  ${diff.summary}`);

  console.log('\nLoad categories with articles (OneToMany)');
  const cats = await catRepo.find({ relations: ['articles'] });
  for (const c of cats) {
    console.log(`  ${c.name}: ${c.articles?.length ?? 0} article(s)`);
  }

  await ds.disconnect();
  console.log('\nAll done! QuickORM works\n');
}

main().catch((err) => {
  console.error('\nError:', err);
  process.exit(1);
});