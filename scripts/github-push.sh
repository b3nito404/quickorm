#!/usr/bin/env bash

set -e

REMOTE_URL="${1:-}"
BRANCH="main"

if [ -z "$REMOTE_URL" ]; then
  echo "Usage: $0 https://github.com/b3nito404/quickorm.git"
  exit 1
fi

if [ ! -d ".git" ]; then
  git init
  git branch -M "$BRANCH"
fi

if git remote get-url origin &>/dev/null; then
  git remote set-url origin "$REMOTE_URL"
else
  git remote add origin "$REMOTE_URL"
fi

git checkout --orphan fresh-history 2>/dev/null || true
git rm -rf . --quiet 2>/dev/null || true

commit() {
  local msg="$1"; shift
  for path in "$@"; do
    [ -e "$path" ] && git add "$path" 2>/dev/null || true
  done
  if ! git diff --cached --quiet; then
    git commit -m "$msg" --quiet
  fi
}

commit "chore: initial project scaffold" \
  package.json tsconfig.json tsconfig.dev.json \
  jest.config.ts .gitignore LICENSE README.md \
  .vscode/

commit "feat(types): core TypeScript types and interfaces" \
  src/types/

commit "feat(errors): typed error hierarchy" \
  src/errors/

commit "feat(utils): uuid, deepClone, logger, string helpers" \
  src/utils/

commit "feat(core): MetadataStorage singleton" \
  src/core/MetadataStorage.ts

commit "feat(decorators): Entity, Column, PrimaryColumn, CreatedAt, UpdatedAt, DeletedAt, Index, Unique" \
  src/decorators/

commit "feat(adapters): Adapter interface + BaseAdapter" \
  src/adapters/Adapter.ts

commit "feat(adapters): MemoryAdapter" \
  src/adapters/MemoryAdapter.ts

commit "feat(adapters): PostgresAdapter, MySQLAdapter, SQLiteAdapter" \
  src/adapters/PostgresAdapter.ts \
  src/adapters/MySQLAdapter.ts \
  src/adapters/SQLiteAdapter.ts

commit "feat(core): QueryBuilder" \
  src/core/QueryBuilder.ts

commit "feat(core): DataLoader" \
  src/core/DataLoader.ts

commit "feat(core): RelationLoader" \
  src/core/RelationLoader.ts

commit "feat(core): SchemaBuilder" \
  src/core/SchemaBuilder.ts

commit "feat(core): SchemaInspector" \
  src/core/SchemaInspector.ts

commit "feat(core): SchemaDiff" \
  src/core/SchemaDiff.ts

commit "feat(models): BaseModel" \
  src/models/BaseModel.ts

commit "feat(repositories): Repository" \
  src/repositories/Repository.ts

commit "feat(migrations): Migration + MigrationRunner" \
  src/migrations/

commit "feat(core): DataSource" \
  src/core/DataSource.ts

commit "feat(cli): quickorm CLI" \
  src/cli/

commit "feat: public API index" \
  src/index.ts


commit "ci: GitHub Actions" \
  .github/


git branch -M fresh-history "$BRANCH" 2>/dev/null || true
git checkout "$BRANCH" 2>/dev/null || true
git push --force origin "$BRANCH"

git log --oneline
