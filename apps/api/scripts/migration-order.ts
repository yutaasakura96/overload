// drizzle-orm's migrator applies a journal entry only when its `when` is later than the `created_at`
// of the last applied migration; it never compares tags. An entry whose `when` does not rise above
// the one before it is silently skipped on every environment that already ran that earlier one, so
// the build stays green without it (docs/12 §3, "Writing a migration").

export interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

// One message per entry whose `when` is not strictly greater than the previous entry's.
export function migrationOrderViolations(entries: readonly JournalEntry[]): string[] {
  const violations: string[] = [];
  for (let i = 1; i < entries.length; i++) {
    const previous = entries[i - 1]!;
    const entry = entries[i]!;
    if (entry.when > previous.when) continue;
    violations.push(
      `${entry.tag} (when ${entry.when}) is not later than ${previous.tag} (when ${previous.when})`,
    );
  }
  return violations;
}
