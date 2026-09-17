#!/usr/bin/env bash
# Applies the migrations to a scratch database and runs the schema assertions.
#
#   ./supabase/tests/run.sh                       # uses a local postgres
#   PGURL=postgres://... ./supabase/tests/run.sh   # or an explicit target
#
# Point this at a throwaway database: it creates the schema from scratch.
set -euo pipefail

cd "$(dirname "$0")/../.."
PGURL="${PGURL:-postgres://postgres@localhost:5432/pft_test}"

psql "$PGURL" -v ON_ERROR_STOP=1 -q \
  -f supabase/tests/_prelude.sql \
  -f supabase/migrations/0001_init.sql \
  -f supabase/migrations/0002_rpc.sql \
  -f supabase/tests/schema_test.sql
