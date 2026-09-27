import {
  chmodSync,
  closeSync,
  constants,
  fchmodSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { readConfig } from '../src/config';
import { createDatabase, createPool } from '../src/db/connection';
import { findOrInsertUser, mintSessionCookies } from '../test/e2e/test-session';
import { localOnlyRefusals } from './dev-session-guard';

type Inputs = {
  fileValues: Record<string, string | undefined>;
  exportedEnv: Record<string, string | undefined>;
  stateDirectory: string;
  databaseName?: string;
};

// The open mode applies only on create, so an existing file is restricted before the token lands.
function writePrivate(path: string, content: string) {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
  try {
    fchmodSync(fd, 0o600);
    ftruncateSync(fd, 0);
    writeFileSync(fd, content);
  } finally {
    closeSync(fd);
  }
}

export async function createDevSession(inputs: Inputs) {
  const refusals = localOnlyRefusals(inputs.fileValues, inputs.exportedEnv, inputs.databaseName);
  if (refusals.length > 0) {
    throw new Error(`dev:session refused:\n${refusals.map((reason) => `- ${reason}`).join('\n')}`);
  }

  const config = readConfig(inputs.fileValues);
  const pool = createPool(config.databaseUrl);
  const db = createDatabase(pool);

  try {
    const { userId } = await findOrInsertUser(db, 'dev@example.test', 'Dev session');
    const web = new URL(config.webOrigin);
    const cookies = await mintSessionCookies({ config, db, userId, domain: web.hostname });
    const [cookie] = cookies;
    if (cookie === undefined) throw new Error('testUtils returned no cookie');

    const storageState = join(inputs.stateDirectory, 'storage-state.json');
    const playwrightSnippet = join(inputs.stateDirectory, 'playwright-mcp.js');
    const chromeSnippet = join(inputs.stateDirectory, 'chrome-devtools-axi.js');
    const expires =
      cookie.expires === undefined
        ? ''
        : `; expires=${new Date(cookie.expires * 1000).toUTCString()}`;
    const documentCookie = `${cookie.name}=${cookie.value}; path=${cookie.path}${expires}`;

    mkdirSync(inputs.stateDirectory, { recursive: true, mode: 0o700 });
    chmodSync(inputs.stateDirectory, 0o700);
    writePrivate(storageState, `${JSON.stringify({ cookies, origins: [] }, null, 2)}\n`);
    writePrivate(
      playwrightSnippet,
      `async (page) => { await page.context().addCookies(${JSON.stringify(cookies)}); }\n`,
    );
    writePrivate(
      chromeSnippet,
      `await page.open(${JSON.stringify(`${config.webOrigin}/`)});\nawait page.eval(${JSON.stringify(`document.cookie = ${JSON.stringify(documentCookie)}`)});\nawait page.open(${JSON.stringify(`${config.webOrigin}/`)});\n`,
    );

    return { webOrigin: config.webOrigin, storageState, playwrightSnippet, chromeSnippet };
  } finally {
    await pool.end();
  }
}
