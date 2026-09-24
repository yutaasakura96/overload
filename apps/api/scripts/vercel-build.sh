#!/bin/sh
# The API's Vercel build (docs/12 §3). The Hono preset has no build command of its own, so Vercel
# runs this `vercel-build` script and then bundles src/index.ts itself. Only develop (staging) and
# main (production) migrate; a PR preview never touches the database. A failed migration fails the
# build, and the previous deployment keeps serving.
set -eu

case "${VERCEL_GIT_COMMIT_REF:-}" in
  main | develop)
    dbmate --url "$DATABASE_URL_DIRECT" --migrations-dir ./migrations --no-dump-schema migrate
    ;;
  *)
    echo "No migration: '${VERCEL_GIT_COMMIT_REF:-}' is neither main nor develop."
    ;;
esac
