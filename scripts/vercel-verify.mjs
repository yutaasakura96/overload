#!/usr/bin/env node
//
// Reads both Vercel projects back and checks every variable docs/12 §2 requires
// is present, in the right scopes. Exits non-zero if anything is missing, so a
// provisioning script cannot report success on a write that silently failed.
//
//   node scripts/vercel-verify.mjs
//
// Values are never printed — only key names and which scopes they cover.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CFG = path.join(os.homedir(), 'Library/Application Support/com.vercel.cli');
let token;
let team;
try {
  token = JSON.parse(fs.readFileSync(path.join(CFG, 'auth.json'), 'utf8')).token;
  team = JSON.parse(fs.readFileSync(path.join(CFG, 'config.json'), 'utf8')).currentTeam;
} catch {
  console.error('  Could not read Vercel credentials. Run: npx vercel login');
  process.exit(1);
}

// key → the scopes it must cover. "prod" is production; "dev" is preview scoped
// to the develop branch; "prev" is unscoped preview, so PR previews match
// staging (docs/12 §2).
const ALL = ['prod', 'dev', 'prev'];
const REQUIRED = {
  'overload-api': {
    DATABASE_URL: ALL,
    DATABASE_URL_DIRECT: ALL,
    BETTER_AUTH_SECRET: ALL,
    BETTER_AUTH_URL: ALL,
    CRON_SECRET: ALL,
    GOOGLE_CLIENT_ID: ALL,
    GOOGLE_CLIENT_SECRET: ALL,
    ADMIN_EMAIL: ALL,
    OFF_CONTACT: ALL,
  },
  'overload-web': {
    API_ORIGIN: ALL,
  },
};

// Not required to deploy slice 1. Reported, never fatal.
const OPTIONAL = {
  'overload-api': ['SENTRY_DSN', 'SENTRY_AUTH_TOKEN', 'ANTHROPIC_API_KEY'],
  'overload-web': ['VITE_SENTRY_DSN', 'SENTRY_AUTH_TOKEN'],
};

function scopeOf(env) {
  if ((env.target || []).includes('production')) return 'prod';
  if (env.gitBranch) return env.gitBranch === 'develop' ? 'dev' : `branch:${env.gitBranch}`;
  return 'prev';
}

let missing = 0;

for (const [project, required] of Object.entries(REQUIRED)) {
  const r = await fetch(`https://api.vercel.com/v9/projects/${project}/env?teamId=${team}`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((x) => x.json());

  if (r.error) {
    console.error(`  ${project}: ${r.error.code} — ${r.error.message}`);
    process.exit(1);
  }

  const have = {};
  for (const e of r.envs || []) (have[e.key] ||= new Set()).add(scopeOf(e));

  console.log(`  ${project}`);
  for (const [key, scopes] of Object.entries(required)) {
    const got = have[key] || new Set();
    const gaps = scopes.filter((s) => !got.has(s));
    if (gaps.length) {
      missing += 1;
      console.log(`    ✗ ${key.padEnd(22)} missing: ${gaps.join(', ')}`);
    } else {
      console.log(`    ✓ ${key.padEnd(22)} ${scopes.join(' ')}`);
    }
  }
  for (const key of OPTIONAL[project] || []) {
    const got = have[key];
    console.log(
      `    ${got ? '✓' : '·'} ${key.padEnd(22)} ${got ? [...got].join(' ') : 'not set (optional)'}`,
    );
  }
}

if (missing) {
  console.log(`\n  ${missing} required variable(s) incomplete — provisioning is NOT finished.`);
  process.exit(1);
}
console.log('\n  Every variable docs/12 §2 requires is set.');
