#!/usr/bin/env bash
# Report how far the production branch has fallen behind the integration branch.
#
# This is the one fact the user-level session nudge does not cover. That hook
# watches context size, uncommitted work and unpushed commits — all of which
# stayed clean through the session where `main` silently drifted ten commits
# behind `develop`, because `develop` was pushed every time. "Nothing unpushed"
# and "production is current" are different claims.
#
# Deliberately silent when there is nothing to say: a hook that prints on every
# turn is a hook that gets ignored, and this one only exists to be noticed.
# Never blocks — it reports and exits 0 whatever it finds.
set -euo pipefail

repo="${CLAUDE_PROJECT_DIR:-.}"
git -C "$repo" rev-parse --git-dir >/dev/null 2>&1 || exit 0

# Both branches must exist locally for the comparison to mean anything.
git -C "$repo" show-ref --verify --quiet refs/heads/main || exit 0
git -C "$repo" show-ref --verify --quiet refs/heads/develop || exit 0

behind="$(git -C "$repo" rev-list --count main..develop 2>/dev/null || echo 0)"

# One release's worth of work is normal; a session's worth is drift. Ten is
# where it went unnoticed last time, so the threshold sits below that.
[ "$behind" -ge 6 ] || exit 0

echo "main is ${behind} commits behind develop — worth merging before it grows further (docs/12 §3)."
exit 0
