#!/usr/bin/env node
import * as fs   from 'fs';
import * as path from 'path';

const [, , command, ...args] = process.argv;

//thieses are colors helpers
const C = {
  green:  (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  red:    (s: string) => `\x1b[31m${s}\x1b[0m`,
  cyan:   (s: string) => `\x1b[36m${s}\x1b[0m`,
  dim:    (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold:   (s: string) => `\x1b[1m${s}\x1b[0m`,
};

//Flag parsing
function flag(name: string, fallback: string): string {
  const idx = args.indexOf(name);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
}
function hasFlag(name: string): boolean {
  return args.includes(name);
}

const migrationsDir = flag('--dir', 'src/migrations');

function printHelp(): void {
  console.log(`
${C.bold(C.cyan('QuickORM CLI'))}  v1.0.0

${C.bold('USAGE')}
  quickorm <command> [options]

${C.bold('MIGRATION COMMANDS')}
  ${C.green('migration:create')} <Name>    Generate a new migration file
  ${C.green('migration:list')}             Show executed / pending migrations  ${C.dim('(requires config)')}
  ${C.green('migration:run')}              Run all pending migrations           ${C.dim('(requires config)')}
  ${C.green('migration:revert')}           Undo the last migration              ${C.dim('(requires config)')}

${C.bold('SCHEMA COMMANDS')}
  ${C.green('schema:diff')}                Compare metadata vs live DB and print what would change
  ${C.green('schema:sync')}                Apply all pending schema changes (non-destructive)
  ${C.green('schema:generate')} <Name>     Generate a migration file from the current schema diff

${C.bold('OPTIONS')}
  --dir   <path>    Directory for migration files  ${C.dim('(default: src/migrations)')}
  --config <path>   Path to quickorm.config.ts      ${C.dim('(default: quickorm.config.ts)')}
  --help            Show this message

${C.bold('EXAMPLES')}
  ${C.dim('# Create a new blank migration')}
  quickorm migration:create AddEmailIndexToUsers

  ${C.dim('# Generate a migration from the diff between your entities and the live DB')}
  quickorm schema:generate AddAgeColumn

  ${C.dim('# Print what schema changes are pending (no DB changes made)')}
  quickorm schema:diff
`);
}

function cmdMigrationCreate(name: string): void {
  const timestamp = Date.now();
  const className = `${name}${timestamp}`;
  const filename  = `${timestamp}-${name}.ts`;
  const outDir    = path.resolve(process.cwd(), migrationsDir);
  const outPath   = path.join(outDir, filename);

  const src = `import { Migration, QueryRunner } from 'quickorm';

export class ${className} extends Migration {
  name = '${className}';

  async up(runner: QueryRunner): Promise<void> {
    // TODO: implement migration
    //
    // Examples:
    // await runner.createTable('users', [
    //   { name: 'id',    type: 'uuid',    primary: true, nullable: false },
    //   { name: 'email', type: 'varchar', length: 255,   nullable: false, unique: true },
    //   { name: 'name',  type: 'varchar', length: 100,   nullable: false },
    //   { name: 'created_at', type: 'timestamp', nullable: false },
    // ]);
    //
    // await runner.addColumn('users', { name: 'age', type: 'int', nullable: true });
    //
    // await runner.createIndex('users', ['email'], true /* unique */);
    //
    // await runner.query('ALTER TABLE users ADD COLUMN bio TEXT');
  }

  async down(runner: QueryRunner): Promise<void> {
    // TODO: implement rollback
    // await runner.dropTable('users');
    // await runner.dropColumn('users', 'age');
  }
}
`;

  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
    console.log(C.dim(`  Created directory: ${outDir}`));
  }

  fs.writeFileSync(outPath, src, 'utf8');
  console.log(`${C.green('passed')} Migration created: ${C.cyan(outPath)}`);
  console.log(C.dim(`   Class: ${className}`));
}

//schema:diff
async function cmdSchemaDiff(): Promise<void> {
  console.log(C.yellow('Warn : schema:diff requires a quickorm.config.ts file.'));
  printConfigInstructions('diff');
}

async function cmdSchemaSync(): Promise<void> {
  console.log(C.yellow('Warn : schema:sync requires a quickorm.config.ts file.'));
  printConfigInstructions('sync');
}

async function cmdSchemaGenerate(name: string): Promise<void> {
  console.log(C.yellow('Warn :  schema:generate requires a quickorm.config.ts file.'));
  printConfigInstructions('generate', name);
}

function printConfigInstructions(cmd: string, name?: string): void {
  console.log(`
${C.bold('To use schema commands from the CLI, create a quickorm.config.ts:')}

${C.dim('// quickorm.config.ts')}
import { DataSource } from 'quickorm';
import { User, Post } from './src/entities';

export default new DataSource({
  type: 'postgres',
  host: 'localhost',
  database: 'mydb',
  username: 'postgres',
  password: 'secret',
  entities: [User, Post],
});

${C.bold('Then use the DataSource API directly in a script:')}

${C.dim('// scripts/schema-diff.ts')}
import ds from '../quickorm.config';
await ds.connect();
const diff = await ds.diff();
console.log(diff.summary);
diff.actions.forEach(a => console.log(' •', a.description));
${cmd === 'generate' ? `const src = ds.generateMigration(diff, '${name ?? 'MyMigration'}');
// fs.writeFileSync('./src/migrations/...', src);` : ''}
await ds.disconnect();
`);
}

//Router
if (!command || hasFlag('--help') || hasFlag('-h') || command === 'help') {
  printHelp();
  process.exit(0);
}

(async () => {
  switch (command) {
    case 'migration:create': {
      const name = args.find((a) => !a.startsWith('--'));
      if (!name) {
        console.error(C.red('Fail :Name required: quickorm migration:create <Name>'));
        process.exit(1);
      }
      cmdMigrationCreate(name);
      break;
    }

    case 'migration:run':
    case 'migration:revert':
    case 'migration:list':
      console.log(C.yellow(`Warn :  "${command}" requires a quickorm.config.ts.`));
      printConfigInstructions(command);
      break;

    case 'schema:diff':
      await cmdSchemaDiff();
      break;

    case 'schema:sync':
      await cmdSchemaSync();
      break;

    case 'schema:generate': {
      const name = args.find((a) => !a.startsWith('--')) ?? 'SchemaDiff';
      await cmdSchemaGenerate(name);
      break;
    }

    default:
      console.error(C.red(`Failed : Unknown command: "${command}"`));
      console.log(`Run ${C.cyan('quickorm --help')} for usage.`);
      process.exit(1);
  }
})();
