#!/usr/bin/env bash
# infra/backup/dump.sh OUTPUT
#
# The nightly backup's dump (docs/13 §2), and CI's backup-restore job runs the same file against the
# test database. pg_dump --format=custom as overload_backup, checked readable by pg_restore, then
# encrypted with age before anything leaves this machine. The plaintext dump lives only in a private
# temporary directory and is deleted on exit.
#
#   DATABASE_URL_BACKUP  the direct (non-pooler) connection, role overload_backup. Required.
#   AGE_RECIPIENTS_FILE  default infra/backup/age-recipients.txt, the committed public key.
#   PG_IMAGE             default postgres:18. pg_dump must be at least the server's major version,
#                        so it runs from the same image as local Docker and CI.
set -euo pipefail

output=${1:?usage: infra/backup/dump.sh OUTPUT}
: "${DATABASE_URL_BACKUP:?DATABASE_URL_BACKUP is not set}"
recipients=${AGE_RECIPIENTS_FILE:-$(dirname "$0")/age-recipients.txt}
image=${PG_IMAGE:-postgres:18}

# A recipients file with nothing but comments would make age refuse anyway; say why first.
if ! grep -qv '^[[:space:]]*\(#\|$\)' "$recipients"; then
  echo "::error::No age recipient in $recipients. Commit the backup public key first (docs/13 §2)." >&2
  exit 1
fi

umask 077
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# The URL goes in by name (-e with no value), so it never appears on a command line.
docker run --rm --network host -e DATABASE_URL_BACKUP "$image" \
  sh -c 'exec pg_dump --format=custom --dbname="$DATABASE_URL_BACKUP"' >"$work/plain.dump"

# A dump pg_restore cannot list is not a backup. Object names only, never data, reach the log.
tables=$(docker run --rm -i "$image" pg_restore --list <"$work/plain.dump" | grep -c ' TABLE DATA ' || true)
if [ "$tables" -eq 0 ]; then
  echo "::error::The dump holds no table data." >&2
  exit 1
fi

age --encrypt --recipients-file "$recipients" --output "$output" "$work/plain.dump"
echo "Dumped $tables tables, $(wc -c <"$output" | tr -d ' ') bytes encrypted."
