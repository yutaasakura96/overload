#!/usr/bin/env node
//
// Sets Vercel environment variables from a JSON document on stdin, using the
// Vercel CLI's stored auth token. Called by scripts/provision-resume.sh so the
// human never types a value into a dashboard twice.
//
//   echo '{"project":"overload-api","vars":[…]}' | node scripts/vercel-env.mjs
//
// Each var: { key, value, type, target, gitBranch? }
//   type    "sensitive" (write-only after saving — the docs/12 §2 "Secret"
//           column) or "plain" (the "Config" column)
//   target  one of "production" | "preview"
//   gitBranch  only for preview vars scoped to a branch
//
// Re-running is safe: an existing variable with the same key, target and
// branch is deleted first, so this upserts.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CFG = path.join(os.homedir(), 'Library/Application Support/com.vercel.cli');

function auth() {
  try {
    const token = JSON.parse(fs.readFileSync(path.join(CFG, 'auth.json'), 'utf8')).token;
    const team = JSON.parse(fs.readFileSync(path.join(CFG, 'config.json'), 'utf8')).currentTeam;
    if (!token) throw new Error('no token');
    return { token, team };
  } catch {
    console.error('Could not read the Vercel CLI credentials.');
    console.error('Run:  npx vercel login    then try again.');
    return process.exit(1);
  }
}

const { token, team } = auth();
const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const project = input.project;

const existing = await fetch(
  `https://api.vercel.com/v9/projects/${project}/env?teamId=${team}&decrypt=false`,
  { headers: H },
).then((r) => r.json());

if (existing.error) {
  console.error(`${project}: ${existing.error.code} — ${existing.error.message}`);
  if (existing.error.code === 'forbidden') {
    console.error('The stored token has expired. Run:  npx vercel whoami');
  }
  process.exit(1);
}

let ok = 0;
let failed = 0;

for (const v of input.vars) {
  if (v.value === undefined || v.value === null || v.value === '') {
    console.log(`  – ${v.key} [${v.target}] skipped, no value given`);
    continue;
  }

  // Upsert: drop any variable with the same key/target/branch first.
  for (const e of existing.envs || []) {
    const sameTarget = (e.target || []).includes(v.target);
    const sameBranch = (e.gitBranch || null) === (v.gitBranch || null);
    if (e.key === v.key && sameTarget && sameBranch) {
      await fetch(`https://api.vercel.com/v9/projects/${project}/env/${e.id}?teamId=${team}`, {
        method: 'DELETE',
        headers: H,
      });
    }
  }

  const body = {
    key: v.key,
    value: String(v.value),
    type: v.type === 'sensitive' ? 'sensitive' : 'plain',
    target: [v.target],
  };
  if (v.gitBranch) body.gitBranch = v.gitBranch;

  const r = await fetch(`https://api.vercel.com/v10/projects/${project}/env?teamId=${team}`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify(body),
  });

  if (r.ok) {
    ok += 1;
    const scope = v.gitBranch ? `${v.target}:${v.gitBranch}` : v.target;
    console.log(`  ✓ ${v.key} [${scope}] ${v.type === 'sensitive' ? '(secret)' : ''}`);
  } else {
    failed += 1;
    const j = await r.json().catch(() => ({}));
    console.log(`  ✗ ${v.key} [${v.target}] — ${j.error?.message ?? r.status}`);
  }
}

console.log(`  ${ok} set, ${failed} failed`);
process.exit(failed ? 1 : 0);
