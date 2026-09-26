// `pnpm dev:session [--email <address>] [--out <file>]`: signs a browser in to the app running
// locally, so an agent can check a signed-in screen by hand (docs/06, 2026-09-26). It finds or
// creates the user in the local database, mints a session cookie with the browser tests' own code
// (test/e2e/test-session.ts), prints it, and writes it as a Playwright storageState file and a
// Playwright MCP snippet.
//
// It reads apps/api/.env.local, as `pnpm dev` does, so the cookie is signed with the secret the local
// API checks. It refuses anything but local values (dev-session-guard.ts) before it connects. Nothing
// in src imports it: the app has no sign-in shortcut (docs/08 §1).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { readConfig } from '../src/config';
import { createDatabase, createPool } from '../src/db/connection';
import { findOrInsertUser, mintSessionCookies } from '../test/e2e/test-session';
import { localOnlyRefusals } from './dev-session-guard';

const { values } = parseArgs({
  options: {
    email: { type: 'string', default: 'dev@example.test' },
    out: { type: 'string' },
  },
});

const refusals = localOnlyRefusals(process.env);
if (refusals.length > 0) {
  console.error('dev:session refused: it runs only against the local database with local secrets.');
  for (const reason of refusals) console.error(`- ${reason}`);
  process.exit(1);
}

// pnpm runs this from apps/api; a relative --out means the directory it was typed in.
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const out =
  values.out === undefined
    ? join(repoRoot, '.dev-session', 'storage-state.json')
    : resolve(process.env.INIT_CWD ?? process.cwd(), values.out);

const config = readConfig();
const pool = createPool(config.databaseUrl);
const db = createDatabase(pool);

try {
  const { userId, created } = await findOrInsertUser(db, values.email, 'Dev session');
  const web = new URL(config.webOrigin);
  const cookies = await mintSessionCookies({ config, db, userId, domain: web.hostname });
  const [cookie] = cookies;
  if (cookie === undefined) throw new Error('testUtils returned no cookie');

  // Beside the state file: Playwright MCP runs a snippet file under the repo by name, so the
  // cookie never has to be pasted into a tool call.
  const snippet = join(dirname(out), 'playwright-mcp.js');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify({ cookies, origins: [] }, null, 2)}\n`);
  writeFileSync(
    snippet,
    `async (page) => { await page.context().addCookies(${JSON.stringify(cookies)}); }\n`,
  );

  // Page script cannot set an httpOnly cookie, but the API reads the Cookie header either way.
  const expires =
    cookie.expires === undefined
      ? ''
      : `; expires=${new Date(cookie.expires * 1000).toUTCString()}`;
  const documentCookie = `${cookie.name}=${cookie.value}; path=${cookie.path}${expires}`;

  console.log(
    [
      `Signed in ${values.email} (user ${userId}, ${created ? 'created' : 'reused'}), a new session.`,
      `Open ${config.webOrigin}/ with the local API running on this apps/api/.env.local.`,
      '',
      `cookie name    ${cookie.name}`,
      `cookie value   ${cookie.value}`,
      `cookie domain  ${cookie.domain}`,
      `cookie path    ${cookie.path}`,
      '',
      `Playwright storageState: ${out}`,
      `Playwright MCP: browser_run_code_unsafe with filename ${relative(repoRoot, snippet)}, then navigate.`,
      `chrome-devtools-axi: \`open ${config.webOrigin}/\`, then this, then open it again:`,
      `  chrome-devtools-axi eval "document.cookie = '${documentCookie}'"`,
    ].join('\n'),
  );
} finally {
  await pool.end();
}
