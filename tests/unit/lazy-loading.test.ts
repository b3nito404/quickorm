import 'reflect-metadata';
import {
  Entity, PrimaryColumn, Column,
  ManyToOne, OneToMany, BaseModel,
} from '../../src/index';
import { DataSource } from '../../src/core/DataSource';

@Entity('lazy_teams')
class LazyTeam extends BaseModel {
  @PrimaryColumn() id!: string;
  @Column({ type: 'varchar' }) name!: string;
}

@Entity('lazy_members')
class LazyMember extends BaseModel {
  @PrimaryColumn() id!: string;
  @Column({ type: 'varchar' }) name!: string;
  @Column({ type: 'varchar', nullable: true }) team_id?: string;

  @ManyToOne({ target: () => LazyTeam, foreignKey: 'team_id', lazy: true })
  team!: Promise<LazyTeam | null>;
}

describe('Lazy loading', () => {
  let ds: DataSource;

  beforeEach(async () => {
    ds = new DataSource({
      type: 'memory',
      entities: [LazyTeam, LazyMember],
      synchronize: true,
      logging: false,
    });
    await ds.connect();

    const teamRepo   = ds.getRepository(LazyTeam);
    const memberRepo = ds.getRepository(LazyMember);

    const team = Object.assign(new LazyTeam(), { name: 'Alpha' });
    await teamRepo.insert(team);

    const alice = Object.assign(new LazyMember(), { name: 'Alice', team_id: team.id });
    const bob   = Object.assign(new LazyMember(), { name: 'Bob' });
    await memberRepo.saveMany([alice, bob]);
  });

  afterEach(async () => { await ds.disconnect(); });

  test('lazy relation is a Promise', async () => {
    const repo    = ds.getRepository(LazyMember);
    const members = await repo.findAll();
    const alice   = members.find(m => m.name === 'Alice')!;
    expect(alice.team).toBeInstanceOf(Promise);
  });

  test('awaiting the Promise loads the relation', async () => {
    const repo   = ds.getRepository(LazyMember);
    const alice  = (await repo.findOneBy({ name: 'Alice' } as any))!;
    const team   = await alice.team;
    expect(team).not.toBeNull();
    expect(team?.name).toBe('Alpha');
  });

  test('null FK resolves to null', async () => {
    const repo  = ds.getRepository(LazyMember);
    const bob   = (await repo.findOneBy({ name: 'Bob' } as any))!;
    const team  = await bob.team;
    expect(team).toBeNull();
  });

  test('second await uses cached value (no extra query)', async () => {
    const repo   = ds.getRepository(LazyMember);
    const alice  = (await repo.findOneBy({ name: 'Alice' } as any))!;

    const adapter = ds.getAdapter() as any;
    const orig    = adapter.query.bind(adapter);
    let queries   = 0;
    adapter.query = async (sql: string, p: any[]) => {
      if (/lazy_teams/i.test(sql)) queries++;
      return orig(sql, p);
    };

    await alice.team;
    await alice.team;
    expect(queries).toBe(1);  // second call hits cache

    adapter.query = orig;
  });
});
