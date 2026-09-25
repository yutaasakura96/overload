#!/bin/sh
# The API's Vercel build (docs/12 §3). The Hono preset has no build command of its own, so Vercel
# runs this `vercel-build` script and then bundles src/index.ts itself. Only develop (staging) and
# main (production) migrate; a PR preview never touches the database. A failed migration fails the
# build, and the previous deployment keeps serving.
set -eu

case "${VERCEL_GIT_COMMIT_REF:-}" in
  main | develop)
    # drizzle.config.ts reads it; fail here, by name, rather than with an empty connection string.
    : "${DATABASE_URL_DIRECT:?DATABASE_URL_DIRECT is not set}"
    drizzle-kit migrate
    ;;
  *)
    echo "No migration: '${VERCEL_GIT_COMMIT_REF:-}' is neither main nor develop."
    ;;
esac
