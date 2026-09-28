// Builds the API as Vercel does (the hono preset, docs/12 §3) and asks the function it produced for
// /api/health. Run by plain `node`, not tsx: tsx resolves extensionless imports that Node's ESM
// loader, and so the deployed function, refuses. `pnpm --filter @overload/api check:vercel-build`.
//
// It catches what unit tests cannot: the preset taking the wrong file as its entry, and a compiled
// import Node cannot resolve. Either one crashed every staging request (docs/06, 2026-09-28).
// Placeholder values only: /api/health never reaches the database, so nothing here connects.
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Hono } from 'hono';

// The Vercel CLI whose builder this check trusts. Bump it with the builder Vercel deploys with.
const VERCEL_CLI = 'vercel@60.1.3';

const apiDir = join(import.meta.dirname, '..');
const linkDir = join(apiDir, '.vercel');
const outputDir = join(linkDir, 'output');

// `vercel build` reads project settings from .vercel/project.json. A developer's `vercel link`
// wrote a real one; keep it. Otherwise these settings stand in, and no token is needed. Install is
// skipped: the caller has already run `pnpm install`.
const projectFile = join(linkDir, 'project.json');
if (!existsSync(projectFile)) {
  mkdirSync(linkDir, { recursive: true });
  const settings = { framework: 'hono', nodeVersion: '24.x', installCommand: 'true' };
  writeFileSync(projectFile, JSON.stringify({ projectId: 'local', orgId: 'local', settings }));
}
rmSync(outputDir, { recursive: true, force: true });

// An empty ref, so scripts/vercel-build.sh never migrates.
execFileSync('pnpm', ['dlx', VERCEL_CLI, 'build', '--yes'], {
  cwd: apiDir,
  stdio: 'inherit',
  env: { ...process.env, VERCEL_GIT_COMMIT_REF: '' },
});

const functionDir = join(outputDir, 'functions', 'index.func');
const vcConfig: { handler: string; filePathMap?: Record<string, string> } = JSON.parse(
  readFileSync(join(functionDir, '.vc-config.json'), 'utf8'),
);
const { handler, filePathMap = {} } = vcConfig;
if (handler !== 'apps/api/src/index.js') {
  throw new Error(`Vercel took ${handler} as the entry, not apps/api/src/index.js`);
}

// The function as it is deployed, outside the repository, so no import falls back to the
// workspace's node_modules. filePathMap names what the deploy adds from the repository root: pnpm's
// symlinks, which resolve to the traced copies under node_modules/.pnpm.
const repoRoot = join(apiDir, '..', '..');
const deployed = mkdtempSync(join(tmpdir(), 'overload-api-function-'));
cpSync(functionDir, deployed, { recursive: true });
for (const [to, from] of Object.entries(filePathMap)) {
  const source = join(repoRoot, from);
  const target = join(deployed, to);
  mkdirSync(dirname(target), { recursive: true });
  if (lstatSync(source).isSymbolicLink()) {
    symlinkSync(readlinkSync(source), target);
  } else {
    cpSync(source, target, { recursive: true });
  }
}

Object.assign(process.env, {
  DATABASE_URL: 'postgres://nobody@127.0.0.1:1/none',
  BETTER_AUTH_URL: 'https://staging.example.test',
  BETTER_AUTH_SECRET: 'placeholder-placeholder-placeholder-placeholder',
  GOOGLE_CLIENT_ID: 'placeholder',
  GOOGLE_CLIENT_SECRET: 'placeholder',
  ADMIN_EMAIL: 'admin@example.test',
});
const entry: { default: Pick<Hono, 'fetch'> } = await import(join(deployed, handler));
const res = await entry.default.fetch(new Request('https://staging.example.test/api/health'));
if (res.status !== 200) {
  throw new Error(`The built function answered /api/health with ${res.status}`);
}
rmSync(deployed, { recursive: true, force: true });
console.log(JSON.stringify({ entry: handler, health: res.status }));
