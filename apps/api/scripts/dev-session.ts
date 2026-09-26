import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { createDevSession } from './dev-session-core';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

const envFile = join(repoRoot, 'apps/api/.env.local');

try {
  const fileValues = existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')) : {};
  const result = await createDevSession({
    fileValues,
    exportedEnv: process.env,
    stateDirectory: join(repoRoot, '.dev-session'),
  });
  console.log(
    [
      `Open ${result.webOrigin}/ with the local API running.`,
      `Playwright storageState: ${result.storageState}`,
      `Playwright MCP: browser_run_code_unsafe with filename ${result.playwrightSnippet}, then navigate.`,
      `chrome-devtools-axi: chrome-devtools-axi run < ${result.chromeSnippet}`,
    ].join('\n'),
  );
} catch (error) {
  if (error instanceof Error && error.message.startsWith('dev:session refused:')) {
    console.error(error.message);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
