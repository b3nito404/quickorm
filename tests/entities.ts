import 'reflect-metadata';
import {
  Entity,
  PrimaryColumn,
  Column,
  CreatedAt,
  UpdatedAt,
  DeletedAt,
  ManyToOne,
  OneToMany,
  BeforeInsert,
  AfterInsert,
  Index,
} from '../src/index';
import { BaseModel } from '../src/index';

@Entity('users')
export class User extends BaseModel {
  @PrimaryColumn()
  id!: string;

  @Column({ type: 'varchar', length: 100, nullable: false })
  name!: string;

  @Column({ type: 'varchar', length: 255, nullable: false })
  email!: string;

  @Column({ type: 'int', nullable: true })
  age?: number;

  @Column({ type: 'boolean', default: true })
  active: boolean = true;

  @CreatedAt()
  createdAt!: Date;

  @UpdatedAt()
  updatedAt?: Date;

  @DeletedAt()
  deletedAt?: Date;

  hookLog: string[] = [];

  @BeforeInsert()
  beforeInsert(): void {
    this.hookLog.push('BeforeInsert');
  }

  @AfterInsert()
  afterInsert(): void {
    this.hookLog.push('AfterInsert');
  }
}

@Entity('posts')
export class Post extends BaseModel {
  @PrimaryColumn()
  id!: string;

  @Column({ type: 'varchar', length: 255, nullable: false })
  title!: string;

  @Column({ type: 'text', nullable: true })
  body?: string;

  @Column({ type: 'boolean', default: false })
  published: boolean = false;

  @Column({ type: 'varchar', nullable: true })
  authorId?: string;

  @CreatedAt()
  createdAt!: Date;
}

@Entity('products')
export class Product extends BaseModel {
  @PrimaryColumn({ generated: 'increment', type: 'int' })
  id!: number;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  price!: number;

  @Column({ type: 'int', default: 0 })
  stock: number = 0;
}
