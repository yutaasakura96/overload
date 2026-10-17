#!/bin/sh
# Runs a command against a Postgres 18 of its own: started here on a free port with the same init
# scripts as docker-compose.yml, and removed, with its anonymous volume, when the command ends. It
# never reuses or removes a container it did not start. With TEST_DATABASE_URL already set (CI's
# service container, or a database you chose), it runs the command unchanged.
#
#   sh apps/api/scripts/with-test-database.sh pnpm --filter @overload/api test
set -eu

if [ -n "${TEST_DATABASE_URL:-}" ]; then
  exec "$@"
fi

repo=$(cd "$(dirname "$0")/../../.." && pwd -P)
db="$repo/infra/db"

container=$(docker run --detach --rm \
  --name "overload-test-$$-$(date +%s)" \
  --env POSTGRES_USER=postgres --env POSTGRES_PASSWORD=postgres --env POSTGRES_DB=overload \
  --publish 127.0.0.1::5432 \
  --volume "$db/bootstrap.sql:/docker-entrypoint-initdb.d/01-bootstrap.sql:ro" \
  --volume "$db/local-passwords.sql:/docker-entrypoint-initdb.d/02-local-passwords.sql:ro" \
  --volume "$db/local-test-database.sql:/docker-entrypoint-initdb.d/03-local-test-database.sql:ro" \
  postgres:18)

cleanup() {
  docker rm --force --volumes "$container" >/dev/null 2>&1 || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# The init scripts run against a server that listens on its socket only, so a TCP answer means
# they have finished and the final server is up.
tries=0
until docker exec "$container" pg_isready --quiet --host 127.0.0.1 --username postgres --dbname overload_test; do
  tries=$((tries + 1))
  if [ "$tries" -ge 60 ]; then
    echo "with-test-database: Postgres did not start within 60 seconds" >&2
    docker logs --tail 50 "$container" >&2 || true
    exit 1
  fi
  sleep 1
done

port=$(docker port "$container" 5432/tcp | head -n 1)
port=${port##*:}

export TEST_DATABASE_URL="postgres://overload_app:overload_app_dev@localhost:$port/overload_test"
export TEST_DATABASE_URL_DIRECT="postgres://overload_owner:overload_owner_dev@localhost:$port/overload_test?sslmode=disable"
echo "with-test-database: throwaway Postgres on localhost:$port"

"$@"
