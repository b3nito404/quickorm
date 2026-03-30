#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# QuickORM — npm link helper
# Links QuickORM locally so you can test it in another project without publishing.
#
# Usage (from inside the quickorm/ directory):
#   chmod +x scripts/link.sh
#   ./scripts/link.sh
#
# Then in your test project:
#   npm link quickorm
# ─────────────────────────────────────────────────────────────────────────────

set -e

GREEN='\033[0;32m'
CYAN='\033[0;36m'
RESET='\033[0m'

log() { echo -e "${CYAN}▶ $1${RESET}"; }
ok()  { echo -e "${GREEN}✓ $1${RESET}"; }

# 1. Build the project
log "Building QuickORM..."
npm run build

# 2. Create the global symlink
log "Creating global npm link..."
npm link

ok "QuickORM linked globally!"
echo ""
echo -e "${GREEN}Now go to your test project and run:${RESET}"
echo ""
echo "  cd ../my-test-project"
echo "  npm link quickorm"
echo ""
echo -e "${GREEN}Then import it:${RESET}"
echo ""
echo "  import { DataSource, Entity, Column } from 'quickorm';"
echo ""
echo -e "${CYAN}To unlink later:${RESET}"
echo "  npm unlink quickorm   (in your test project)"
echo "  npm unlink            (in quickorm/ directory)"
