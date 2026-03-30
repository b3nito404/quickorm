import 'reflect-metadata';
import {
  DataSource,
  Entity,
  PrimaryColumn,
  Column,
  CreatedAt,
  UpdatedAt,
  DeletedAt,
  ManyToOne,
  OneToMany,
  BeforeInsert,
  Index,
  BaseModel,
  Migration,
} from '../src';
import type { QueryRunner } from '../src';


@Entity('teams')
class Team extends BaseModel {
  @PrimaryColumn()
  id!: string;

  @Column({ type: 'varchar', length: 100, nullable: false })
  name!: string;

  @CreatedAt()
  createdAt!: Date;
}

@Entity('users')
class User extends BaseModel {
  @PrimaryColumn()
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 255, nullable: false })
  email!: string;

  @Column({ type: 'varchar', length: 100, nullable: false })
  name!: string;

  @Column({ type: 'int', nullable: true })
  age?: number;

  @Column({ type: 'boolean', default: true })
  active: boolean = true;

  @Column({ type: 'varchar', nullable: true })
  teamId?: string;

  @CreatedAt()
  createdAt!: Date;

  @UpdatedAt()
  updatedAt?: Date;

  @DeletedAt()
  deletedAt?: Date;

  @BeforeInsert()
  normalizeEmail(): void {
    if (this.email) this.email = this.email.toLowerCase().trim();
  }
}

//define migration

class InitialSchema extends Migration {
  name = 'InitialSchema';

  async up(runner: QueryRunner): Promise<void> {
    await runner.createTable('teams', [
      { name: 'id',         type: 'uuid',    primary: true, nullable: false },
      { name: 'name',       type: 'varchar', length: 100,   nullable: false },
      { name: 'created_at', type: 'timestamp', nullable: false },
    ]);
    await runner.createTable('users', [
      { name: 'id',         type: 'uuid',    primary: true, nullable: false },
      { name: 'email',      type: 'varchar', length: 255,   nullable: false, unique: true },
      { name: 'name',       type: 'varchar', length: 100,   nullable: false },
      { name: 'age',        type: 'int',     nullable: true },
      { name: 'active',     type: 'boolean', default: true, nullable: false },
      { name: 'team_id',    type: 'varchar', nullable: true },
      { name: 'created_at', type: 'timestamp', nullable: false },
      { name: 'updated_at', type: 'timestamp', nullable: true },
      { name: 'deleted_at', type: 'timestamp', nullable: true },
    ]);
    await runner.createIndex('users', ['email'], true);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.dropTable('users');
    await runner.dropTable('teams');
  }
}

//Bootstrap

async function main() {
  const ds = new DataSource({
    type: 'memory',
    entities: [Team, User],
    synchronize: true,
    logging: true,
  });

  await ds.connect();
  console.log('\nConnected to QuickORM (memory adapter)\n');

  const teamRepo = ds.getRepository(Team);
  const userRepo = ds.getRepository(User);

  const team = Object.assign(new Team(), { name: 'Engineering' });
  await teamRepo.save(team);

  const alice = Object.assign(new User(), {
    name:   'test1',
    email:  'test1@Example.COM',   // BeforeInsert will lowercase this
    age:    28,
    teamId: team.id,
  });
  const bob = Object.assign(new User(), {
    name:   'test2',
    email:  'test2@example.com',
    age:    34,
    teamId: team.id,
  });
  const carol = Object.assign(new User(), {
    name:  'test3',
    email: 'test4@example.com',
    age:   22,
  });

  await userRepo.saveMany([alice, bob, carol]);

  const all = await userRepo.findAll();
  console.log(`\nAll users (${all.length}):`);
  all.forEach((u) => console.log(`  - ${u.name} <${u.email}> (age: ${u.age})`));


  const foundAlice = await userRepo.findOneBy({ email: 'test1@example.com' });
  console.log(`\nFound test1 by lowercased email: ${foundAlice?.name}`);

  const seniors = await userRepo.createQueryBuilder()
    .where('age', '>=', 30)
    .orderBy('name', 'ASC')
    .getMany<User>();
  console.log(`\nUsers aged 30+: ${seniors.map((u) => u.name).join(', ')}`);

  const page = await userRepo.paginate(1, 2);
  console.log(`\nPage 1 (2 per page): ${page.data.map((u) => u.name).join(', ')} — total: ${page.total}`);


  await userRepo.updateById(carol.id, { age: 23 });
  console.log(`\nUpdated test3's age`);

  await userRepo.delete(bob);
  const afterDelete = await userRepo.count();
  console.log(`\nSoft-deleted test2 remaining: ${afterDelete} (test3 + test1)`);

  const withDel = await userRepo.find({ withDeleted: true });
  console.log(`   With soft-deleted included: ${withDel.length}`);

  await userRepo.restore(bob.id);
  console.log(`\nRestored test2 count: ${await userRepo.count()}`);

  console.log('\nRunning transaction…');
  await ds.transaction(async (tx) => {
    const repo = tx.getRepository(User);
    const dave = Object.assign(new User(), { name: 'test4', email: 'test4@example.com', age: 40 });
    await repo.insert(dave);
    await repo.updateById(alice.id, { active: false });
    console.log('   Inserted test4 and deactivated test1 — committing…');
  });


  const dup = Object.assign(new User(), { id: alice.id, name: 'Alice Wonderland', email: 'alice@example.com' });
  await userRepo.upsert(dup, 'email');
  const updAlice = await userRepo.findOneBy({ email: 'alice@example.com' });
  console.log(`\nUpserted test1: ${updAlice?.name}`);

 //aggreg
  const total = await userRepo.count();
  console.log(`\nTotal users: ${total}`);
  console.log(`   Exists (age=40): ${await userRepo.exists({ age: 40 })}`);

  await ds.disconnect();
  console.log('\nDisconnected. Done!\n');
}

main().catch(console.error);
