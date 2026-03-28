import { MigrationInterface, QueryRunner } from '../types';

/**
 * Extend this class to create a migration.
 *
 * @example
 * export class CreateUsersTable1700000000000 extends Migration {
 *   name = 'CreateUsersTable1700000000000';
 *
 *   async up(runner: QueryRunner): Promise<void> {
 *     await runner.createTable('users', [
 *       { name: 'id',         type: 'uuid',    primary: true, nullable: false },
 *       { name: 'email',      type: 'varchar', length: 255, unique: true, nullable: false },
 *       { name: 'created_at', type: 'timestamp', nullable: false },
 *     ]);
 *   }
 *
 *   async down(runner: QueryRunner): Promise<void> {
 *     await runner.dropTable('users');
 *   }
 * }
 */
export abstract class Migration implements MigrationInterface {
  abstract name: string;
  abstract up(runner: QueryRunner): Promise<void>;
  abstract down(runner: QueryRunner): Promise<void>;
}
