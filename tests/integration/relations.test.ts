import 'reflect-metadata';
import {
  Entity, PrimaryColumn, Column, ManyToOne, OneToMany,
  ManyToMany, JoinTable, BaseModel,
} from '../../src/index';
import { DataSource } from '../../src/core/DataSource';
import { Repository } from '../../src/repositories/Repository';

// ─── Leaf entities ────────────────────────────────────────────────────────────

@Entity('rel_tags')
class RelTag extends BaseModel {
  @PrimaryColumn() id!: string;
  @Column({ type: 'varchar', length: 50 }) label!: string;
}

// ─── Team + Member (circular via OneToMany/ManyToOne) ─────────────────────────
// Strategy: declare property on Team, then apply the decorator imperatively
// AFTER Member class is defined.

@Entity('rel_teams')
class Team extends BaseModel {
  @PrimaryColumn() id!: string;
  @Column({ type: 'varchar', length: 100 }) name!: string;
  members?: Member[];   // typed here; decorator applied below
}

@Entity('rel_members')
class Member extends BaseModel {
  @PrimaryColumn() id!: string;
  @Column({ type: 'varchar', length: 100 }) name!: string;
  @Column({ type: 'varchar', nullable: true }) team_id?: string;
  @ManyToOne({ target: () => Team, foreignKey: 'team_id' }) team?: Team;
}

// Apply OneToMany AFTER Member is fully defined
OneToMany({ target: () => Member, foreignKey: 'team_id', inverseSide: 'team' })(Team.prototype, 'members');

// ─── RelPost + RelAuthor ──────────────────────────────────────────────────────

@Entity('rel_posts')
class RelPost extends BaseModel {
  @PrimaryColumn() id!: string;
  @Column({ type: 'varchar', length: 200 }) title!: string;
  @Column({ type: 'varchar', nullable: true }) author_id?: string;
  author?: RelAuthor;   // typed; decorator applied below
  @ManyToMany({ target: () => RelTag })
  @JoinTable({ name: 'rel_post_tags', joinColumn: 'post_id', inverseJoinColumn: 'tag_id' })
  tags?: RelTag[];
}

@Entity('rel_authors')
class RelAuthor extends BaseModel {
  @PrimaryColumn() id!: string;
  @Column({ type: 'varchar', length: 100 }) name!: string;
  @OneToMany({ target: () => RelPost, foreignKey: 'author_id', inverseSide: 'author' })
  posts?: RelPost[];
}

// Apply ManyToOne on RelPost → RelAuthor after RelAuthor is defined
ManyToOne({ target: () => RelAuthor, foreignKey: 'author_id' })(RelPost.prototype, 'author');

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Relations with N+1 DataLoader batching', () => {
  let ds: DataSource;
  let teamRepo: Repository<Team>;
  let memberRepo: Repository<Member>;
  let postRepo: Repository<RelPost>;
  let authorRepo: Repository<RelAuthor>;
  let tagRepo: Repository<RelTag>;

  beforeEach(async () => {
    ds = new DataSource({
      type: 'memory',
      entities: [Team, Member, RelPost, RelAuthor, RelTag],
      synchronize: true,
      logging: false,
    });
    await ds.connect();
    teamRepo   = ds.getRepository(Team);
    memberRepo = ds.getRepository(Member);
    postRepo   = ds.getRepository(RelPost);
    authorRepo = ds.getRepository(RelAuthor);
    tagRepo    = ds.getRepository(RelTag);

    const teamA = Object.assign(new Team(), { name: 'Alpha' });
    const teamB = Object.assign(new Team(), { name: 'Beta'  });
    await teamRepo.saveMany([teamA, teamB]);

    const alice = Object.assign(new Member(), { name: 'Alice', team_id: teamA.id });
    const bob   = Object.assign(new Member(), { name: 'Bob',   team_id: teamA.id });
    const carol = Object.assign(new Member(), { name: 'Carol', team_id: teamB.id });
    await memberRepo.saveMany([alice, bob, carol]);

    const author = Object.assign(new RelAuthor(), { name: 'Dave' });
    await authorRepo.insert(author);

    const tag1 = Object.assign(new RelTag(), { label: 'typescript' });
    const tag2 = Object.assign(new RelTag(), { label: 'orm' });
    await tagRepo.saveMany([tag1, tag2]);

    const post1 = Object.assign(new RelPost(), { title: 'Intro to QuickORM', author_id: author.id });
    const post2 = Object.assign(new RelPost(), { title: 'Advanced Relations',  author_id: author.id });
    await postRepo.saveMany([post1, post2]);

    const adapter = ds.getAdapter() as any;
    adapter.ensureTable('rel_post_tags');
    adapter.getTable('rel_post_tags').push({ post_id: post1.id, tag_id: tag1.id });
    adapter.getTable('rel_post_tags').push({ post_id: post1.id, tag_id: tag2.id });
    adapter.getTable('rel_post_tags').push({ post_id: post2.id, tag_id: tag1.id });
  });

  afterEach(async () => { await ds.disconnect(); });

  // ── ManyToOne ─────────────────────────────────────────────────────────────

  test('ManyToOne: loads parent team onto each member', async () => {
    const members = await memberRepo.find({ relations: ['team'] });
    expect(members).toHaveLength(3);
    for (const m of members) expect(m.team).not.toBeNull();
    expect(members.find((m) => m.name === 'Alice')?.team?.name).toBe('Alpha');
    expect(members.find((m) => m.name === 'Carol')?.team?.name).toBe('Beta');
  });

  test('ManyToOne: null FK → null relation', async () => {
    const orphan = Object.assign(new Member(), { name: 'Orphan' });
    await memberRepo.insert(orphan);
    const [found] = await memberRepo.find({ where: { name: 'Orphan' } as any, relations: ['team'] });
    expect(found.team).toBeNull();
  });

  // ── OneToMany ─────────────────────────────────────────────────────────────

  test('OneToMany: loads children members onto teams', async () => {
    const teams = await teamRepo.find({ relations: ['members'] });
    const alpha = teams.find((t) => t.name === 'Alpha');
    const beta  = teams.find((t) => t.name === 'Beta');
    expect(alpha?.members).toHaveLength(2);
    expect(beta?.members).toHaveLength(1);
    expect(alpha?.members?.map((m) => m.name).sort()).toEqual(['Alice', 'Bob']);
  });

  test('OneToMany: empty array when no children exist', async () => {
    const empty = Object.assign(new Team(), { name: 'Empty' });
    await teamRepo.insert(empty);
    const [found] = await teamRepo.find({ where: { name: 'Empty' } as any, relations: ['members'] });
    expect(found.members).toEqual([]);
  });

  // ── Anti-N+1 proof ────────────────────────────────────────────────────────

  test('3 members fire exactly ONE team SELECT (DataLoader anti-N+1)', async () => {
    const adapter = ds.getAdapter() as any;
    const orig    = adapter.query.bind(adapter);
    let teamQueries = 0;
    adapter.query = async (sql: string, params: any[]) => {
      if (/WHERE/i.test(sql) && /rel_teams/i.test(sql)) teamQueries++;
      return orig(sql, params);
    };
    await memberRepo.find({ relations: ['team'] });
    expect(teamQueries).toBe(1);   // batched — NOT 3
    adapter.query = orig;
  });

  // ── ManyToMany ────────────────────────────────────────────────────────────

  test('ManyToMany: loads tags onto posts via join table', async () => {
    const posts = await postRepo.find({ relations: ['tags'] });
    const intro = posts.find((p) => p.title === 'Intro to QuickORM');
    const adv   = posts.find((p) => p.title === 'Advanced Relations');
    expect(intro?.tags).toHaveLength(2);
    expect(adv?.tags).toHaveLength(1);
    expect(intro?.tags?.map((t) => t.label).sort()).toEqual(['orm', 'typescript']);
  });

  test('ManyToMany: empty array when no join rows', async () => {
    const lone = Object.assign(new RelPost(), { title: 'No Tags' });
    await postRepo.insert(lone);
    const [found] = await postRepo.find({ where: { title: 'No Tags' } as any, relations: ['tags'] });
    expect(found.tags).toEqual([]);
  });

  // ── author → posts (OneToMany) ────────────────────────────────────────────

  test('OneToMany: loads posts onto author', async () => {
    const authors = await authorRepo.find({ relations: ['posts'] });
    expect(authors[0].posts).toHaveLength(2);
    expect(authors[0].posts?.map((p) => p.title).sort()).toEqual([
      'Advanced Relations', 'Intro to QuickORM',
    ]);
  });

  // ── ManyToOne via post → author ───────────────────────────────────────────

  test('ManyToOne: loads author onto each post', async () => {
    const posts = await postRepo.find({ relations: ['author'] });
    for (const p of posts) {
      expect(p.author).not.toBeNull();
      expect(p.author?.name).toBe('Dave');
    }
  });
});
