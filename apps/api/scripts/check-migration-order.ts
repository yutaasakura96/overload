// Fails when migrations/meta/_journal.json's `when` values do not strictly increase. CI runs it on
// every pull request; the fix is to delete and regenerate the late migration (docs/12 §3).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type JournalEntry, migrationOrderViolations } from './migration-order';

const journalPath = fileURLToPath(new URL('../migrations/meta/_journal.json', import.meta.url));
const journal: { entries: JournalEntry[] } = JSON.parse(readFileSync(journalPath, 'utf8'));
const violations = migrationOrderViolations(journal.entries);

if (violations.length > 0) {
  console.error('Migration journal `when` values must strictly increase:');
  for (const violation of violations) console.error(`  ${violation}`);
  console.error(
    'drizzle-orm would silently skip these. Delete and regenerate each late migration (docs/12 §3).',
  );
  process.exit(1);
}
console.log(`Migration journal order OK (${journal.entries.length} entries).`);
