#!/usr/bin/env bash
# infra/backup/restore.sh ENCRYPTED_DUMP AGE_IDENTITY_FILE
#
# Restores a backup made by dump.sh into a scratch database in local Docker Postgres (docs/13 §2,
# "S3 dump" restore path). CI's backup-restore job runs it on every pull request, and Yuta runs it on
# a real dump from S3 before M1 and then quarterly. It never touches Neon.
#
# The target is dropped and re-created, bootstrapped like a Neon branch (infra/db/bootstrap.sql),
# then restored as the superuser in one transaction that stops at the first error. The roles are
# cluster-wide and already exist, so ownership and grants come back as production has them.
#
#   RESTORE_DB  default overload_restore. Anything not starting with overload_restore is refused.
#   PG_EXEC     how to run a command inside the Postgres container.
#               Default: docker compose exec -T postgres. CI: docker exec -i <service id>.
#
# Then run the API's tests against it:
#   TEST_DATABASE_URL=postgres://overload_app:overload_app_dev@localhost:5434/overload_restore \
#   TEST_DATABASE_URL_DIRECT='postgres://overload_owner:overload_owner_dev@localhost:5434/overload_restore?sslmode=disable' \
#   pnpm test
set -euo pipefail

encrypted=${1:?usage: infra/backup/restore.sh ENCRYPTED_DUMP AGE_IDENTITY_FILE}
identity=${2:?usage: infra/backup/restore.sh ENCRYPTED_DUMP AGE_IDENTITY_FILE}
db=${RESTORE_DB:-overload_restore}
read -r -a pg_exec <<<"${PG_EXEC:-docker compose exec -T postgres}"
bootstrap="$(dirname "$0")/../db/bootstrap.sql"

# The database is dropped first, so only a scratch name is accepted.
if [[ ! $db =~ ^overload_restore[a-z0-9_]*$ ]]; then
  echo "Refusing to drop and restore into '$db': the name must start with overload_restore." >&2
  exit 1
fi

umask 077
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

age --decrypt --identity "$identity" --output "$work/plain.dump" "$encrypted"

psql() { "${pg_exec[@]}" psql -U postgres -v ON_ERROR_STOP=1 --quiet "$@"; }

psql -d postgres -c "DROP DATABASE IF EXISTS $db WITH (FORCE)" -c "CREATE DATABASE $db"
psql -d "$db" <"$bootstrap"
"${pg_exec[@]}" pg_restore -U postgres --dbname="$db" --single-transaction --exit-on-error \
  <"$work/plain.dump"

# Counts and names only: the restored rows are production's.
psql -d "$db" --tuples-only --no-align -c "
  SELECT format('Restored %s tables; %s migrations applied, the last %s.',
    (SELECT count(*) FROM pg_tables WHERE schemaname = 'public'),
    (SELECT count(*) FROM __drizzle_migrations),
    (SELECT to_timestamp(max(created_at) / 1000.0) FROM __drizzle_migrations))"
